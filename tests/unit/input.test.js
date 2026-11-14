import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../../src/input.js';

// A tiny DOM: elements that record listeners, classes and styles, and can be sent events.
class El {
  constructor(id) { this.id = id; this.l = {}; this.cls = new Set(); this.style = {}; this.dataset = {}; this.offsetWidth = 100; this.captured = []; this.children = []; this.classList = { add: c => this.cls.add(c), remove: c => this.cls.delete(c), toggle: (c, on) => (on ? this.cls.add(c) : this.cls.delete(c)), contains: c => this.cls.has(c) }; }
  addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
  fire(t, ev = {}) { const e = { preventDefault() { this.prevented = true; }, target: this, ...ev }; for (const f of this.l[t] || []) f(e); return e; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; }
  setPointerCapture(id) { this.captured.push(id); }
  querySelectorAll() { return this.children; }
}
function makeDom({ coarse = false } = {}) {
  const els = {}; for (const id of ['pad', 'stickZone', 'stick', 'knob']) els[id] = new El(id);
  const brake = new El('brake'); brake.dataset.act = 'brake'; const fire = new El('fire'); fire.dataset.act = 'fire'; els.pad.children = [brake, fire];
  const doc = new El('doc'); doc.getElementById = id => els[id];
  const win = new El('win'); win.matchMedia = () => ({ matches: coarse });
  return { doc, win, els, brake, fire };
}
const TUNE = { gain: 1, curve: 1, maxLock: 1, speedDamp: 0, rate: 1000, dead: 0.1, radius: 50, assistLane: 0.7, assistSpeed: 1.3 };
const deflection = (m, dz = TUNE.dead) => (m - dz) / (1 - dz);   // what the dead zone leaves of a thumb m of the way to full travel
function setup(opts = {}) {
  const dom = makeDom(opts), calls = [];
  const S = { input: { steer: 0, thr: 0, brk: 0, fire: 0 }, player: { vx: 0, vy: 0 }, tune: {}, lab: false };
  const tune = { ...TUNE, ...(opts.tune || {}) };
  const actions = { overlayOpen: () => !!opts.overlay, startRace: () => calls.push('start'), toggleMute: () => calls.push('mute'), exitLab: () => calls.push('exit') };
  const inp = createInput({ S, tune, initAudio: () => calls.push('audio'), win: dom.win, doc: dom.doc });
  inp.connect(actions);
  return { ...dom, S, calls, inp, tune };
}
const key = (t, code) => t.win.fire('keydown', { code });
const keyUp = (t, code) => t.win.fire('keyup', { code });
const down = (t, x, y, id = 1) => t.els.stickZone.fire('pointerdown', { pointerId: id, clientX: x, clientY: y });
const move = (t, x, y, id = 1) => t.els.stickZone.fire('pointermove', { pointerId: id, clientX: x, clientY: y });

test('keys: arrows and WASD steer, gas, brake and fire; releasing a key lets go', () => {
  const t = setup();
  key(t, 'ArrowUp'); key(t, 'KeyD'); key(t, 'Space');
  t.inp.readInput(1 / 60);
  assert.equal(t.S.input.thr, 1); assert.equal(t.S.input.fire, 1); assert.equal(t.S.input.brk, 0); assert.ok(t.S.input.steer > 0);
  keyUp(t, 'ArrowUp'); keyUp(t, 'KeyD'); keyUp(t, 'Space'); key(t, 'KeyS'); key(t, 'KeyA');
  t.inp.readInput(1 / 60);
  assert.equal(t.S.input.thr, 0); assert.equal(t.S.input.fire, 0); assert.equal(t.S.input.brk, 1);
  for (let i = 0; i < 200; i++) t.inp.readInput(1 / 60);
  assert.ok(t.S.input.steer < -0.99, 'a held key steers to full lock');
  assert.ok(t.calls.includes('audio'), 'the first key press wakes the audio');
});

