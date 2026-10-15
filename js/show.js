// The match-time audio engine. Everything plays through Web Audio so music can be ducked
// under the voice (iPhone Safari ignores volume changes on ordinary audio elements).
import { db } from './db.js';
import { store } from './state.js';
import { getClip, speakDevice } from './voice.js';
import { allLines } from './script.js';

const sleep = (s, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
  const t = setTimeout(resolve, Math.max(0, s) * 1000);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

export class Show {
  constructor(ui) {
    this.ui = ui;               // { line(text, label, via), progress(frac), state() }
    this.ctx = null;
    this.buffers = new Map();   // line text → AudioBuffer
    this.anthem = null; this.music = null;
    this.musicSrc = null; this.anthemSrc = null; this.voiceSrc = null;
    this.ac = null; this.playing = false; this.paused = false; this.resumeWaiters = [];
    this.wakeLock = null; this.ready = false;
    this._onVis = () => { if (document.visibilityState === 'visible' && this.ready) this.keepAwake(); };
  }

  // Must be called from a tap: unlocks audio on iPhone, keeps the screen on, decodes everything.
  async start(onStatus = () => {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.master);
      this.voiceGain = this.ctx.createGain(); this.voiceGain.connect(this.master);
      this.anthemGain = this.ctx.createGain(); this.anthemGain.connect(this.master);
    }
    // Play even when the iPhone's ring/silent switch is set to silent (Safari 16.4+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    await this.ctx.resume();
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    // Warm up the device voice inside the same tap so iOS allows it later.
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }

    await this.keepAwake();
    document.addEventListener('visibilitychange', this._onVis);

    const S = store.state.settings, F = store.state.files;
    const problems = [];
    onStatus('Loading anthem and music…');
    this.anthem = F.anthem ? await this.decodeKey('anthem', problems, 'anthem') : null;
    this.music = F.music ? await this.decodeKey('music', problems, 'home music') : null;

    this.buffers.clear();
    let fallback = 0;
    if (S.engine === 'elevenlabs') {
      const lines = allLines();
      for (let i = 0; i < lines.length; i++) {
        onStatus(`Loading voice clips ${i + 1} of ${lines.length}…`);
        const blob = await getClip(lines[i]);
        if (!blob) { fallback++; continue; }
        try { this.buffers.set(lines[i], await this.ctx.decodeAudioData(await blob.arrayBuffer())); }
        catch { fallback++; }
      }
    }
    this.ready = true;
    return { problems, fallback };
  }

  async decodeKey(key, problems, label) {
    try {
      const blob = await db.get('blobs', key);
      if (!blob) { problems.push(`The ${label} file is missing. Load it again on the Match screen.`); return null; }
      return await this.ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (e) {
      problems.push(`The ${label} file could not be read. Try an MP3 or M4A file.`);
      return null;
    }
  }

  async keepAwake() {
    try { if ('wakeLock' in navigator && !this.wakeLock) { this.wakeLock = await navigator.wakeLock.request('screen'); this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }); } } catch {}
  }

  end() {
    this.stop(true);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    this.ready = false;
  }

  ramp(gainNode, target, secs) {
    const now = this.ctx.currentTime, g = gainNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + Math.max(0.02, secs));
  }

  playBuffer(buf, dest, signal, opts = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(dest);
    if (opts.loop) { src.loop = true; src.loopStart = opts.offset || 0; src.loopEnd = buf.duration; }
    const ended = new Promise((resolve, reject) => {
      src.onended = () => resolve();
      if (signal) signal.addEventListener('abort', () => { try { src.stop(); } catch {} reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
    });
    src.start(0, Math.min(opts.offset || 0, Math.max(0, buf.duration - 0.1)));
    return { src, ended };
  }

  async say(step, signal) {
    const buf = this.buffers.get(step.text);
    const S = store.state.settings;
    if (buf) {
      this.ui.line(step.text, step.label, 'clip');
      const { src, ended } = this.playBuffer(buf, this.voiceGain, signal);
      this.voiceSrc = src;
      await ended;
    } else {
      this.ui.line(step.text, step.label, S.engine === 'elevenlabs' ? 'fallback' : 'device');
      await speakDevice(step.text, signal);
    }
  }

  waitIfPaused(signal) {
    if (!this.paused) return Promise.resolve();
    this.ui.state();
    return new Promise((resolve, reject) => {
      this.resumeWaiters.push(resolve);
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    });
  }

  pause() { if (this.playing) { this.paused = true; this.ui.state(); } }
  resume() {
    this.paused = false;
    const w = this.resumeWaiters; this.resumeWaiters = [];
    w.forEach(fn => fn());
    this.ui.state();
  }

  async runCue(cue) {
    if (!this.ready) throw new Error('Tap Start session first.');
    if (this.playing) return;
    await this.ctx.resume();
    this.ac = new AbortController();
    const signal = this.ac.signal;
    this.playing = true; this.paused = false; this.ui.state();
    const S = store.state.settings;
    const steps = cue.steps;
    try {
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        this.ui.progress(i / steps.length);
        switch (st.t) {
          case 'say': await this.say(st, signal); break;
          case 'wait': await sleep(st.s, signal); break;
          case 'hold': await this.waitIfPaused(signal); break;
          case 'anthem':
            if (!this.anthem) { this.ui.line('No anthem file loaded. Load one on the Match screen.', 'Anthem', 'note'); break; }
            this.anthemGain.gain.value = 1;
            this.ui.line('National anthem', 'Playing file', 'music');
            { const { src, ended } = this.playBuffer(this.anthem, this.anthemGain, signal); this.anthemSrc = src; await ended; this.anthemSrc = null; }
            break;
          case 'musicStart':
            if (!this.music) break;
            this.stopMusic();
            this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
            { const { src } = this.playBuffer(this.music, this.musicGain, null, { offset: +store.state.match.musicStart || 0, loop: true }); this.musicSrc = src; }
            this.ramp(this.musicGain, 1, 0.3);
            this.ui.line('Home music', 'Intro at full volume', 'music');
            break;
          case 'music':
            if (!this.musicSrc) break;
            this.ramp(this.musicGain, st.level, st.s);
            await sleep(st.s, signal);
            break;
          case 'musicFade':
            if (!this.musicSrc) break;
            this.ramp(this.musicGain, 0, st.s);
            await sleep(st.s + 0.1, signal);
            this.stopMusic();
            break;
        }
      }
      this.ui.progress(1);
      return 'done';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'stopped';
      throw e;
    } finally {
      this.playing = false; this.paused = false; this.ac = null;
      this.ui.state();
      void S;
    }
  }

  stopMusic() {
    if (this.musicSrc) { try { this.musicSrc.stop(); } catch {} this.musicSrc = null; }
  }

  // Stop everything. Music fades over a second instead of cutting off.
  stop(hard = false) {
    if (this.ac) this.ac.abort();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch {} this.voiceSrc = null; }
    if (this.anthemSrc) { try { this.anthemSrc.stop(); } catch {} this.anthemSrc = null; }
    if (this.musicSrc && this.ctx) {
      if (hard) this.stopMusic();
      else { const src = this.musicSrc; this.ramp(this.musicGain, 0, 1); setTimeout(() => { try { src.stop(); } catch {} if (this.musicSrc === src) this.musicSrc = null; }, 1100); }
    }
    this.resume();
  }
}
