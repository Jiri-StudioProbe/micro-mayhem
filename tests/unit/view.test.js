import test from 'node:test';
import assert from 'node:assert/strict';
import { createView, RES_STEPS, K, TILT } from '../../src/render/view.js';
import { fakeCanvas } from '../helpers/fakes.js';

const make = (w, h, { dpr = 1, coarse = false } = {}) => {
  const canvas = fakeCanvas({ clientWidth: w, clientHeight: h });
  return { canvas, ...createView({ canvas, coarse, startCam: { x: 5, y: 6, a: 0.5 }, getDevicePixelRatio: () => dpr }) };
};

test('the camera starts where it is told, facing straight ahead of its heading', () => {
  const { cam } = make(1000, 700);
  assert.deepEqual(cam, { x: 5, y: 6, a: 0.5, c: 1, s: 0, shx: 0, shy: 0 });
});

test('the perspective constants are the documented ones', () => { assert.equal(K, 0.0011); assert.equal(TILT, 0.66); });

test('the canvas takes the size of its box, times the device pixel ratio', () => {
  const { canvas, view } = make(1000, 700, { dpr: 2 });
  assert.deepEqual([view.W, view.H, view.DPR], [1000, 700, 2]);
  assert.deepEqual([canvas.width, canvas.height], [2000, 1400]);
  assert.equal(view.baseY, 700 * 0.77);
});

test('resolution is capped at 2x on desktop and 1.5x on touch devices', () => {
  assert.equal(make(1000, 700, { dpr: 3 }).view.DPR, 2);
  assert.equal(make(844, 390, { dpr: 3, coarse: true }).view.DPR, 1.5);
  assert.equal(make(1000, 700, { dpr: 1 }).view.DPR, 1);
  assert.equal(make(1000, 700, { dpr: 0 }).view.DPR, 1, 'a missing ratio counts as 1');
  assert.equal(make(1000, 700, { dpr: undefined }).view.DPR, 1);
});

// Zoom: the smaller of width/400 and height/500, with short (phone landscape) screens zooming in a little, kept within 0.7 to 2.1.
for (const [w, h, expected, why] of [
  [1000, 700, 1.4, 'desktop: limited by height'],
  [844, 390, 390 / 430, 'phone landscape: height is divided by 430, not 500'],
  [390, 844, 390 / 400, 'phone portrait: limited by width'],
  [200, 200, 0.7, 'tiny: never below 0.7'],
  [4000, 3000, 2.1, 'huge: never above 2.1'],
  [900, 500, 1.0, 'exactly 500 high: the plain height/500 rule applies']
]) {
  test(`zoom for ${w}x${h}: ${why}`, () => { assert.ok(Math.abs(make(w, h).view.Z - expected) < 1e-9, `Z = ${make(w, h).view.Z}`); });
}

test('a resize re-reads the box and the ratio', () => {
  const m = make(1000, 700);
  m.canvas.clientWidth = 500; m.canvas.clientHeight = 300; m.resize();
  assert.deepEqual([m.view.W, m.view.H, m.canvas.width, m.canvas.height], [500, 300, 500, 300]);
});

test('resolution steps down 1, 0.75, 0.55 and then stops', () => {
  const m = make(1000, 700, { dpr: 2 });
  assert.deepEqual(RES_STEPS, [1, 0.75, 0.55]);
  assert.equal(m.canStepDown(), true);
  assert.equal(m.stepDown(), true); assert.equal(m.view.DPR, 1.5); assert.equal(m.canvas.width, 1500);
  assert.equal(m.stepDown(), true); assert.ok(Math.abs(m.view.DPR - 1.1) < 1e-9);
  assert.equal(m.canStepDown(), false);
  assert.equal(m.stepDown(), false, 'already at the lowest');
  assert.ok(Math.abs(m.view.DPR - 1.1) < 1e-9);
});
