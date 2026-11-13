import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';

const { T, N, HALF_W } = Sim;

test('track is a closed loop with sane geometry', () => {
  assert.ok(N > 300, `track has ${N} samples`);
  const gap = Math.hypot(T.x[0] - T.x[N - 1], T.y[0] - T.y[N - 1]);
  assert.ok(gap < 40, `loop gap ${gap.toFixed(1)}`);
  for (let i = 0; i < N; i++) {
    assert.ok([T.x[i], T.y[i], T.nx[i], T.ny[i], T.curv[i], T.vsafe[i]].every(Number.isFinite), `sample ${i} not finite`);
    assert.ok(T.vsafe[i] > 50 && T.vsafe[i] <= 600, `vsafe[${i}] = ${T.vsafe[i]}`);
  }
});

test('different parts of the track never come closer than two track widths plus margin', () => {
  // Otherwise lanes overlap on tight S-bends. Samples closer than 30 apart along the track are neighbours and skipped.
  let min = Infinity;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const along = Math.min(j - i, N - (j - i)); if (along < 30) continue;
    min = Math.min(min, Math.hypot(T.x[i] - T.x[j], T.y[i] - T.y[j]));
  }
  console.log(`  minimum separation: ${min.toFixed(0)} units (required ${2 * HALF_W + 40})`);
  assert.ok(min >= 2 * HALF_W + 40, `tracks come ${min.toFixed(0)} apart`);
});
