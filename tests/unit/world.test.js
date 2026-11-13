import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProps, rng } from '../../src/render/world.js';
import { Sim } from '../helpers/sim.js';

const { T, N, HALF_W } = Sim;
const props = buildProps({ T, N, HALF_W });

test('the seeded generator is repeatable and spread over 0 to 1', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = Array.from({ length: 1000 }, a);
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, b));
  assert.notEqual(xs[0], c());
  assert.ok(xs.every(x => x >= 0 && x < 1));
  const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
  assert.ok(mean > 0.45 && mean < 0.55, `mean ${mean}`);
});

test('the same props appear on every device, every time', () => {
  assert.deepEqual(buildProps({ T, N, HALF_W }), props);
});

test('there are 170 props, each a valid footprint with a height and colours', () => {
  assert.equal(props.length, 170);
  for (const p of props) {
    assert.ok([4, 8].includes(p.pts.length), 'a box or an octagon');
    assert.ok(p.pts.every(q => q.length === 2 && q.every(Number.isFinite)));
    assert.ok(p.h > 0 && Number.isFinite(p.h));
    assert.equal(p.col.length, 3);
    assert.deepEqual(p.side, p.col.map(v => v * 0.75), 'the side colour is the top colour at 75%');
  }
});

test('no prop is on or beside the track (they sit on the felt, clear of the walls)', () => {
  for (const p of props) {
    let min = Infinity;
    for (let k = 0; k < N; k++) min = Math.min(min, Math.hypot(T.x[k] - p.x, T.y[k] - p.y));
    assert.ok(min >= HALF_W + 46, `a prop is ${min.toFixed(0)} from the track`);
  }
});

test('props do not pile up on each other', () => {
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    assert.ok(Math.hypot(props[i].x - props[j].x, props[i].y - props[j].y) >= 60, `props ${i} and ${j} overlap`);
  }
});
