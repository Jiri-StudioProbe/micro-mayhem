import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from '../../src/loop.js';

const STEP = 1 / 60;
// A loop whose collaborators only write to a log, driven by hand with frame times in ms.
function make(over = {}) {
  const log = [], cbs = [];
  const S = { lab: false, attract: false, state: 'race', cars: [{ alive: true }], player: { vx: 0, vy: 0, alive: true }, input: { thr: 0 } };
  const parts = {
    S, STEP, ctx: { setTransform() { log.push('ctx reset'); } }, diag: { record: (src, e) => log.push('diag ' + src + ' ' + e.message) },
    step: (s, dt) => { log.push('step ' + dt); }, reset: (s, m) => { log.push('reset ' + m); }, ranking: () => [],
    canStepDown: () => false, stepDown() {}, input: { readInput: dt => log.push('input ' + dt) }, game: { handleEvents: () => log.push('events') },
    lab: { track: () => log.push('lab.track'), updateHud: () => log.push('lab.hud') }, hud: { visible: () => true, update: () => log.push('hud') },
    rig: { follow: dt => log.push('follow') }, interp: { snapshot: () => log.push('snapshot'), apply: a => log.push('apply ' + a.toFixed(2)), restore: () => log.push('restore') },
    fx: { hurtFlash: 0 }, render: () => log.push('render'), drawMini: () => log.push('mini'), audio: { engine: () => log.push('engine') },
    debugUpdate: null, requestFrame: cb => { cbs.push(cb); log.push('rearm'); }, now: () => 0, ...over
  };
  const loop = createLoop(parts);
  loop.start(); log.length = 0;
  const frame = t => { const cb = cbs.shift(); cb(t); };
  return { S, log, frame, cbs, parts };
}
const steps = log => log.filter(l => l.startsWith('step ')).length;

test('one frame at 60 Hz: snapshot, input and step, then events, then draw the interpolated moment, restore, HUD', () => {
  const { log, frame } = make();
  frame(1000 / 60);
  assert.deepEqual(log, ['rearm', 'snapshot', 'input ' + STEP, 'step ' + STEP, 'events', 'apply 0.00', 'follow', 'render', 'restore', 'hud', 'mini', 'engine']);
});

test('every step is exactly STEP seconds and is preceded by its own snapshot and input read, whatever the frame length', () => {
  for (const ms of [4, 8.3, 16.7, 33.3, 100, 250]) {
    const { log, frame } = make();
    for (let i = 1; i <= 40; i++) frame(i * ms);
    const stepLines = log.filter(l => /^(snapshot|input|step)/.test(l));
    for (let i = 0; i < stepLines.length; i += 3) assert.deepEqual(stepLines.slice(i, i + 3), ['snapshot', 'input ' + STEP, 'step ' + STEP], `${ms} ms frames`);
    assert.ok(Math.abs(steps(log) - Math.min(ms, 250) * 40 / 1000 * 60) <= 1.5, `${ms} ms frames: ${steps(log)} steps`);
  }
});

test('on a 120 Hz screen some frames take no step at all and are still drawn, with alpha moving on', () => {
  const { log, frame } = make();
  for (let i = 1; i <= 6; i++) frame(i * 1000 / 120);
  assert.equal(log.filter(l => l === 'render').length, 6);
  assert.equal(steps(log), 3);
  assert.deepEqual(log.filter(l => l.startsWith('apply')), ['apply 0.50', 'apply 0.00', 'apply 0.50', 'apply 0.00', 'apply 0.50', 'apply 0.00']);
});

test('the real state is put back even when drawing throws, the error is logged, and the next frame runs normally', () => {
  let fail = true;
  const { log, frame, cbs } = make({ render: () => { log.push('render'); if (fail) throw new Error('canvas broke'); } });
  frame(16.7);
  assert.ok(log.includes('restore'), 'restored in spite of the exception');
  assert.ok(log.indexOf('restore') > log.indexOf('render'));
  assert.ok(log.includes('diag frame canvas broke') && log.includes('ctx reset'));
  assert.equal(cbs.length, 1, 'the loop was re-armed');
  fail = false; log.length = 0; frame(33.4);
  assert.ok(log.includes('hud') && !log.some(l => l.startsWith('diag')));
});

test('a step that throws does not stop the loop, and does not leave an interpolated state applied', () => {
  let fail = true;
  const { log, frame, cbs } = make({ step: () => { if (fail) throw new Error('sim broke'); } });
  frame(16.7);
  assert.ok(log.includes('diag frame sim broke')); assert.equal(cbs.length, 1);
  assert.ok(!log.some(l => l.startsWith('apply')), 'nothing was applied, so nothing needs restoring');
  fail = false; log.length = 0; frame(33.4); assert.ok(log.includes('render'));
});

test('the loop is re-armed before anything else happens in a frame', () => {
  const { frame, cbs, log } = make({ render: () => { throw new Error('x'); } });
  frame(16.7); assert.equal(cbs.length, 1);
  assert.equal(log[0], 'rearm', 'the very first thing the frame did');
});

test('attract mode restarts when fewer than three cars are left, and after 70 s of game time (not of frames)', () => {
  let m = make(); m.S.attract = true; m.S.cars = [{ alive: true }, { alive: false }, { alive: false }];
  m.frame(16.7); assert.ok(m.log.includes('reset attract'));
  m = make(); m.S.attract = true; m.S.cars = [1, 2, 3, 4].map(() => ({ alive: true }));
  for (let i = 1; i <= 60 * 69; i++) m.frame(i * 1000 / 60);
  assert.ok(!m.log.includes('reset attract'), 'not yet at 69 s');
  for (let i = 60 * 69 + 1; i <= 60 * 71; i++) m.frame(i * 1000 / 60);
  assert.ok(m.log.includes('reset attract'), 'restarted by 71 s');
});

test('lab laps are tracked and the lab HUD drawn instead of the race HUD', () => {
  const { S, log, frame } = make(); S.lab = true;
  frame(16.7); assert.ok(log.includes('lab.track') && log.includes('lab.hud') && !log.includes('hud'));
});

test('a long pause (a background tab) is not replayed: at most 15 steps in one frame', () => {
  const { log, frame } = make();
  frame(16.7); log.length = 0; frame(60000);
  assert.ok(steps(log) <= 15, `${steps(log)} steps`);
});
