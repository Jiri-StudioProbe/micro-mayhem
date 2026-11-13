import test from 'node:test';
import assert from 'node:assert/strict';
import { createStepper } from '../../src/stepper.js';

const STEP = 1 / 60;
// Feeds a list of frame durations (ms) and returns the steps taken per frame, the alphas, and the totals.
function feed(durationsMs, opts = {}) {
  const st = createStepper({ STEP, ...opts }), steps = [], alphas = [];
  let total = 0;
  for (const ms of durationsMs) { const r = st.advance(ms / 1000, () => { total++; }); steps.push(r.steps); alphas.push(r.alpha); }
  return { steps, alphas, total };
}
const repeat = (v, n) => Array.from({ length: n }, () => v);

test('60 Hz: exactly one step per frame, and the same with the 16.7 ms frames the tests use', () => {
  assert.deepEqual(new Set(feed(repeat(1000 / 60, 600)).steps), new Set([1]));
  const r = feed(repeat(16.7, 3000));
  assert.ok(r.steps.every(s => s === 1 || s === 2 && r.steps.filter(x => x === 2).length < 30), 'only the odd extra step (16.7 ms is a hair longer than 1/60 s)');
  assert.ok(Math.abs(r.total - 3000 * 0.0167 * 60) <= 1);
});

test('120 Hz and 144 Hz: a step every other frame (or so), and the steps add up to real time', () => {
  for (const hz of [120, 144, 240]) {
    const r = feed(repeat(1000 / hz, hz * 10));
    assert.ok(r.steps.every(s => s <= 1), `${hz} Hz never needs two steps in a frame`);
    assert.ok(Math.abs(r.total - 600) <= 1, `${hz} Hz: ${r.total} steps in 10 s`);
    assert.ok(r.alphas.every(a => a >= 0 && a < 1), 'alpha stays in [0, 1)');
  }
});

test('30 Hz: two steps every frame', () => {
  const r = feed(repeat(1000 / 30, 300));
  assert.deepEqual(new Set(r.steps), new Set([2]));
  assert.ok(Math.abs(r.total - 600) <= 1);
});

test('jittery frames never lose or gain time: the steps always add up to the elapsed time', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const frames = Array.from({ length: 6000 }, () => 8 + rnd() * 26);   // 8 to 34 ms, as on a phone doing other things
  const elapsed = frames.reduce((a, b) => a + b, 0) / 1000;
  const r = feed(frames);
  assert.ok(Math.abs(r.total - elapsed * 60) <= 1.01, `${r.total} steps for ${elapsed.toFixed(2)} s`);
  assert.ok(r.steps.some(s => s === 0) && r.steps.some(s => s >= 2), 'the test really exercised 0 and 2+ steps');
});

test('alpha is how far the next step is under way', () => {
  const st = createStepper({ STEP });
  let r = st.advance(STEP * 0.25, () => assert.fail('no step is due yet'));
  assert.equal(r.steps, 0); assert.ok(Math.abs(r.alpha - 0.25) < 1e-9);
  r = st.advance(STEP * 0.5, () => {}); assert.equal(r.steps, 0); assert.ok(Math.abs(r.alpha - 0.75) < 1e-9);
  r = st.advance(STEP * 0.5, () => {}); assert.equal(r.steps, 1); assert.ok(Math.abs(r.alpha - 0.25) < 1e-9, 'the remainder carries over');
});

test('a long pause is dropped, not caught up: at most 0.25 s of steps (15) in one frame', () => {
  for (const ms of [250, 400, 5000, 3600000]) { const r = feed([ms]); assert.ok(r.steps[0] >= 14 && r.steps[0] <= 15, `${ms} ms gave ${r.steps[0]} steps`); }
  const r = feed([5000, 16.7]); assert.ok(r.steps[1] <= 2, 'and the frame after it is back to normal');
});

test('negative or zero frame times (a clock that went backwards) do nothing', () => {
  const r = feed([-50, 0, 16.7]);
  assert.deepEqual(r.steps, [0, 0, 1], 'the backwards frame is ignored: it does not make the next frames pay it back');
});

test('a step that throws is lost, not retried with the time that piled up while it kept failing', () => {
  const st = createStepper({ STEP });
  let calls = 0;
  for (let f = 0; f < 600; f++) { try { st.advance(0.0167, () => { calls++; throw new Error('broken sim'); }); } catch (e) { /* the loop logs it */ } }
  assert.ok(calls <= 605, `${calls} attempts in 600 frames`);
  let steps = 0; st.advance(0.0167, () => { steps++; });
  assert.ok(steps <= 2, `after the repair there is no burst of catch-up steps (${steps})`);
});

test('reset forgets the leftover time', () => {
  const st = createStepper({ STEP }); st.advance(STEP * 0.9, () => {}); st.reset();
  assert.equal(st.advance(0, () => {}).alpha, 0);
});
