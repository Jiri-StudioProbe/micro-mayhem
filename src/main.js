// The game shell: canvas and camera, audio, input, HUD and overlays, the renderer, and the main loop.
// It reads state from the simulation and writes only to S.input.
// Moved verbatim out of index.html in M0.5; it is being split into modules in M0.5 to M0.7.
import { Sim } from './sim/sim.js';
(() => {
'use strict';
const { T, N, HALF_W, LAPS, WEAP, create, reset, step, ranking, angDiff, clamp } = Sim;
const S = create();
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, Z = 1, baseY = 0;
const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
// Canvas resolution steps. Slow devices step down automatically (see tick()); phones start capped at 1.5x.
const RES_STEPS = [1, 0.75, 0.55]; let resStep = 0;
const K = 0.0011, TILT = 0.66;
const cam = { x: T.x[0], y: T.y[0], a: T.ang[0], c: 1, s: 0, shx: 0, shy: 0 };

function resize() {
  DPR = Math.min(COARSE ? 1.5 : 2, window.devicePixelRatio || 1) * RES_STEPS[resStep];
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  // short (landscape phone) screens zoom in a little so the track and cars aren't tiny
  Z = clamp(Math.min(W / 400, H / (500 - 70 * clamp((500 - H) / 110, 0, 1))), 0.7, 2.1);
  baseY = H * 0.77;
}
window.addEventListener('resize', resize); resize();

/* ---------- audio ---------- */
let AC = null, master = null, eng = null, noiseBuf = null, muted = false;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
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
const vol = (x, y) => clamp(1 - Math.hypot(x - S.player.x, y - S.player.y) / 650, 0.08, 1);
document.addEventListener('visibilitychange', () => { if (AC) { if (document.hidden) AC.suspend(); else if (!muted) AC.resume(); } });

/* ---------- input ---------- */
const keys = new Set(), touch = new Set();
const input = S.input;
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'fire', KeyF: 'fire', ShiftLeft: 'fire', ShiftRight: 'fire' };
window.addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (e.code === 'Enter' || (e.code === 'Space' && overlayOpen())) { if (overlayOpen()) { e.preventDefault(); startRace(); return; } }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'Escape' && S.lab) { exitLab(); return; }
  if (a) { e.preventDefault(); keys.add(a); initAudio(); }
});
window.addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) keys.delete(a); });
window.addEventListener('blur', () => { keys.clear(); touch.clear(); stickRelease(); });
const padEl = $('pad');
padEl.querySelectorAll('button').forEach(b => {
  const act = b.dataset.act;
  const on = e => { e.preventDefault(); touch.add(act); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) {} initAudio(); };
  const off = e => { touch.delete(act); b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
/* Drive joystick: the base re-centres on wherever the thumb lands in the left zone. */
const stickZone = $('stickZone'), stickEl = $('stick'), knobEl = $('knob');
/* ---------- profile (persistence) ----------
   Everything that outlives a page load (settings now; character, cars, best times and aura later) lives in ONE
   versioned JSON document, so it can be migrated, exported and backed up as a unit. Never add ad-hoc localStorage keys. */
const Profile = (() => {
  const KEY = 'mm:profile', VERSION = 1;
  const fresh = () => ({ version: VERSION, settings: { level: 'veteran', presets: {} } });
  let data = fresh();
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o === 'object' && o.settings && typeof o.settings === 'object') {
      data = Object.assign(fresh(), o); data.settings = Object.assign(fresh().settings, o.settings);
    }
    ['mm-tune', 'mm-assist'].forEach(k => localStorage.removeItem(k));   // pre-profile keys, superseded
  } catch (_) {}
  // migrations go here, oldest first: if (data.version < 2) { ...; data.version = 2; }
  data.version = VERSION;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  return { data, save };
})();

/* ---------- difficulty levels ----------
   A level is a bundle of defaults: whether the driving assist starts on, and every steering tunable. The Steering Lab
   edits the active level; only the values you change are saved (per level), so untouched values follow new defaults.
   Bump PRESET_VERSION when baking new defaults: it discards saved tweaks that would otherwise hide them. */
const PRESET_VERSION = 1;
const STEER_BASE = { gain: 2.6, curve: 2.55, maxLock: 1, speedDamp: 0.45, rate: 79, dead: 0.14, radius: 48 };
const LEVELS = {
  rookie:  { label: 'Rookie',  assist: true,  tune: Object.assign({}, STEER_BASE, { assistLane: 1.5, assistSpeed: 1.5 }),
             blurb: 'Driving assist on at full strength: the car holds your lane and keeps you off the walls.' },
  veteran: { label: 'Veteran', assist: false, tune: Object.assign({}, STEER_BASE, { assistLane: 0.3, assistSpeed: 1.1 }),
             blurb: 'No assist: you do the steering. Assist can still be switched on.' }
};
/* Touch steering tunables (ranges and hints; the default values live in LEVELS). Stick steering =
   sign(x) * min(maxLock, gain * |x|^curve), then eased by `rate`. */
