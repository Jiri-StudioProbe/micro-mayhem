import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterp } from '../../src/interp.js';

const TAU = Math.PI * 2, PI = Math.PI;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
const world = () => ({
  cars: [{ x: 0, y: 0, a: 0, vx: 1 }], bullets: [{ x: 10, y: 10 }], rockets: [{ x: 0, y: 0, a: 1 }], parts: [{ x: 5, y: 5, h: 2, life: 1 }]
});
const move = S => { S.cars[0].x += 10; S.cars[0].y -= 4; S.cars[0].a += 0.5; S.bullets[0].x += 20; S.rockets[0].x += 6; S.rockets[0].a += 1; S.parts[0].x += 2; S.parts[0].h += 4; };

test('apply moves everything to the point alpha of the way from its previous position, and restore puts the real state back exactly', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  ip.snapshot(); move(S);
  const keys = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['px', 'py', 'pa', 'ph', 'tx', 'ty', 'ta', 'th'].includes(k)));   // without the interpolator's own bookkeeping
  const state = () => JSON.stringify({ cars: S.cars.map(keys), bullets: S.bullets.map(keys), rockets: S.rockets.map(keys), parts: S.parts.map(keys) });
  const real = state();
  ip.apply(0.25);
  assert.equal(S.cars[0].x, 2.5); assert.equal(S.cars[0].y, -1); assert.ok(Math.abs(S.cars[0].a - 0.125) < 1e-12);
  assert.equal(S.bullets[0].x, 15); assert.equal(S.bullets[0].y, 10);
  assert.equal(S.rockets[0].x, 1.5); assert.ok(Math.abs(S.rockets[0].a - 1.25) < 1e-12);
  assert.equal(S.parts[0].x, 5.5); assert.equal(S.parts[0].h, 3); assert.equal(S.parts[0].y, 5);
  assert.equal(S.cars[0].vx, 1, 'velocities and everything else are left alone');
  ip.restore();
  assert.equal(state(), real, 'bit for bit');
});

test('alpha 0 draws the previous step, alpha 1 the current one', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  ip.snapshot(); move(S);
  ip.apply(0); assert.equal(S.cars[0].x, 0); ip.restore(); assert.equal(S.cars[0].x, 10);
  ip.apply(1); assert.equal(S.cars[0].x, 10); assert.equal(S.parts[0].h, 6); ip.restore();
});

test('angles take the short way round, across the +-pi seam', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  S.cars[0].a = PI - 0.1; ip.snapshot(); S.cars[0].a = -PI + 0.1;   // turned 0.2 rad, not 6.08 rad the other way
  ip.apply(0.5);
  assert.ok(Math.abs(Math.abs(S.cars[0].a) - PI) < 1e-9, `halfway is at the seam (${S.cars[0].a})`);
  ip.restore(); assert.equal(S.cars[0].a, -PI + 0.1);
});

test('things that appeared during the step have no earlier position and are left where they are', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  ip.snapshot(); move(S);
  S.bullets.push({ x: 100, y: 100 }); S.parts.push({ x: 7, y: 7, h: 1 }); S.cars.push({ x: 50, y: 50, a: 0 });
  ip.apply(0.5);
  assert.deepEqual(S.bullets[1], { x: 100, y: 100 }); assert.deepEqual(S.parts[1], { x: 7, y: 7, h: 1 }); assert.deepEqual(S.cars[1], { x: 50, y: 50, a: 0 });
  ip.restore();
  assert.equal(S.bullets[1].x, 100);
});

test('a world that was reset (new objects) is drawn as it is, and restore is safe to call twice or with nothing applied', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  ip.snapshot(); move(S);
  S.cars.length = 0; S.cars.push({ x: 1, y: 2, a: 3 });   // reset(): the objects are new
  ip.apply(0.5); assert.deepEqual(S.cars[0], { x: 1, y: 2, a: 3 }); ip.restore(); ip.restore();
  assert.deepEqual(S.cars[0], { x: 1, y: 2, a: 3 });
  const empty = createInterp({ S: { cars: [], bullets: [], rockets: [], parts: [] }, angDiff }); empty.snapshot(); empty.apply(0.3); empty.restore();
});

test('removing things from the lists between steps (bullets that hit, particles that die) never confuses the next frame', () => {
  const S = world(), ip = createInterp({ S, angDiff });
  S.parts.push({ x: 0, y: 0, h: 0 }, { x: 1, y: 1, h: 1 });
  ip.snapshot(); S.parts.forEach(p => { p.x += 10; }); S.parts.splice(0, 1);   // the first one died, the others shifted down
  ip.apply(0.5); assert.equal(S.parts[0].x, 5); assert.equal(S.parts[1].x, 6); ip.restore();   // each is halfway from its own previous position
  assert.equal(S.parts[0].x, 10); assert.equal(S.parts[1].x, 11);
});
