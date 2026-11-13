import test from 'node:test';
import assert from 'node:assert/strict';
import { createView } from '../../src/render/view.js';
import { createDraw } from '../../src/render/draw.js';
import { buildProps } from '../../src/render/world.js';
import { createScene } from '../../src/render/scene.js';
import { fakeCanvas } from '../helpers/fakes.js';
import { Sim } from '../helpers/sim.js';

const { T, N, HALF_W } = Sim;
const props = buildProps({ T, N, HALF_W });

// A race in progress, ready to draw.
function setup({ w = 1000, h = 700, reducedMotion = true, steps = 300 } = {}) {
  const S = Sim.create(); Sim.reset(S, 'race'); S.player.auto = true;
  for (let i = 0; i < steps; i++) { Sim.step(S, 1 / 60); S.events.length = 0; }
  const canvas = fakeCanvas({ clientWidth: w, clientHeight: h }), ctx = canvas.ctx, fx = { hurtFlash: 0 };
  const { view, cam } = createView({ canvas, coarse: false, startCam: { x: S.player.x, y: S.player.y, a: S.player.a }, getDevicePixelRatio: () => 1 });
  Object.assign(cam, { x: S.player.x, y: S.player.y, a: S.player.a });
  const draw = createDraw({ ctx, view, cam });
  const { render } = createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion });
  S.shake = 0;
  return { S, ctx, view, cam, fx, render };
}
const ahead = (S, k, side = 0) => { const P = S.player, c = Math.cos(P.a), s = Math.sin(P.a); return { x: P.x + c * k - s * side, y: P.y + s * k + c * side }; };

test('a race frame draws the felt first, then the scene, with no exception and no bad coordinates', () => {
  const { ctx, render } = setup();
  assert.doesNotThrow(() => render(0.016));
  // (-0 and 0 draw identically, and the shake offset is -0 with shake off, so compare as numbers rather than with Object.is)
  assert.deepEqual(ctx.calls[0].map(v => (typeof v === 'number' ? v + 0 : v)), ['setTransform', 1, 0, 0, 1, 0, 0]);
  assert.equal(ctx.calls[1][0], 'fillRect');
  assert.equal(ctx.calls.at(-1)[0], 'setTransform', 'the transform is reset at the end of the frame');
  assert.ok(ctx.count('fill') > 100, `${ctx.count('fill')} fills: track, walls, props, cars`);
  assert.equal(ctx.count('createLinearGradient'), 1, 'the distance fade');
  assert.equal(ctx.count('createRadialGradient'), 0, 'no damage flash');
});

test('the transform uses the canvas resolution (DPR) and the camera shake offset', () => {
  const a = setup({ reducedMotion: false });
  a.S.shake = 1; a.view.DPR = 2;
  a.render(0.016);
  const t = a.ctx.calls.find(c => c[0] === 'setTransform');
  assert.deepEqual([t[1], t[4]], [2, 2], 'scaled to the canvas resolution');
  assert.equal(t[5], a.cam.shx * 2); assert.equal(t[6], a.cam.shy * 2);
  assert.ok(Math.abs(a.cam.shx) > 0 || Math.abs(a.cam.shy) > 0, 'shake moves the camera');
});

test('reduced motion turns screen shake off', () => {
  const { S, cam, render } = setup({ reducedMotion: true });
  S.shake = 1; render(0.016);
  assert.ok(cam.shx === 0 && cam.shy === 0, `shake offsets ${cam.shx}, ${cam.shy}`);
});

test('the damage flash is drawn only while there is some, and it is a red vignette', () => {
  const { ctx, fx, render } = setup();
  fx.hurtFlash = 0.005; render(0.016);
  assert.equal(ctx.count('createRadialGradient'), 0, 'too faint to draw');
  ctx.calls.length = 0; fx.hurtFlash = 0.6; render(0.016);
  assert.equal(ctx.count('createRadialGradient'), 1);
});