const TUNE_DEFS = [
  { k: 'gain',        label: 'Sensitivity',           min: 0.5, max: 4,    step: 0.05, hint: 'How hard the car turns for a given thumb movement. Higher = twitchier.' },
  { k: 'curve',       label: 'Fine control',          min: 1,   max: 3,    step: 0.05, hint: 'Above 1, small movements steer very gently while big ones still reach full lock.' },
  { k: 'maxLock',     label: 'Maximum lock',          min: 0.3, max: 1,    step: 0.05, hint: 'Caps how sharply the car can ever turn. Lower = wider, calmer turns.' },
  { k: 'speedDamp',   label: 'Calmer at speed',       min: 0,   max: 0.95, step: 0.05, hint: 'Reduces steering as the car goes faster, the way real cars feel stable at speed.' },
  { k: 'rate',        label: 'Reactivity',            min: 4,   max: 100,  step: 1,    hint: 'How quickly the steering follows your thumb. Higher = snappier, lower = smoother but laggier.' },
  { k: 'dead',        label: 'Dead zone',             min: 0,   max: 0.3,  step: 0.01, hint: 'Thumb movement around the centre that is ignored. Stops tiny wobbles.' },
  { k: 'radius',      label: 'Stick travel (px)',     min: 30,  max: 100,  step: 1,    hint: 'How far the thumb moves for full deflection. Bigger = finer control, more thumb travel.' },
  { k: 'assistLane',  label: 'Assist: lane hold',     min: 0,   max: 1.5,  step: 0.05, hint: 'How strongly the car steers itself along the track when you ease off. Needs ASSIST on.' },
  { k: 'assistSpeed', label: 'Assist: corner speed',  min: 0.8, max: 1.5,  step: 0.02, hint: 'Higher lets you carry more speed into corners before the assist slows you. Needs ASSIST on.' }
];
function overridesFor(lv) {
  const pr = Profile.data.settings.presets;
  if (!pr[lv] || pr[lv].pv !== PRESET_VERSION) pr[lv] = { pv: PRESET_VERSION, tune: {}, assist: null };
  return pr[lv];
}
let level = LEVELS[Profile.data.settings.level] ? Profile.data.settings.level : 'veteran';
const tune = {};
function loadLevel(name) {
  level = name; Profile.data.settings.level = name;
  const ov = overridesFor(name).tune;
  TUNE_DEFS.forEach(d => { const v = ov[d.k]; tune[d.k] = typeof v === 'number' && isFinite(v) ? clamp(v, d.min, d.max) : LEVELS[name].tune[d.k]; });
}
function setTuneValue(k, v) {
  tune[k] = v; const ov = overridesFor(level);
  if (v === LEVELS[level].tune[k]) delete ov.tune[k]; else ov.tune[k] = v;
  Profile.save();
}
const levelAssist = () => { const a = overridesFor(level).assist; return a === null ? LEVELS[level].assist : a; };
loadLevel(level);
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function stickMove(e) {
  const zr = stickZone.getBoundingClientRect();
  const h = stickEl.offsetWidth / 2;
  let dx = e.clientX - zr.left - stick.ox, dy = e.clientY - zr.top - stick.oy;
  const R = tune.radius, d = Math.hypot(dx, dy);
  if (d > R) {
    // the base trails the thumb, so reversing a flick never means travelling back across the whole stick
    const pull = (d - R) / d;
    stick.ox = Math.min(Math.max(stick.ox + dx * pull, h), zr.width - h);
    stick.oy = Math.min(Math.max(stick.oy + dy * pull, h), zr.height - h);
    stickEl.style.left = (stick.ox - h) + 'px'; stickEl.style.top = (stick.oy - h) + 'px';
    dx = e.clientX - zr.left - stick.ox; dy = e.clientY - zr.top - stick.oy;
    const d2 = Math.hypot(dx, dy);
    if (d2 > R) { dx *= R / d2; dy *= R / d2; }
  }
  const nx = dx / R, ny = dy / R, m = Math.hypot(nx, ny), dz = tune.dead;
  const k = m < dz ? 0 : (m - dz) / (1 - dz) / m;
  stick.x = nx * k; stick.y = ny * k;
  knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}
function stickRelease() {
  stick.id = null; stick.x = stick.y = 0;
  stickEl.classList.remove('on'); stickEl.style.left = stickEl.style.top = stickEl.style.bottom = ''; knobEl.style.transform = '';
}
stickZone.addEventListener('pointerdown', e => {
  if (stick.id !== null) return;
  e.preventDefault(); initAudio();
  const zr = stickZone.getBoundingClientRect(), h = stickEl.offsetWidth / 2;
  stick.id = e.pointerId;
  stick.ox = Math.min(Math.max(e.clientX - zr.left, h), zr.width - h);
  stick.oy = Math.min(Math.max(e.clientY - zr.top, h), zr.height - h);
  stickEl.style.left = (stick.ox - h) + 'px'; stickEl.style.top = (stick.oy - h) + 'px'; stickEl.style.bottom = 'auto';
  stickEl.classList.add('on');
  try { stickZone.setPointerCapture(e.pointerId); } catch (_) {}
  stickMove(e);
});
stickZone.addEventListener('pointermove', e => { if (e.pointerId === stick.id) { e.preventDefault(); stickMove(e); } });
const stickEnd = e => { if (e.pointerId === stick.id) stickRelease(); };
stickZone.addEventListener('pointerup', stickEnd); stickZone.addEventListener('pointercancel', stickEnd); stickZone.addEventListener('lostpointercapture', stickEnd);
stickZone.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!(e.target.closest && e.target.closest('.overlay, .tune'))) e.preventDefault(); }, { passive: false });
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) padEl.classList.add('avail');
window.addEventListener('touchstart', () => padEl.classList.add('avail'), { once: true, passive: true });
const has = a => keys.has(a) || touch.has(a);
function readInput(dt) {
  const kb = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
  // stick steering: response curve, lock cap and speed damping (all tunable), keys stay binary
  const ax = Math.min(1, Math.abs(stick.x));
  let sx = Math.sign(stick.x) * Math.min(tune.maxLock, tune.gain * Math.pow(ax, tune.curve));
  if (sx) sx *= 1 - tune.speedDamp * clamp(Math.hypot(S.player.vx, S.player.vy) / 372, 0, 1);
  const target = kb || sx;
  const rate = kb ? (target === 0 ? 14 : 9) : tune.rate;   // a thumb is already a smooth input, so the stick needs less smoothing than a key press
  input.steer += (target - input.steer) * Math.min(1, dt * rate);
  if (Math.abs(input.steer) < 0.01) input.steer = 0;
  // left thumb down = foot down, always. Braking/reversing is the separate BRAKE button.
  input.thr = has('gas') || (stick.id !== null && !has('brake')) ? 1 : 0;
  input.brk = has('brake') ? 1 : 0;
  input.fire = has('fire') ? 1 : 0;
  S.tune.assistLane = tune.assistLane; S.tune.assistSpeed = tune.assistSpeed;
}

