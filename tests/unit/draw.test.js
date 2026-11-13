import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraw, rgb, FELT, ROAD } from '../../src/render/draw.js';
import { K, TILT } from '../../src/render/view.js';
import { fakeCtx } from '../helpers/fakes.js';

const setup = (cam = {}) => {
  const ctx = fakeCtx(), view = { W: 1000, H: 700, Z: 1.4, baseY: 539, DPR: 1 };
  const c = { x: 0, y: 0, a: 0, c: 1, s: 0, ...cam };
  return { ctx, view, cam: c, ...createDraw({ ctx, view, cam: c }) };
};

test('rgb scales a colour and truncates to whole numbers', () => {
  assert.equal(rgb([200, 100, 50], 1), 'rgb(200,100,50)');
  assert.equal(rgb([200, 100, 50], 0.5), 'rgb(100,50,25)');
  assert.equal(rgb([255, 255, 255], 0.999), 'rgb(254,254,254)');
  assert.equal(rgb([10, 20, 30], 1.05), 'rgb(10,21,31)');
  assert.equal(FELT, '#16342d'); assert.deepEqual(ROAD, [66, 72, 87]);
});

test('a point on the camera is at the horizontal centre, at the base line', () => {
  const { proj } = setup();
  const [sx, sy, p, fwd] = proj(0, 0, 0);
  assert.deepEqual([sx, sy, p, fwd], [500, 539, 1, 0]);
});

test('points ahead go up the screen and shrink, following 1 / (1 + fwd * K)', () => {
  const { proj } = setup();
  const [sx, sy, p, fwd] = proj(100, 0, 0);
  assert.equal(fwd, 100);
  assert.ok(Math.abs(p - 1 / (1 + 100 * K)) < 1e-12);
  assert.equal(sx, 500);
  assert.ok(Math.abs(sy - (539 - 100 * TILT * p * 1.4)) < 1e-9);
  assert.ok(sy < 539);
  assert.ok(proj(200, 0, 0)[2] < p, 'further is smaller');
});

test('sideways offsets move left and right of the centre, scaled by distance', () => {
  const { proj } = setup();
  const near = proj(0, 50, 0), far = proj(500, 50, 0);
  assert.ok(near[0] > 500 && far[0] > 500 && far[0] < near[0], 'the same offset looks smaller further away');
  assert.ok(Math.abs(near[0] - (500 + 50 * 1.4)) < 1e-9);
});

test('height lifts a point straight up the screen', () => {
  const { proj } = setup();
  const ground = proj(100, 0, 0), up = proj(100, 0, 20);
  assert.equal(up[0], ground[0]);
  assert.ok(Math.abs((ground[1] - up[1]) - 20 * ground[2] * 1.4) < 1e-9);
});

test('the camera heading rotates the world: with the camera facing +y, +y is ahead', () => {
  const { proj } = setup({ a: Math.PI / 2, c: 0, s: 1 });
  const [sx, , , fwd] = proj(0, 100, 0);
  assert.equal(fwd, 100); assert.equal(sx, 500);
});

test('a polygon is one closed path, filled, and outlined only when asked', () => {
  const { poly, ctx } = setup();
  poly([[0, 0], [10, 0], [10, 10]], 'red');
  assert.deepEqual(ctx.calls.map(c => c[0]), ['beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath', 'fill']);
  assert.equal(ctx.fillStyle, 'red');
  ctx.calls.length = 0;
  poly([[0, 0], [10, 0], [10, 10]], 'blue', true);
  assert.equal(ctx.calls.at(-1)[0], 'stroke'); assert.equal(ctx.strokeStyle, 'blue'); assert.equal(ctx.lineWidth, 1);
});

// A box 20 wide, 200 ahead of the camera. A box seen from outside shows only the sides that face the camera, plus its top.
const box = (cx, cy) => [[cx - 10, cy - 10], [cx + 10, cy - 10], [cx + 10, cy + 10], [cx - 10, cy + 10]];
const fills = (cx, cy, cam) => { const s = setup(cam); s.prism(box(cx, cy), 0, 10, [200, 0, 0], [100, 0, 0]); return s.ctx.count('fill'); };

test('a prism draws only the sides that face the camera, plus the top', () => {
  assert.equal(fills(200, 0), 2, 'dead ahead: one side and the top');
  assert.equal(fills(200, 60), 3, 'off to one side: two sides and the top');
  assert.equal(fills(200, -60), 3);
  assert.equal(fills(0, 0), 1, 'the camera inside the box sees no sides, only the top');
});

test('side faces are shaded between 50% and 105% of the side colour, and the top is the top colour', () => {
  const s = setup(); const styles = [];
  Object.defineProperty(s.ctx, 'fillStyle', { set(v) { styles.push(v); }, get() { return styles.at(-1); } });
  s.prism(box(200, 60), 0, 10, [200, 100, 50], [100, 100, 100]);
  assert.equal(styles.length, 3);
  for (const side of styles.slice(0, 2)) { const v = Number(/rgb\((\d+),/.exec(side)[1]); assert.ok(v >= 50 && v <= 105, side); }
  assert.equal(styles.at(-1), 'rgb(200,100,50)');
});