test('every kind of entity can be drawn: cars, wrecks, crates, mines, rockets, shockwaves, bullets, particles', () => {
  const { S, ctx, render } = setup();
  S.cars[2].alive = false; S.cars[2].wreck = 5;
  const o = ahead(S, 150);
  S.mines.push({ x: o.x, y: o.y, owner: S.cars[1], arm: 0, life: 30 }, { x: o.x + 20, y: o.y, owner: S.cars[1], arm: 0.5, life: 30 });
  S.rockets.push({ x: o.x, y: o.y + 30, a: S.player.a, sp: 200, life: 2, owner: S.cars[1] });
  S.rings.push({ x: o.x, y: o.y - 30, r: 20, max: 80, life: 0.35, t: 0.2 });
  S.bullets.push({ x: o.x, y: o.y + 50, vx: 100, vy: 0, life: 1, owner: S.cars[1], dmg: 1 });
  for (const kind of [0, 1, 2, 3]) S.parts.push({ kind, x: o.x, y: o.y, h: 10, vx: 0, vy: 0, vh: 0, life: 0.5, max: 1, size: 8, r: 255, g: 100, b: 40, grav: 0 });
  const before = ctx.calls.length;
  assert.doesNotThrow(() => render(0.016));
  assert.ok(ctx.calls.length > before);
  assert.ok(ctx.count('ellipse') >= 3, 'crate rings, mines and a shockwave are ellipses');
  assert.ok(ctx.count('arc') >= 3, 'rocket glow, mine light and smoke or fire particles are circles');
  assert.ok(ctx.count('fillText') >= 1, 'crates carry a question mark');
});

// NOTE: the renderer guards against this in two independent layers (depth culling, and clamping radii with Math.max(0, ...)), so removing
// ONE layer changes nothing observable and this test, correctly, still passes. It fails when both are gone, which is how the bug happened.
// The freeze bug, as a unit test: points more than ~900 units behind the camera get a negative perspective scale, and a canvas throws on
// a negative radius. Everything drawn must be culled or clamped. The strict fake canvas throws exactly as a browser does.
test('regression: explosions, rockets, mines and bullets far behind (or far ahead of) the camera never reach the canvas', () => {
  const { S, render } = setup();
  for (const k of [400, 900, 1500, 3000, -300, -1200, -5000, 8000]) {
    const o = ahead(S, k);
    S.rings.push({ x: o.x, y: o.y, r: 20, max: 80, life: 0.35, t: 0.35 });
    S.rockets.push({ x: o.x, y: o.y, a: S.player.a, sp: 300, life: 2, owner: S.cars[1] });
    S.mines.push({ x: o.x, y: o.y, owner: S.cars[1], arm: 0, life: 30 });
    S.bullets.push({ x: o.x, y: o.y, vx: 0, vy: 0, life: 1, owner: S.cars[1], dmg: 1 });
    S.parts.push({ kind: 1, x: o.x, y: o.y, h: 5, vx: 0, vy: 0, vh: 0, life: 0.5, max: 1, size: 8, r: 50, g: 50, b: 50, grav: 0 });
    S.parts.push({ kind: 2, x: o.x, y: o.y, h: 5, vx: 0, vy: 0, vh: 0, life: 0.5, max: 1, size: 8, r: 255, g: 100, b: 40, grav: 0 });
  }
  assert.doesNotThrow(() => render(0.016));
});

test('things far outside the view are not drawn at all (depth culling)', () => {
  const { S, ctx, render } = setup();
  render(0.016); const base = ctx.calls.length;
  ctx.calls.length = 0;
  const far = ahead(S, 3000);
  S.mines.push({ x: far.x, y: far.y, owner: S.cars[1], arm: 0, life: 30 });
  S.rockets.push({ x: far.x, y: far.y, a: 0, sp: 1, life: 2, owner: S.cars[1] });
  render(0.016);
  assert.equal(ctx.calls.length, base, 'identical drawing with or without the distant entities');
});

test('the same state drawn twice gives exactly the same drawing commands', () => {
  const { ctx, render } = setup();
  render(0.016); const first = JSON.stringify(ctx.calls);
  ctx.calls.length = 0; render(0.016);
  assert.equal(JSON.stringify(ctx.calls), first);
});

test('it copes with every screen shape (phone landscape, phone portrait, tiny and huge)', () => {
  for (const [w, h] of [[844, 390], [390, 844], [200, 200], [3000, 2000], [1000, 700]]) {
    const { render } = setup({ w, h });
    assert.doesNotThrow(() => render(0.016), `${w}x${h}`);
  }
});

test('it can draw at the start of a race (countdown, cars stationary) and in the lab (one car)', () => {
  for (const mode of ['race', 'lab', 'attract']) {
    const S = Sim.create(); Sim.reset(S, mode);
    const canvas = fakeCanvas(), ctx = canvas.ctx, fx = { hurtFlash: 0 };
    const { view, cam } = createView({ canvas, coarse: false, startCam: { x: S.player.x, y: S.player.y, a: S.player.a }, getDevicePixelRatio: () => 1 });
    const { render } = createScene({ S, ctx, view, cam, fx, draw: createDraw({ ctx, view, cam }), props, T, N, HALF_W, reducedMotion: true });
    assert.doesNotThrow(() => render(0.016), mode);
  }
});