/* ---------- ui ---------- */
const hud = $('hud'), menu = $('menu'), endEl = $('end'), toasts = $('toasts'), cdEl = $('cd');
const posEl = $('pos'), lapEl = $('lap'), hpEl = $('hp'), hpn = $('hpn'), wname = $('wname'), wammo = $('wammo'), wpn = $('wpn');
const sndBtn = $('snd');
const ord = n => n + (['TH', 'ST', 'ND', 'RD'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
const overlayOpen = () => !menu.hidden || !endEl.hidden;
function toggleMute() { muted = !muted; sndBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON'; sndBtn.setAttribute('aria-pressed', String(!muted)); if (AC) { if (muted) AC.suspend(); else AC.resume(); } }
sndBtn.addEventListener('click', toggleMute);
const assistBtns = [$('assistHud'), $('assistMenu'), $('assistTune')], levelBtns = document.querySelectorAll('[data-level]');
let tuneReady = false;
function showAssist() {
  const on = !!S.assist;
  assistBtns[0].textContent = assistBtns[2].textContent = on ? 'ASSIST ON' : 'ASSIST OFF'; assistBtns[1].textContent = 'DRIVING ASSIST: ' + (on ? 'ON' : 'OFF');
  assistBtns.forEach(b => b.setAttribute('aria-pressed', String(on)));
  if (tuneReady) tuneOut.value = tuneText();
}
function showLevel() {
  levelBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
  $('levelBlurb').textContent = LEVELS[level].blurb;
}
function setAssist(on) {
  S.assist = on;
  overridesFor(level).assist = on === LEVELS[level].assist ? null : on; Profile.save();   // only a deliberate difference is remembered
  showAssist();
}
function setLevel(name, persist) {
  if (!LEVELS[name]) return;
  loadLevel(name); if (persist !== false) Profile.save();
  S.assist = levelAssist(); showAssist(); showLevel();
  if (tuneReady) syncTune();
}
assistBtns.forEach(b => b.addEventListener('click', () => setAssist(!S.assist)));
levelBtns.forEach(b => b.addEventListener('click', () => setLevel(b.dataset.level)));
S.assist = levelAssist(); showAssist(); showLevel();
function toast(text, cls) {
  while (toasts.children.length > 3) toasts.firstChild.remove();
  const d = document.createElement('div'); d.className = 'toast' + (cls ? ' ' + cls : ''); d.textContent = text;
  d.addEventListener('animationend', () => d.remove()); toasts.appendChild(d);
}
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
let overTimer = 0, lastCdText = '';

/* ---------- steering lab ---------- */
const tuneEl = $('tune'), tuneBody = $('tuneBody'), tuneOut = $('tuneOut'), tuneBtn = $('tuneBtn'), labExitBtn = $('labExit');
const lab = { lap: -1, t0: null, last: null, best: null, touches0: 0, prevHits: null };
function tuneText() {
  const o = { level }; TUNE_DEFS.forEach(d => { o[d.k] = +tune[d.k].toFixed(3); }); o.assist = S.assist ? 'on' : 'off';
  return JSON.stringify(o);
}
function refreshTune() {
  TUNE_DEFS.forEach(d => {
    const v = tune[d.k], def = LEVELS[level].tune[d.k], el = $('tv_' + d.k);
    el.firstChild.nodeValue = String(+v.toFixed(2));
    el.lastChild.textContent = v === def ? 'default' : 'default ' + def;
  });
  stickEl.style.width = stickEl.style.height = (2 * tune.radius + 36) + 'px';
  tuneOut.value = tuneText();
}
function syncTune() { TUNE_DEFS.forEach(d => { $('t_' + d.k).value = tune[d.k]; }); refreshTune(); }
TUNE_DEFS.forEach(d => {
  const row = document.createElement('div'); row.className = 'trow';
  row.innerHTML = '<label for="t_' + d.k + '"><span>' + d.label + '</span><b id="tv_' + d.k + '">0<i></i></b></label>' +
    '<input type="range" id="t_' + d.k + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '"><small>' + d.hint + '</small>';
  tuneBody.appendChild(row);
  const inp = row.querySelector('input'); inp.value = tune[d.k];
  inp.addEventListener('input', () => { setTuneValue(d.k, +inp.value); refreshTune(); });
});
$('tuneReset').addEventListener('click', () => {   // back to this level's defaults
  const ov = overridesFor(level); ov.tune = {}; ov.assist = null; Profile.save();
  loadLevel(level); S.assist = levelAssist(); showAssist(); syncTune();
});
$('tuneCopy').addEventListener('click', () => {
  tuneOut.value = tuneText(); tuneOut.focus(); tuneOut.select();
  const b = $('tuneCopy'), done = ok => { b.textContent = ok ? 'COPIED' : 'SELECTED'; setTimeout(() => { b.textContent = 'COPY'; }, 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tuneOut.value).then(() => done(true), () => done(false)); else done(false);
});
function openTune(open) { tuneEl.hidden = !open; if (open) refreshTune(); }
tuneBtn.addEventListener('click', () => openTune(tuneEl.hidden));
$('tuneClose').addEventListener('click', () => openTune(false));
refreshTune();
// Lap timing: prog counts track samples, so floor(prog / N) is the lap index (-1 = still behind the start line).
function labTrack() {
  const P = S.player, lapNo = Math.floor(P.prog / N);
  if (lapNo > lab.lap) {
    if (lab.t0 !== null) { lab.last = S.t - lab.t0; lab.best = lab.best === null ? lab.last : Math.min(lab.best, lab.last); lab.prevHits = S.touches - lab.touches0; }
    lab.t0 = S.t; lab.touches0 = S.touches; lab.lap = lapNo;
  } else if (lapNo < lab.lap) { lab.lap = lapNo; lab.t0 = null; }   // reversed over the line: this lap doesn't count
}
const setTxt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
function labHud() {
  setTxt(lapEl, String(Math.max(1, Math.floor(S.player.prog / N) + 1)));
  const lt = t => t === null ? '\u2014' : t.toFixed(1) + ' s';
  setTxt($('lsLast'), lt(lab.last)); setTxt($('lsBest'), lt(lab.best));
  const cur = S.touches - lab.touches0;
  setTxt($('lsHits'), cur + (lab.prevHits === null ? '' : '  (last lap ' + lab.prevHits + ')'));
}
function setLab(on) {
  hud.classList.toggle('lab', on); padEl.classList.toggle('lab', on);
  tuneBtn.hidden = labExitBtn.hidden = !on;
  if (on) { padEl.classList.add('avail'); openTune(true); } else openTune(false);
}
function exitLab() {
  setLab(false); reset(S, 'attract');
  stickRelease(); input.steer = input.thr = input.brk = input.fire = 0;
  hud.hidden = true; padEl.classList.remove('live'); endEl.hidden = true; menu.hidden = false;
}
labExitBtn.addEventListener('click', exitLab); $('tuneExit').addEventListener('click', exitLab);
tuneReady = true; showAssist();
$('labBtn').addEventListener('click', () => startRace('lab'));

function startRace(mode) {
  if (typeof mode !== 'string') mode = 'race';   // used directly as a click/key handler
  initAudio();
  clearTimeout(overTimer);
  setLab(mode === 'lab');
  if (mode === 'lab') { Object.assign(lab, { lap: -1, t0: null, last: null, best: null, touches0: 0, prevHits: null }); }
  reset(S, mode);
  input.steer = input.thr = input.brk = input.fire = 0;
  menu.hidden = true; endEl.hidden = true; hud.hidden = false; padEl.classList.add('live'); toasts.textContent = '';
  cam.x = S.player.x; cam.y = S.player.y; cam.a = S.player.a; focus = S.player; hurtFlash = 0;
}
$('start').addEventListener('click', startRace);
$('again').addEventListener('click', startRace);
function showEnd() {
  const r = S.result; if (!r) return;
  let kick, head;
  if (r.kind === 'finish') { kick = 'CHEQUERED FLAG'; head = r.place === 1 ? 'YOU WIN' : r.place <= 3 ? 'PODIUM' : 'CROSSED THE LINE'; }
  else if (r.kind === 'last') { kick = 'NOBODY LEFT TO RACE'; head = 'LAST CAR STANDING'; }
  else { kick = 'HULL AT ZERO'; head = 'WRECKED'; }
  $('endKick').textContent = kick; $('endHead').textContent = head;
  $('stPlace').textContent = r.kind === 'wrecked' ? '—' : ord(r.place);
  $('stKills').textContent = r.kills; $('stTime').textContent = fmtTime(r.time);
  $('stTimeLab').textContent = r.kind === 'finish' ? 'RACE TIME' : 'SURVIVED';
  hud.hidden = true; padEl.classList.remove('live'); stickRelease(); endEl.hidden = false; $('again').focus({ preventScroll: true });
}
function handleEvents() {
  for (const e of S.events) {
    switch (e.t) {
      case 'tick': tone(520, 0.14, 'square', 0.1); break;
      case 'go': tone(880, 0.4, 'square', 0.13); break;
      case 'shot': {
        const v = vol(e.x, e.y);
        if (e.w === 'mg') tone(240, 0.07, 'sawtooth', 0.07 * v, -120);
        else if (e.w === 'rocket') { noise(0.35, 0.16 * v, 2400); tone(180, 0.3, 'sawtooth', 0.07 * v, -100); }
        else tone(300, 0.12, 'triangle', 0.1 * v, -150);
        break; }
      case 'boom': noise(0.7, 0.45 * vol(e.x, e.y), 1400); break;
      case 'hit': tone(900, 0.04, 'square', 0.05 * vol(e.x, e.y)); break;
      case 'crash': noise(0.18, 0.2, 700); break;
      case 'hurt': hurtFlash = Math.min(1, hurtFlash + 0.3 + e.amt * 0.02); break;
      case 'pickup':
        if (e.car.isPlayer && !S.attract) { toast('+ ' + e.label, 'good'); tone(660, 0.1, 'square', 0.1); setTimeout(() => tone(990, 0.12, 'square', 0.1), 80); }
        break;
      case 'empty': toast('OUT OF AMMO'); break;
      case 'kill': {
        if (S.attract) break;
        const k = e.killer, v = e.victim;
        noise(0.9, 0.5 * vol(e.x, e.y), 1200);
        if (v.isPlayer) toast(k ? k.name + ' WRECKED YOU' : 'YOU CRASHED OUT', 'bad');
        else if (k && k.isPlayer) toast('YOU WRECKED ' + v.name, 'good');
        else toast(k ? k.name + ' WRECKED ' + v.name : v.name + ' CRASHED OUT');
        break; }
      case 'finish': if (!e.car.isPlayer && !S.attract) toast(e.car.name + ' FINISHED ' + ord(e.car.place)); break;
      case 'over': clearTimeout(overTimer); overTimer = setTimeout(showEnd, e.kind === 'wrecked' ? 500 : 1100); break;
    }
  }
  S.events.length = 0;
}
let hurtFlash = 0, focus = S.player;
let lastPos = -1, lastLap = '', lastHp = -1, lastW = '';
function updateHud() {
  if (S.lab) { labHud(); return; }
  const P = S.player, rank = ranking(S), pos = rank.indexOf(P) + 1;
  if (pos !== lastPos) { lastPos = pos; posEl.innerHTML = pos + '<sup>' + ord(pos).slice(String(pos).length) + '</sup>'; }
  const lap = clamp(Math.floor(P.prog / N) + 1, 1, LAPS) + '/' + LAPS;
  if (lap !== lastLap) { lastLap = lap; lapEl.textContent = lap; }
  const hp = Math.max(0, Math.round(P.hp));
  if (hp !== lastHp) {
    lastHp = hp; hpEl.style.width = hp + '%'; hpn.textContent = hp;
    hpEl.style.background = hp > 55 ? 'var(--cool)' : hp > 28 ? 'var(--gold)' : 'var(--hot)';
  }
  const w = P.weapon ? WEAP[P.weapon].name + '|' + P.ammo : 'none';
  if (w !== lastW) {
    lastW = w;
    if (P.weapon) { wname.textContent = WEAP[P.weapon].name; wammo.textContent = '×' + P.ammo; wpn.classList.add('armed'); }
    else { wname.textContent = 'NO WEAPON'; wammo.textContent = ''; wpn.classList.remove('armed'); }
    padEl.classList.toggle('armed', !!P.weapon);
  }
  let cd = '';
  if (S.state === 'countdown') cd = String(Math.max(1, Math.ceil(S.cd - 0.4)));
  else if (S.state === 'race' && S.raceT < 0.9) cd = 'GO!';
  if (cd !== lastCdText) { lastCdText = cd; cdEl.textContent = cd; cdEl.classList.toggle('go', cd === 'GO!'); cdEl.hidden = !cd; }
}

/* ---------- drawing helpers ---------- */
const FELT = '#16342d';
const ROAD = [66, 72, 87], ROAD2 = [58, 64, 79];
const WALL_TOP = [238, 242, 247], WALL_SIDE = [190, 202, 218];
const rgb = (c, f) => 'rgb(' + ((c[0] * f) | 0) + ',' + ((c[1] * f) | 0) + ',' + ((c[2] * f) | 0) + ')';

function proj(wx, wy, h) {
  const dx = wx - cam.x, dy = wy - cam.y;
  const fwd = dx * cam.c + dy * cam.s, lat = -dx * cam.s + dy * cam.c;
  const p = 1 / (1 + fwd * K);
  return [W * 0.5 + lat * p * Z, baseY - (fwd * TILT + h) * p * Z, p, fwd];
}
function poly(pts, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.stroke(); }
}
function prism(pts, h0, h1, topCol, sideCol) {
  const n = pts.length; let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; }
  cx /= n; cy /= n;
  const base = new Array(n), top = new Array(n);
  for (let i = 0; i < n; i++) { base[i] = proj(pts[i][0], pts[i][1], h0); top[i] = proj(pts[i][0], pts[i][1], h1); }
  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = pts[i], b = pts[j];
    let nx = b[1] - a[1], ny = a[0] - b[0];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (nx * (cam.x - mx) + ny * (cam.y - my) <= 0) continue;
    const fN = nx * cam.c + ny * cam.s, lN = -nx * cam.s + ny * cam.c;
    faces.push({ i, j, d: base[i][3] + base[j][3], f: clamp(0.8 - 0.22 * lN + 0.1 * fN, 0.5, 1.05) });
  }
  faces.sort((p, q) => q.d - p.d);
  for (const f of faces) poly([base[f.i], base[f.j], top[f.j], top[f.i]], rgb(sideCol, f.f), true);
  poly(top, rgb(topCol, 1), true);
}

/* ---------- world content ---------- */
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PROP_COLS = [[230, 80, 70], [250, 200, 60], [70, 130, 230], [245, 245, 240], [255, 140, 40], [120, 200, 120], [200, 110, 220]];
const props = [];
(function () {
  const R = rng(7);
  let tries = 0;
  while (props.length < 170 && tries++ < 4000) {
    const i = Math.floor(R() * N), side = R() < 0.5 ? -1 : 1, off = HALF_W + 40 + R() * 300;
    const x = T.x[i] + T.nx[i] * side * off, y = T.y[i] + T.ny[i] * side * off;
    let ok = true;
    for (let k = 0; k < N; k++) { if (Math.hypot(T.x[k] - x, T.y[k] - y) < HALF_W + 46) { ok = false; break; } }
    if (!ok) continue;
    for (const q of props) if (Math.hypot(q.x - x, q.y - y) < 60) { ok = false; break; }
    if (!ok) continue;
    const kind = R(), a = R() * 6.283, col = PROP_COLS[Math.floor(R() * PROP_COLS.length)];
    let hw, hl, h, pts;
    if (kind < 0.35) { hw = hl = 10 + R() * 8; h = hw * 2; }
    else if (kind < 0.65) { hw = 4; hl = 22 + R() * 14; h = 8; }
    else if (kind < 0.85) { hw = 14 + R() * 12; hl = 12 + R() * 10; h = 8 + R() * 22; }
    else { hw = hl = 15; h = 4; }
    const f = Math.cos(a), s = Math.sin(a), tr = (lx, ly) => [x + f * lx - s * ly, y + s * lx + f * ly];
    pts = kind >= 0.85
      ? [tr(15, 0), tr(10.6, 10.6), tr(0, 15), tr(-10.6, 10.6), tr(-15, 0), tr(-10.6, -10.6), tr(0, -15), tr(10.6, -10.6)]
      : [tr(hl, -hw), tr(hl, hw), tr(-hl, hw), tr(-hl, -hw)];
    props.push({ x, y, pts, h, col, side: [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75] });
  }
})();

/* ---------- minimap ---------- */
const mini = $('mini'), mctx = mini.getContext('2d'), MS = 200;
const trackImg = document.createElement('canvas'); trackImg.width = trackImg.height = MS;
let mScale = 1, mOx = 0, mOy = 0;
(function () {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); y0 = Math.min(y0, T.y[i]); y1 = Math.max(y1, T.y[i]); }
  const pad = 20; mScale = Math.min((MS - pad * 2) / (x1 - x0), (MS - pad * 2) / (y1 - y0));
  mOx = (MS - (x1 - x0) * mScale) / 2 - x0 * mScale; mOy = (MS - (y1 - y0) * mScale) / 2 - y0 * mScale;
  const g = trackImg.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i <= N; i++) { const k = i % N; const X = T.x[k] * mScale + mOx, Y = T.y[k] * mScale + mOy; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.closePath(); };
  path(); g.strokeStyle = 'rgba(239,233,216,.5)'; g.lineWidth = 11; g.stroke();
  path(); g.strokeStyle = '#1d2b28'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#efe9d8'; const sx = T.x[0] * mScale + mOx, sy = T.y[0] * mScale + mOy;
  g.save(); g.translate(sx, sy); g.rotate(T.ang[0]); g.fillRect(-1.5, -8, 3, 16); g.restore();
})();
function drawMini() {
  mctx.clearRect(0, 0, MS, MS); mctx.drawImage(trackImg, 0, 0);
  for (const c of S.cars) {
    const X = c.x * mScale + mOx, Y = c.y * mScale + mOy;
    if (!c.alive) { mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = 2; mctx.beginPath(); mctx.moveTo(X - 4, Y - 4); mctx.lineTo(X + 4, Y + 4); mctx.moveTo(X + 4, Y - 4); mctx.lineTo(X - 4, Y + 4); mctx.stroke(); continue; }
    mctx.beginPath(); mctx.arc(X, Y, c.isPlayer ? 8 : 5.5, 0, 6.283);
    mctx.fillStyle = rgb(c.color, 1); mctx.fill();
    if (c.isPlayer) { mctx.lineWidth = 3; mctx.strokeStyle = '#fff'; mctx.stroke(); }
  }
}

