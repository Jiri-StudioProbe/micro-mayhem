// Sound: everything is synthesised with WebAudio, there are no audio files. The AudioContext class and the document are
// passed in so this can be tested with fakes. Every method is safe to call at any time: before the first user gesture, with
// sound muted, or on a browser with no WebAudio, they simply do nothing.
import { clamp } from './util.js';

export function createAudio({ getPlayer, doc = null, AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null } = {}) {
  let AC = null, master = null, eng = null, noiseBuf = null, muted = false;

  // Browsers only allow audio after a user gesture, so this is called from input handlers.
  function init() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new AudioContextClass();
      master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
      const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 60; f.type = 'lowpass'; f.frequency.value = 520; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(master); o.start(); eng = { o, g };
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 1, AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { AC = null; }
  }
  function tone(f, d, type, v, slide) {
    if (!AC || muted) return;
    const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(25, f + slide), t + d);
    g.gain.setValueAtTime(v || 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v, lp) {
    if (!AC || muted) return;
    const t = AC.currentTime, s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(lp || 1800, t); f.frequency.exponentialRampToValueAtTime(120, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + d + 0.02);
  }
  // Loudness of something at (x, y), by its distance from the player.
  const vol = (x, y) => { const p = getPlayer(); return clamp(1 - Math.hypot(x - p.x, y - p.y) / 650, 0.08, 1); };
  function setMuted(m) { muted = !!m; if (AC) { if (muted) AC.suspend(); else AC.resume(); } }
  // The engine hum follows speed and throttle; `on` is false on menus and after the race.
  function engine(speed, throttle, on) {
    if (!eng || !AC) return;
    eng.o.frequency.setTargetAtTime(52 + speed * 0.26 + (throttle ? 14 : 0), AC.currentTime, 0.05);
    eng.g.gain.setTargetAtTime(!muted && on ? 0.05 : 0, AC.currentTime, 0.1);
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (AC) { if (doc.hidden) AC.suspend(); else if (!muted) AC.resume(); } });

  return { init, tone, noise, vol, setMuted, engine, get muted() { return muted; }, get ready() { return !!AC; } };
}