test('Enter or Space starts a race only while a menu is open; M mutes; Escape leaves the lab only in the lab', () => {
  let t = setup({ overlay: true });
  key(t, 'Enter'); key(t, 'Space'); assert.deepEqual(t.calls, ['start', 'start']);
  t.inp.readInput(1 / 60); assert.equal(t.S.input.fire, 0, 'Space started the race instead of firing');
  t = setup({ overlay: false });
  key(t, 'Enter'); assert.deepEqual(t.calls, []);
  key(t, 'Space'); t.inp.readInput(1 / 60); assert.equal(t.S.input.fire, 1, 'in a race Space fires');
  key(t, 'KeyM'); assert.deepEqual(t.calls.filter(c => c !== 'audio'), ['mute']);
  key(t, 'Escape'); assert.ok(!t.calls.includes('exit'));
  t.S.lab = true; key(t, 'Escape'); assert.ok(t.calls.includes('exit'));
});

test('losing focus releases every key and the stick', () => {
  const t = setup();
  key(t, 'ArrowUp'); down(t, 100, 100); t.inp.readInput(0.1);
  assert.equal(t.S.input.thr, 1);
  t.win.fire('blur'); t.inp.readInput(0.1);
  assert.equal(t.S.input.thr, 0); assert.ok(!t.els.stick.cls.has('on'));
});

test('the stick: thumb down is gas; steering follows the thumb; the base trails a thumb that goes past the radius', () => {
  const t = setup();
  const e = down(t, 100, 150);
  assert.equal(e.prevented, true); assert.deepEqual(t.els.stickZone.captured, [1]); assert.ok(t.els.stick.cls.has('on'));
  t.inp.readInput(1 / 60); assert.equal(t.S.input.thr, 1); assert.equal(t.S.input.steer, 0, 'no steering at the centre');
  move(t, 125, 150); t.inp.readInput(1 / 60);
  assert.ok(Math.abs(t.S.input.steer - deflection(0.5)) < 1e-9, `half the radius, gain 1 (${t.S.input.steer})`);
  move(t, 300, 150); t.inp.readInput(1 / 60);
  assert.equal(t.S.input.steer, 1, 'capped at maxLock');
  assert.equal(t.els.stick.style.left, (300 - 50 - 50) + 'px', 'the base (50 wide, so its centre is 50 right of its left edge) trails the thumb at x=300 by exactly one radius');
  move(t, 250 - 25, 150); t.inp.readInput(1 / 60);
  assert.ok(Math.abs(t.S.input.steer + deflection(0.5)) < 1e-9, 'flicking back to the other side needs only half a radius of travel from the base');
  t.els.stickZone.fire('pointerup', { pointerId: 1 }); t.inp.readInput(1 / 60);
  assert.equal(t.S.input.thr, 0, 'thumb up, foot up'); assert.ok(!t.els.stick.cls.has('on')); assert.equal(t.els.stick.style.left, '');
});

test('the stick ignores a second finger, and other pointers\' moves', () => {
  const t = setup();
  down(t, 100, 150, 7); down(t, 300, 150, 8);
  move(t, 130, 150, 8); t.inp.readInput(1 / 60); assert.equal(t.S.input.steer, 0, 'pointer 8 does not steer');
  move(t, 130, 150, 7); t.inp.readInput(1 / 60); assert.ok(t.S.input.steer > 0);
  t.els.stickZone.fire('pointerup', { pointerId: 8 }); t.inp.readInput(1 / 60); assert.equal(t.S.input.thr, 1, 'pointer 8 lifting does not release the stick');
});

test('the response curve, dead zone and speed damping come from the live tune values', () => {
  const t = setup({ tune: { curve: 2, gain: 2, dead: 0.2, maxLock: 0.9, speedDamp: 0.5 } });
  down(t, 100, 150); move(t, 100 + 50 * 0.6, 150);   // 0.6 of the radius: (0.6-0.2)/0.8 = 0.5 after the dead zone
  t.inp.readInput(1);
  assert.ok(Math.abs(t.S.input.steer - Math.min(0.9, 2 * 0.5 ** 2)) < 1e-9, `curve and gain (${t.S.input.steer})`);
  t.S.player.vx = 372; t.inp.readInput(1);
  assert.ok(Math.abs(t.S.input.steer - Math.min(0.9, 2 * 0.5 ** 2) * 0.5) < 1e-9, 'full speed halves the steering at speedDamp 0.5');
  t.tune.gain = 0.4; t.tune.speedDamp = 0; t.inp.readInput(1);
  assert.ok(Math.abs(t.S.input.steer - 0.4 * 0.25) < 1e-9, 'changing the tune takes effect at once');
  t.tune.dead = 0.7; move(t, 100 + 50 * 0.6, 150); t.inp.readInput(1); assert.equal(t.S.input.steer, 0, 'inside a bigger dead zone there is no steering');
});

