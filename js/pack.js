// Match pack: one file holding rosters, approved pronunciations, scripts, settings, audio files,
// and (optionally) generated voice clips. Used as a backup and to move to another device.
// The ElevenLabs API key is never written into a pack.
import { db } from './db.js';
import { store } from './state.js';

const blobToB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const b64ToBlob = (b64, type) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: type || 'application/octet-stream' });
};

export async function exportPack({ includeClips = true } = {}) {
  const state = JSON.parse(JSON.stringify(store.state));
  state.settings.elevenKey = '';
  const blobs = {}, clips = {};
  for (const [k, b] of await db.entries('blobs')) if (b) blobs[k] = { type: b.type, data: await blobToB64(b) };
  if (includeClips) for (const [k, b] of await db.entries('clips')) if (b) clips[k] = { type: b.type, data: await blobToB64(b) };
  const pack = { kind: 'match-announcer-pack', version: 1, exportedAt: new Date().toISOString(), state, blobs, clips };
  const blob = new Blob([JSON.stringify(pack)], { type: 'application/json' });

  const h = state.teams.find(t => t.id === state.match.homeId), v = state.teams.find(t => t.id === state.match.visitorId);
  const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const name = ['match-pack', slug(h && (h.mascot || h.school)), v ? 'vs-' + slug(v.mascot || v.school) : '', new Date().toISOString().slice(0, 10)].filter(Boolean).join('_') + '.json';

  const file = new File([blob], name, { type: 'application/json' });
  // On iPhone the share sheet is the friendliest way to save to Files or AirDrop.
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return name; } catch (e) { if (e.name === 'AbortError') return null; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

export async function importPack(file) {
  const pack = JSON.parse(await file.text());
  if (!pack || pack.kind !== 'match-announcer-pack' || !pack.state) throw new Error('That file is not a match pack.');
  const key = store.state.settings.elevenKey;           // keep this device's key
  await db.clear('blobs');
  for (const [k, v] of Object.entries(pack.blobs || {})) await db.put('blobs', k, b64ToBlob(v.data, v.type));
  for (const [k, v] of Object.entries(pack.clips || {})) await db.put('clips', k, b64ToBlob(v.data, v.type));
  pack.state.settings = { ...pack.state.settings, elevenKey: key || pack.state.settings.elevenKey || '' };
  store.replace(pack.state);
  await store.saveNow();
}
