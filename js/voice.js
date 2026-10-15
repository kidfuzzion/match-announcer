// Voices: ElevenLabs (cloud, pre-generated and cached as clips) and the device's built-in voice
// (offline, spoken live). The device voice is also the automatic fallback for any line without a clip.
import { db } from './db.js';
import { store } from './state.js';

const API = 'https://api.elevenlabs.io/v1';

export const ELEVEN_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 (most natural, 1 credit per character)' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 (slightly flatter, about half the credits)' },
];

async function hash(str) {
  if (crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function clipKey(text, S = store.state.settings) {
  return hash(['el', S.elevenVoiceId, S.elevenModel, clamp(+S.rate || 1, 0.7, 1.2).toFixed(2), text].join('|'));
}

export const elevenReady = (S = store.state.settings) => !!(S.elevenKey && S.elevenVoiceId);

async function apiError(r) {
  let msg = `${r.status} ${r.statusText}`;
  try {
    const j = await r.json();
    const d = j.detail;
    msg = (d && (d.message || d.status || (typeof d === 'string' ? d : JSON.stringify(d)))) || msg;
  } catch {}
  if (r.status === 401) msg = `The API key was rejected (${msg}). Check the key and that it has Text to Speech, Voices, and User permissions.`;
  return new Error(msg);
}

export async function elevenVoices(key) {
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': key } });
  if (!r.ok) throw await apiError(r);
  const j = await r.json();
  return (j.voices || []).map(v => ({
    id: v.voice_id, name: v.name, category: v.category,
    desc: [v.labels && v.labels.gender, v.labels && v.labels.accent, v.labels && (v.labels.description || v.labels.descriptive), v.labels && v.labels.use_case].filter(Boolean).join(', '),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function elevenUsage(key) {
  const r = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': key } });
  if (!r.ok) throw await apiError(r);
  const j = await r.json();
  return { used: j.character_count, limit: j.character_limit, tier: j.tier, resets: j.next_character_count_reset_unix };
}

async function elevenSynth(text, S) {
  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(S.elevenVoiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': S.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text, model_id: S.elevenModel,
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: clamp(+S.rate || 1, 0.7, 1.2) },
    }),
  });
  if (!r.ok) throw await apiError(r);
  return await r.blob();
}

export async function getClip(text) {
  return db.get('clips', await clipKey(text));
}

// Returns the cached clip, generating it (and spending credits) only if it is missing.
export async function ensureClip(text) {
  const S = store.state.settings;
  const key = await clipKey(text, S);
  const have = await db.get('clips', key);
  if (have) return { blob: have, cached: true };
  const blob = await elevenSynth(text, S);
  await db.put('clips', key, blob);
  return { blob, cached: false };
}

export async function clipStatus(lines) {
  let ready = 0, missingChars = 0;
  for (const t of lines) { if (await getClip(t)) ready++; else missingChars += t.length; }
  return { ready, total: lines.length, missingChars };
}

// ---------- Device voice ----------

let voicesP;
export function deviceVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (voicesP) return voicesP;
  voicesP = new Promise(resolve => {
    const done = () => {
      const vs = speechSynthesis.getVoices();
      if (vs.length) resolve(vs.filter(v => /^en/i.test(v.lang)).sort((a, b) => a.name.localeCompare(b.name)));
    };
    done();
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(() => resolve(speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang))), 2500);
  });
  return voicesP;
}

export async function speakDevice(text, signal) {
  if (!('speechSynthesis' in window)) throw new Error('This browser has no built-in voice.');
  const S = store.state.settings;
  const vs = await deviceVoices();
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = vs.find(x => x.voiceURI === S.deviceVoice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = clamp(+S.rate || 1, 0.5, 1.5);
    u.volume = 1;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
    // Safari occasionally never fires "end"; don't let the show hang on it.
    const guard = setTimeout(finish, 3000 + (text.length * 110) / u.rate);
    u.onend = finish; u.onerror = finish;
    if (signal) signal.addEventListener('abort', () => { speechSynthesis.cancel(); finished = true; clearTimeout(guard); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// ---------- Previews (setup screens) ----------

let previewAudio;
export function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// engine: 'elevenlabs' | 'device' | undefined (use the current setting)
export async function preview(text, engine) {
  stopPreview();
  const S = store.state.settings;
  const useEleven = (engine || S.engine) === 'elevenlabs';
  if (!useEleven) return speakDevice(text);
  if (!elevenReady(S)) throw new Error('Add your ElevenLabs API key and pick a voice on the Voice screen first.');
  const { blob } = await ensureClip(text);
  const url = URL.createObjectURL(blob);
  previewAudio = new Audio(url);
  await previewAudio.play();
  return new Promise(res => { previewAudio.onended = () => { URL.revokeObjectURL(url); res(); }; });
}