/* ---------- scene ---------- */
const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let frameNo = 0;
const stamp = new Int32Array(N), PL = new Array(N), PR = new Array(N), KL = new Array(N), KR = new Array(N);
function ensure(i) {
  if (stamp[i] === frameNo) return; stamp[i] = frameNo;
  const x = T.x[i], y = T.y[i], nx = T.nx[i], ny = T.ny[i];
  PL[i] = proj(x - nx * HALF_W, y - ny * HALF_W, 0); PR[i] = proj(x + nx * HALF_W, y + ny * HALF_W, 0);
  KL[i] = proj(x - nx * (HALF_W - 14), y - ny * (HALF_W - 14), 0); KR[i] = proj(x + nx * (HALF_W - 14), y + ny * (HALF_W - 14), 0);
}
const vis = [], objs = [];
function drawWallSeg(i) {
  const j = (i + 1) % N;
  for (let sg = -1; sg <= 1; sg += 2) {
    const A = [T.x[i] + T.nx[i] * sg * HALF_W, T.y[i] + T.ny[i] * sg * HALF_W], B = [T.x[j] + T.nx[j] * sg * HALF_W, T.y[j] + T.ny[j] * sg * HALF_W];
    const C = [T.x[j] + T.nx[j] * sg * (HALF_W + 9), T.y[j] + T.ny[j] * sg * (HALF_W + 9)], D = [T.x[i] + T.nx[i] * sg * (HALF_W + 9), T.y[i] + T.ny[i] * sg * (HALF_W + 9)];
    prism([A, B, C, D], 0, 13, WALL_TOP, WALL_SIDE);
  }
}
function drawCar(c) {
  const f = Math.cos(c.a), s = Math.sin(c.a);
  const tr = (lx, ly) => [c.x + f * lx - s * ly, c.y + s * lx + f * ly];
  const dead = !c.alive;
  let body = dead ? [48, 44, 44] : c.color;
  if (c.flash > 0) { const m = c.flash / 0.14; body = [body[0] + (255 - body[0]) * m, body[1] + (255 - body[1]) * m, body[2] + (255 - body[2]) * m]; }
  // shadow
  const sh = [tr(16, -9), tr(16, 9), tr(-16, 9), tr(-16, -9)].map(p => proj(p[0], p[1], 0));
  const so = sh[0][2] * Z;
  ctx.beginPath(); sh.forEach((p, i) => i ? ctx.lineTo(p[0] + 4 * so, p[1] + 3 * so) : ctx.moveTo(p[0] + 4 * so, p[1] + 3 * so)); ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();
  // wheels
  for (const w of [[9, -8.5], [9, 8.5], [-9, -8.5], [-9, 8.5]]) prism([tr(w[0] - 3.4, w[1] - 1.7), tr(w[0] + 3.4, w[1] - 1.7), tr(w[0] + 3.4, w[1] + 1.7), tr(w[0] - 3.4, w[1] + 1.7)], 0, 5.5, [26, 26, 30], [16, 16, 20]);
  // chassis, cabin, spoiler
  prism([tr(15, -4), tr(11, -8), tr(-13, -8), tr(-15, -6), tr(-15, 6), tr(-13, 8), tr(11, 8), tr(15, 4)], 2, 7, body, body);
  if (!dead) {
    const st = [tr(14.5, -1.4), tr(14.5, 1.4), tr(-14, 1.4), tr(-14, -1.4)].map(p => proj(p[0], p[1], 7.05));
    poly(st, 'rgba(255,255,255,.85)');
  }
  prism([tr(5, -5), tr(5, 5), tr(-7, 5.6), tr(-7, -5.6)], 7, 12, dead ? [30, 28, 28] : [86, 112, 150], dead ? [24, 22, 22] : [34, 44, 64]);
  prism([tr(-14.5, -8.5), tr(-11.5, -8.5), tr(-11.5, 8.5), tr(-14.5, 8.5)], 7, 10.5, body, body);
  if (!dead) {
    for (const ly of [-5.5, 5.5]) { const hp = proj(tr(15.5, ly)[0], tr(15.5, ly)[1], 5); ctx.fillStyle = '#fff6c8'; const r = 1.9 * hp[2] * Z; ctx.fillRect(hp[0] - r, hp[1] - r, r * 2, r * 2); }
    for (const ly of [-6, 6]) { const tp = tr(-15.5, ly), hp = proj(tp[0], tp[1], 5); ctx.fillStyle = '#ff2d20'; const r = 1.5 * hp[2] * Z; ctx.fillRect(hp[0] - r, hp[1] - r, r * 2, r * 2); }
  }
  if (!dead && c.isPlayer) {
    const m = proj(c.x, c.y, 30 + Math.sin(S.t * 6) * 1.5), q = 5.5 * m[2] * Z;
    ctx.beginPath(); ctx.moveTo(m[0] - q, m[1] - q * 1.1); ctx.lineTo(m[0] + q, m[1] - q * 1.1); ctx.lineTo(m[0], m[1] + q * 0.5); ctx.closePath();
    ctx.fillStyle = '#ffd640'; ctx.fill(); ctx.strokeStyle = '#0c1816'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (!dead && !c.isPlayer) {
    const b = proj(c.x, c.y, 27), w = 32 * b[2] * Z, h = 4 * b[2] * Z + 1;
    ctx.fillStyle = 'rgba(8,16,14,.75)'; ctx.fillRect(b[0] - w / 2 - 1, b[1] - h - 1, w + 2, h + 2);
    ctx.fillStyle = c.hp > 55 ? '#5ec8f2' : c.hp > 28 ? '#ffd640' : '#ff5a36'; ctx.fillRect(b[0] - w / 2, b[1] - h, w * c.hp / 100, h);
  }
}
function drawCrate(cr) {
  const bob = Math.sin(S.t * 3 + cr.idx) * 2.5, a = S.t * 1.4 + cr.idx, f = Math.cos(a), s = Math.sin(a), r = 8.5;
  const g = proj(cr.x, cr.y, 0);
  ctx.beginPath(); ctx.ellipse(g[0], g[1], Math.max(0, 17 * g[2] * Z), Math.max(0, 17 * g[2] * Z * TILT), 0, 0, 6.283);
  ctx.strokeStyle = 'rgba(255,214,64,.55)'; ctx.lineWidth = 2; ctx.stroke();
  prism([[cr.x + f * r - s * r, cr.y + s * r + f * r], [cr.x - f * r - s * r, cr.y - s * r + f * r], [cr.x - f * r + s * r, cr.y - s * r - f * r], [cr.x + f * r + s * r, cr.y + s * r - f * r]], 6 + bob, 19 + bob, [255, 214, 64], [214, 160, 30]);
  const t = proj(cr.x, cr.y, 19 + bob); ctx.fillStyle = '#3a2a00'; ctx.font = '700 ' + Math.max(8, 13 * t[2] * Z) + 'px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', t[0], t[1]);
}
function drawMine(m) {
  const g = proj(m.x, m.y, 2), rr = Math.max(0, 10 * g[2] * Z);
  ctx.beginPath(); ctx.ellipse(g[0], g[1], rr, rr * TILT, 0, 0, 6.283); ctx.fillStyle = '#23262c'; ctx.fill(); ctx.strokeStyle = '#6a707c'; ctx.lineWidth = 2; ctx.stroke();
  const on = m.arm <= 0 ? (Math.sin(S.t * 8) > 0) : (Math.sin(S.t * 24) > 0);
  ctx.beginPath(); ctx.arc(g[0], g[1] - 2 * g[2] * Z, Math.max(0, 2.6 * g[2] * Z), 0, 6.283); ctx.fillStyle = on ? '#ff3b2a' : '#5a1a14'; ctx.fill();
}
function drawRocket(r) {
  const f = Math.cos(r.a), s = Math.sin(r.a), tr = (lx, ly) => [r.x + f * lx - s * ly, r.y + s * lx + f * ly];
  prism([tr(8, -2.2), tr(8, 2.2), tr(-8, 2.2), tr(-8, -2.2)], 5, 9.5, [255, 140, 40], [220, 90, 30]);
  const g = proj(r.x, r.y, 8); ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(0, 9 * g[2] * Z), 0, 6.283); ctx.fillStyle = 'rgba(255,170,60,.3)'; ctx.fill();
}