test('BRAKE: held with the stick it replaces the gas; FIRE is independent; both release cleanly', () => {
  const t = setup();
  down(t, 100, 150); t.inp.readInput(1 / 60); assert.equal(t.S.input.thr, 1);
  t.brake.fire('pointerdown', { pointerId: 2 }); t.fire.fire('pointerdown', { pointerId: 3 });
  t.inp.readInput(1 / 60);
  assert.deepEqual([t.S.input.thr, t.S.input.brk, t.S.input.fire], [0, 1, 1]);
  assert.ok(t.brake.cls.has('on') && t.fire.cls.has('on'));
  t.brake.fire('pointerup', { pointerId: 2 }); t.inp.readInput(1 / 60);
  assert.deepEqual([t.S.input.thr, t.S.input.brk, t.S.input.fire], [1, 0, 1]);
  t.fire.fire('lostpointercapture', { pointerId: 3 }); t.inp.readInput(1 / 60);
  assert.equal(t.S.input.fire, 0); assert.ok(!t.fire.cls.has('on'));
});

test('the assist sliders are copied into the simulation every frame', () => {
  const t = setup();
  t.inp.readInput(1 / 60); assert.deepEqual([t.S.tune.assistLane, t.S.tune.assistSpeed], [0.7, 1.3]);
  t.tune.assistLane = 1.5; t.inp.readInput(1 / 60); assert.equal(t.S.tune.assistLane, 1.5);
});

test('the touch pad appears on a touch screen, or on the first touch', () => {
  let t = setup({ coarse: true }); assert.ok(t.els.pad.cls.has('avail'));
  t = setup({ coarse: false }); assert.ok(!t.els.pad.cls.has('avail'));
  t.win.fire('touchstart'); assert.ok(t.els.pad.cls.has('avail'));
});

test('touchmove is blocked (no page scrolling) except inside overlays and the tuning panel', () => {
  const t = setup();
  const inside = { closest: sel => (sel === '.overlay, .tune' ? {} : null) }, outside = { closest: () => null };
  assert.equal(t.doc.fire('touchmove', { target: outside }).prevented, true);
  assert.equal(t.doc.fire('touchmove', { target: inside }).prevented, undefined);
});

test('a dead zone of 0 (the slider allows it) never makes the steering NaN, including at the exact centre of the stick', () => {
  const t = setup({ tune: { dead: 0 } });
  down(t, 100, 150);   // the thumb lands exactly on the centre of the stick: 0 / 0 without a guard
  t.inp.readInput(1 / 60);
  assert.equal(t.S.input.steer, 0);
  move(t, 125, 150); t.inp.readInput(1 / 60);
  assert.ok(Math.abs(t.S.input.steer - 0.5) < 1e-9, 'with no dead zone half the radius is half the deflection');
  move(t, 100, 150); for (let i = 0; i < 3; i++) t.inp.readInput(1 / 60);
  assert.equal(t.S.input.steer, 0, 'and back to the centre it recovers: steering never got stuck on NaN');
  assert.ok(Number.isFinite(t.S.input.steer));
});

// An element that answers closest() like a button in the page: `ids` are the ids it is inside of.
const btn = (...ids) => ({ closest: sel => (sel === 'button' ? {} : sel === '#start, #again' ? (ids.some(i => i === 'start' || i === 'again') ? {} : null) : null) });

