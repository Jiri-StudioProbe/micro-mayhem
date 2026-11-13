// The game shell: canvas and camera, audio, input, HUD and overlays, the renderer, and the main loop.
// It reads state from the simulation and writes only to S.input.
// Moved verbatim out of index.html in M0.5a; the audio, profile, levels, diagnostics and version code now live in their own modules,
// the renderer is in src/render/, and the input, UI and game loop are split out in M0.7.
import { Sim } from './sim/sim.js';
import { VERSION, readBuild } from './version.js';
import { createDiag, watchWindow } from './diag.js';
import { createProfile, browserStorage } from './profile.js';
import { LEVELS, TUNE_DEFS, createSettings, isLevel } from './levels.js';
import { createAudio } from './audio.js';
import { createView } from './render/view.js';
import { createDraw } from './render/draw.js';
import { buildProps } from './render/world.js';
import { createMinimap } from './render/minimap.js';
import { createScene } from './render/scene.js';
(() => {
'use strict';
// First, so that anything that goes wrong while starting up is recorded too (shown under ?debug).
const diag = createDiag(); watchWindow(diag, window);
const { T, N, HALF_W, LAPS, WEAP, create, reset, step, ranking, angDiff, clamp } = Sim;
const S = create();
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

// Screen metrics and the camera (src/render/view.js). Canvas resolution steps down automatically on slow devices (see tick()).
const { view, cam, resize, canStepDown, stepDown } = createView({ canvas: cv, coarse: COARSE, startCam: { x: T.x[0], y: T.y[0], a: T.ang[0] } });
window.addEventListener('resize', resize);

/* ---------- audio (src/audio.js) ---------- */
const audio = createAudio({ getPlayer: () => S.player, doc: document });
const { init: initAudio, tone, noise, vol } = audio;

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
/* ---------- profile and levels (src/profile.js, src/levels.js) ---------- */
const Profile = createProfile(browserStorage());
const settings = createSettings(Profile);
const { tune, loadLevel, setTuneValue, levelAssist, overridesFor } = settings;
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
function toggleMute() { audio.setMuted(!audio.muted); sndBtn.textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON'; sndBtn.setAttribute('aria-pressed', String(!audio.muted)); }
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
  levelBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
  $('levelBlurb').textContent = LEVELS[settings.level].blurb;
}
function setAssist(on) {
  S.assist = on;
  overridesFor(settings.level).assist = on === LEVELS[settings.level].assist ? null : on; Profile.save();   // only a deliberate difference is remembered
  showAssist();
}
function setLevel(name, persist) {
  if (!isLevel(name)) return;
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
  const o = { level: settings.level }; TUNE_DEFS.forEach(d => { o[d.k] = +tune[d.k].toFixed(3); }); o.assist = S.assist ? 'on' : 'off';
  return JSON.stringify(o);
}
function refreshTune() {
  TUNE_DEFS.forEach(d => {
    const v = tune[d.k], def = LEVELS[settings.level].tune[d.k], el = $('tv_' + d.k);
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
  const ov = overridesFor(settings.level); ov.tune = {}; ov.assist = null; Profile.save();
  loadLevel(settings.level); S.assist = levelAssist(); showAssist(); syncTune();
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
  cam.x = S.player.x; cam.y = S.player.y; cam.a = S.player.a; focus = S.player; fx.hurtFlash = 0;
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
      case 'hurt': fx.hurtFlash = Math.min(1, fx.hurtFlash + 0.3 + e.amt * 0.02); break;
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
const fx = { hurtFlash: 0 };   // screen effects the shell controls; the renderer reads them
let focus = S.player;
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

/* ---------- renderer (src/render/) ---------- */
const draw = createDraw({ ctx, view, cam });
const props = buildProps({ T, N, HALF_W });
const minimap = createMinimap({ canvas: $('mini'), S, T, N });
const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const { render } = createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion: RM });
const drawMini = minimap.draw;

/* ---------- main loop ---------- */
let last = performance.now(), attractT = 0;
function frame(now) {
  // Re-arm first: an exception later in the frame (canvas, audio, DOM) must never end the loop.
  requestAnimationFrame(frame);
  try { tick(now); }
  catch (e) {
    console.error(e); diag.record('frame', e);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  updateDebug(now);
}
const lvParam = /[?&]level=(rookie|veteran)\b/.exec(location.search);
if (lvParam) setLevel(lvParam[1], false);   // for this visit only; not saved
if (/[?&]lab\b/.test(location.search)) startRace('lab');
// Test/debug hook: lets tests and ?debug sessions inspect state without depending on how the code is organised.
if (/[?&]debug\b/.test(location.search)) window.__mm = { S, input, Sim, diag, VERSION, get build() { return readBuild(document); }, get tune() { return tune; }, get level() { return settings.level; } };
const dbg = /[?&]debug\b/.test(location.search) ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'dbg' })) : null;
let ft = 16.7, lastAdj = performance.now() + 3000, dbgT = 0, dbgS = 0, dbgN = 0;
// The ?debug overlay. Called from frame() outside the try/catch, so it still updates when a frame fails (which is when it matters).
function updateDebug(now) {
  if (!dbg) return;
  dbgN++;
  if (now - dbgT > 500) {
    const sim = dbgT ? (S.t - dbgS) / ((now - dbgT) / 1000) : 1;
    dbg.textContent = 'fps ' + (dbgN / ((now - dbgT) / 1000)).toFixed(0) + '  frame ' + ft.toFixed(1) + 'ms\nres ' + view.DPR.toFixed(2) + 'x (' + cv.width + 'x' + cv.height + ')\nsim speed ' + sim.toFixed(2) + 'x  assist ' + (S.assist ? 'on' : 'off') + '\nv' + VERSION + ' build ' + readBuild(document) + '  errors ' + diag.total + (diag.last ? ': ' + diag.last.message.slice(0, 60) : '');
    dbgT = now; dbgS = S.t; dbgN = 0;
  }
}
function tick(now) {
  const raw = now - last;
  // The sim must stay real-time on slow phones: up to 0.25 s is caught up in <=1/60 s sub-steps (the sim costs ~0.1 ms each).
  const dt = Math.min(0.25, raw / 1000); last = now;
  // Adaptive resolution: if frames are slow, drop the canvas resolution a step (never back up, to avoid flip-flopping).
  if (raw < 250) ft += (raw - ft) * 0.05;
  if (ft > 26 && canStepDown() && now - lastAdj > 2500) { stepDown(); lastAdj = now; }
  readInput(dt);
  const subs = Math.max(1, Math.ceil(dt / (1 / 60)));
  for (let k = 0; k < subs; k++) step(S, dt / subs);
  if (S.lab) labTrack();
  handleEvents();
  fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2.2);

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
  audio.engine(Math.hypot(S.player.vx, S.player.vy), input.thr, !hud.hidden && S.player.alive && S.state !== 'over');
}
requestAnimationFrame(frame);
})();