function render(dt) {
  frameNo++;
  const sh = RM ? 0 : S.shake * S.shake;
  cam.shx = (Math.random() - 0.5) * 22 * sh; cam.shy = (Math.random() - 0.5) * 22 * sh;
  cam.c = Math.cos(cam.a); cam.s = Math.sin(cam.a);
  ctx.setTransform(DPR, 0, 0, DPR, cam.shx * DPR, cam.shy * DPR);
  ctx.fillStyle = FELT; ctx.fillRect(-30, -30, W + 60, H + 60);

  // stitch dots on the felt
  const G = 90, r = 1000, gx0 = Math.floor((cam.x - r) / G), gx1 = Math.ceil((cam.x + r) / G), gy0 = Math.floor((cam.y - r) / G), gy1 = Math.ceil((cam.y + r) / G);
  ctx.fillStyle = 'rgba(130,200,170,.2)';
  for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
    const dx = gx * G - cam.x, dy = gy * G - cam.y, fwd = dx * cam.c + dy * cam.s;
    if (fwd < -260 || fwd > 1000) continue;
    const lat = -dx * cam.s + dy * cam.c; if (Math.abs(lat) > 800) continue;
    const p = 1 / (1 + fwd * K), z = 2.4 * p * Z;
    ctx.fillRect(W * 0.5 + lat * p * Z - z / 2, baseY - fwd * TILT * p * Z - z / 2, z, z);
  }

  // visible track segments
  vis.length = 0;
  for (let i = 0; i < N; i++) {
    const dx = T.x[i] - cam.x, dy = T.y[i] - cam.y, fwd = dx * cam.c + dy * cam.s;
    if (fwd < -300 || fwd > 1050) continue;
    if (Math.abs(-dx * cam.s + dy * cam.c) > 1150) continue;
    vis.push(i);
  }
  for (const i of vis) { ensure(i); ensure((i + 1) % N); }
  for (const i of vis) { const j = (i + 1) % N; poly([PL[i], PR[i], PR[j], PL[j]], rgb(ROAD, 1), true); }
  for (const i of vis) if ((i >> 2) & 1) { const j = (i + 1) % N; poly([PL[i], PR[i], PR[j], PL[j]], rgb(ROAD2, 1), true); }
  for (const i of vis) {
    const j = (i + 1) % N, red = (i >> 1) & 1, col = red ? 'rgb(222,70,60)' : 'rgb(238,232,216)';
    poly([KL[i], PL[i], PL[j], KL[j]], col, true); poly([KR[i], PR[i], PR[j], KR[j]], col, true);
  }
  ctx.fillStyle = 'rgba(238,232,216,.8)';
  for (const i of vis) if ((i & 3) < 2) {
    const j = (i + 1) % N;
    poly([proj(T.x[i] - T.nx[i] * 1.8, T.y[i] - T.ny[i] * 1.8, 0), proj(T.x[i] + T.nx[i] * 1.8, T.y[i] + T.ny[i] * 1.8, 0), proj(T.x[j] + T.nx[j] * 1.8, T.y[j] + T.ny[j] * 1.8, 0), proj(T.x[j] - T.nx[j] * 1.8, T.y[j] - T.ny[j] * 1.8, 0)], 'rgba(238,232,216,.8)');
  }
  for (let row = 0; row < 2; row++) {
    const i = row, j = row + 1;
    const dx = T.x[i] - cam.x, dy = T.y[i] - cam.y, fwd = dx * cam.c + dy * cam.s;
    if (fwd < -300 || fwd > 1050) continue;
    const cells = 12, w = (HALF_W - 14) * 2 / cells;
    for (let c = 0; c < cells; c++) {
      const a = -(HALF_W - 14) + c * w, b = a + w;
      poly([proj(T.x[i] + T.nx[i] * a, T.y[i] + T.ny[i] * a, 0), proj(T.x[i] + T.nx[i] * b, T.y[i] + T.ny[i] * b, 0), proj(T.x[j] + T.nx[j] * b, T.y[j] + T.ny[j] * b, 0), proj(T.x[j] + T.nx[j] * a, T.y[j] + T.ny[j] * a, 0)], ((c + row) & 1) ? 'rgb(28,32,38)' : 'rgb(244,242,234)', true);
    }
  }

  // sorted objects
  objs.length = 0;
  const dep = (x, y) => (x - cam.x) * cam.c + (y - cam.y) * cam.s;
  for (const i of vis) objs.push({ d: dep((T.x[i] + T.x[(i + 1) % N]) / 2, (T.y[i] + T.y[(i + 1) % N]) / 2), t: 0, o: i });
  for (const p of props) { const d = dep(p.x, p.y); if (d > -240 && d < 1050 && Math.abs(-(p.x - cam.x) * cam.s + (p.y - cam.y) * cam.c) < 1100) objs.push({ d, t: 1, o: p }); }
  for (const c of S.cars) if (c.alive || c.wreck > 0) { const d = dep(c.x, c.y); if (d > -260 && d < 1050) objs.push({ d, t: 2, o: c }); }
  for (const cr of S.crates) if (cr.cd <= 0) { const d = dep(cr.x, cr.y); if (d > -260 && d < 1050) objs.push({ d, t: 3, o: cr }); }
  for (const m of S.mines) { const d = dep(m.x, m.y); if (d > -260 && d < 1050) objs.push({ d: d + 6, t: 4, o: m }); }
  for (const rk of S.rockets) { const d = dep(rk.x, rk.y); if (d > -260 && d < 1050) objs.push({ d, t: 5, o: rk }); }
  objs.sort((a, b) => b.d - a.d);
  for (const ob of objs) {
    switch (ob.t) {
      case 0: drawWallSeg(ob.o); break;
      case 1: prism(ob.o.pts, 0, ob.o.h, ob.o.col, ob.o.side); break;
      case 2: drawCar(ob.o); break;
      case 3: drawCrate(ob.o); break;
      case 4: drawMine(ob.o); break;
      case 5: drawRocket(ob.o); break;
    }
  }

  // shockwaves
  for (const rg of S.rings) {
    const g = proj(rg.x, rg.y, 2);
    if (g[3] < -260 || g[3] > 1050) continue;   // behind/far from the camera the perspective scale goes negative
    const rr = Math.max(0, rg.r * g[2] * Z);
    ctx.beginPath(); ctx.ellipse(g[0], g[1], rr, rr * TILT, 0, 0, 6.283);
    ctx.strokeStyle = 'rgba(255,230,180,' + (0.7 * rg.t / rg.life) + ')'; ctx.lineWidth = 4 * (rg.t / rg.life) + 1; ctx.stroke();
  }
  // bullets
  ctx.lineCap = 'round';
  for (const b of S.bullets) {
    const a = proj(b.x, b.y, 8), c = proj(b.x - b.vx * 0.022, b.y - b.vy * 0.022, 8);
    ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = Math.max(1.5, 2.6 * a[2] * Z);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
  }
  // particles
  for (const p of S.parts) {
    const g = proj(p.x, p.y, p.h); if (g[3] < -280 || g[3] > 1050) continue;
    const t = p.life / p.max;
    let sz = p.size * g[2] * Z;
    if (p.kind === 1) { sz *= 1.4 - t * 0.6; ctx.globalAlpha = 0.5 * t; }
    else if (p.kind === 2) { sz *= 0.35 + t * 0.8; ctx.globalAlpha = Math.min(0.8, t * 1.2); ctx.globalCompositeOperation = 'lighter'; }
    else ctx.globalAlpha = Math.min(1, t * 2);
    ctx.fillStyle = 'rgb(' + (p.r | 0) + ',' + (p.g | 0) + ',' + (p.b | 0) + ')';
    if (p.kind === 1 || p.kind === 2) { ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(0, sz), 0, 6.283); ctx.fill(); }
    else ctx.fillRect(g[0] - sz / 2, g[1] - sz / 2, sz, sz);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // distance fade
  const gr = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  gr.addColorStop(0, 'rgba(22,52,45,1)'); gr.addColorStop(0.45, 'rgba(22,52,45,.55)'); gr.addColorStop(1, 'rgba(22,52,45,0)');
  ctx.fillStyle = gr; ctx.fillRect(-30, -30, W + 60, H * 0.42 + 30);

  // damage flash
  if (hurtFlash > 0.01) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    v.addColorStop(0, 'rgba(255,60,40,0)'); v.addColorStop(1, 'rgba(255,60,40,' + (hurtFlash * 0.5) + ')');
    ctx.fillStyle = v; ctx.fillRect(-30, -30, W + 60, H + 60);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ---------- main loop ---------- */