test('Enter on a start screen starts a race, but a focused button other than START or RACE AGAIN is pressed instead (it is not hijacked)', () => {
  const t = setup({ overlay: true });
  assert.equal(t.win.fire('keydown', { code: 'Enter', target: btn('recordsBtn') }).prevented, undefined); assert.deepEqual(t.calls, [], 'no race started');
  assert.equal(t.win.fire('keydown', { code: 'Space', target: btn('labBtn') }).prevented, undefined); assert.deepEqual(t.calls, []);
  assert.equal(t.win.fire('keydown', { code: 'Enter', target: btn('start') }).prevented, true); assert.deepEqual(t.calls, ['start']);
  t.calls.length = 0; t.win.fire('keydown', { code: 'Enter', target: btn('again') }); assert.deepEqual(t.calls, ['start']);
  t.calls.length = 0; t.win.fire('keydown', { code: 'Enter', target: {} }); assert.deepEqual(t.calls, ['start'], 'with nothing focused it starts');
});

test('Escape closes a records screen first; only when there is none does it leave the lab', () => {
  const t = setup(); const log = [];
  let open = true;
  const actions = { overlayOpen: () => false, startRace() {}, toggleMute() {}, exitLab: () => log.push('exit'), back: () => { log.push('back'); const was = open; open = false; return was; }, browsing: () => open };
  const dom = makeDom(); const S = { input: { steer: 0, thr: 0, brk: 0, fire: 0 }, player: { vx: 0, vy: 0 }, tune: {}, lab: true };
  const inp = createInput({ S, tune: { ...TUNE }, initAudio() {}, win: dom.win, doc: dom.doc }); inp.connect(actions);
  const esc = () => dom.win.fire('keydown', { code: 'Escape' });
  assert.equal(esc().prevented, true); assert.deepEqual(log, ['back']);
  esc(); assert.deepEqual(log, ['back', 'back', 'exit']); void t;
  open = true; log.length = 0; assert.equal(dom.win.fire('keydown', { code: 'Escape', target: { tagName: 'TEXTAREA', closest: () => null } }).prevented, true); assert.deepEqual(log, ['back'], 'Escape still goes back from inside a text box');
});

test('while a records screen is open the game keys are left alone (Space presses the focused button; it does not fire)', () => {
  const dom = makeDom(); const S = { input: { steer: 0, thr: 0, brk: 0, fire: 0 }, player: { vx: 0, vy: 0 }, tune: {}, lab: false };
  let browsing = true;
  const inp = createInput({ S, tune: { ...TUNE }, initAudio() {}, win: dom.win, doc: dom.doc });
  inp.connect({ overlayOpen: () => false, startRace() {}, toggleMute() {}, exitLab() {}, back: () => false, browsing: () => browsing });
  assert.equal(dom.win.fire('keydown', { code: 'Space' }).prevented, undefined); inp.readInput(1 / 60); assert.equal(S.input.fire, 0);
  assert.equal(dom.win.fire('keydown', { code: 'ArrowUp' }).prevented, undefined); inp.readInput(1 / 60); assert.equal(S.input.thr, 0);
  browsing = false;
  assert.equal(dom.win.fire('keydown', { code: 'Space' }).prevented, true); inp.readInput(1 / 60); assert.equal(S.input.fire, 1, 'in a race Space fires again');
});

test('typing or pasting into a text box never triggers a shortcut (M does not mute, Enter does not start a race, letters do not drive)', () => {
  const t = setup({ overlay: true });
  const box = { tagName: 'TEXTAREA', closest: () => null };
  for (const code of ['KeyM', 'Enter', 'Space', 'KeyW', 'ArrowUp', 'KeyD']) assert.equal(t.win.fire('keydown', { code, target: box }).prevented, undefined, code);
  assert.deepEqual(t.calls, []); t.inp.readInput(1 / 60); assert.deepEqual([t.S.input.thr, t.S.input.steer], [0, 0]);
  t.win.fire('keydown', { code: 'KeyM', target: { tagName: 'BODY', closest: () => null } }); assert.deepEqual(t.calls.filter(c => c !== 'audio'), ['mute'], 'the same key elsewhere still mutes');
});