let last = performance.now(), attractT = 0;
function frame(now) {
  // Re-arm first: an exception later in the frame (canvas, audio, DOM) must never end the loop.
  requestAnimationFrame(frame);
  try { tick(now); }
  catch (e) {
    console.error(e);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
const lvParam = /[?&]level=(rookie|veteran)\b/.exec(location.search);
if (lvParam) setLevel(lvParam[1], false);   // for this visit only; not saved
if (/[?&]lab\b/.test(location.search)) startRace('lab');
// Test/debug hook: lets tests and ?debug sessions inspect state without depending on how the code is organised.
if (/[?&]debug\b/.test(location.search)) window.__mm = { S, input, Sim, get tune() { return tune; }, get level() { return level; } };
const dbg = /[?&]debug\b/.test(location.search) ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'dbg' })) : null;
let ft = 16.7, lastAdj = performance.now() + 3000, dbgT = 0, dbgS = 0, dbgN = 0;
function tick(now) {
  const raw = now - last;
  // The sim must stay real-time on slow phones: up to 0.25 s is caught up in <=1/60 s sub-steps (the sim costs ~0.1 ms each).
  const dt = Math.min(0.25, raw / 1000); last = now;
  // Adaptive resolution: if frames are slow, drop the canvas resolution a step (never back up, to avoid flip-flopping).
  if (raw < 250) ft += (raw - ft) * 0.05;
  if (ft > 26 && resStep < RES_STEPS.length - 1 && now - lastAdj > 2500) { resStep++; lastAdj = now; resize(); }
  readInput(dt);
  const subs = Math.max(1, Math.ceil(dt / (1 / 60)));
  for (let k = 0; k < subs; k++) step(S, dt / subs);
  if (S.lab) labTrack();
  handleEvents();
  hurtFlash = Math.max(0, hurtFlash - dt * 2.2);

  // attract mode: restart the demo when too few cars survive
  if (S.attract) {
    attractT += dt;
    if (S.cars.filter(c => c.alive).length < 3 || attractT > 70) { reset(S, 'attract'); attractT = 0; }
  }
  // camera target
  let target = S.player;
  if (S.attract || (!S.player.alive && S.state === 'over')) { const r = ranking(S); target = r.find(c => c.alive) || r[0]; }
  if (target !== focus) { focus = target; cam.x = target.x; cam.y = target.y; cam.a = target.a; }
  const kp = 1 - Math.exp(-16 * dt), ka = 1 - Math.exp(-5 * dt);
  cam.x += (target.x + target.vx * 0.075 - cam.x) * kp; cam.y += (target.y + target.vy * 0.075 - cam.y) * kp;
  cam.a += angDiff(cam.a, target.a) * ka;

  render(dt);
  if (!hud.hidden) { updateHud(); drawMini(); }
  if (eng && AC) {
    const sp = Math.hypot(S.player.vx, S.player.vy), on = !muted && !hud.hidden && S.player.alive && S.state !== 'over';
    eng.o.frequency.setTargetAtTime(52 + sp * 0.26 + (input.thr ? 14 : 0), AC.currentTime, 0.05);
    eng.g.gain.setTargetAtTime(on ? 0.05 : 0, AC.currentTime, 0.1);
  }
  if (dbg) {
    dbgN++;
    if (now - dbgT > 500) {
      const sim = dbgT ? (S.t - dbgS) / ((now - dbgT) / 1000) : 1;
      dbg.textContent = 'fps ' + (dbgN / ((now - dbgT) / 1000)).toFixed(0) + '  frame ' + ft.toFixed(1) + 'ms\nres ' + DPR.toFixed(2) + 'x (' + cv.width + 'x' + cv.height + ')\nsim speed ' + sim.toFixed(2) + 'x  assist ' + (S.assist ? 'on' : 'off');
      dbgT = now; dbgS = S.t; dbgN = 0;
    }
  }
}
requestAnimationFrame(frame);
})();

