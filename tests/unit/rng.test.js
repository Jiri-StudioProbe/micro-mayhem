import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, deriveSeed } from '../../src/sim/rng.js';

test('the generator is the published mulberry32: these exact values must never change (saved races depend on them)', () => {
  const first = (seed, n = 3) => { const r = mulberry32(seed); return Array.from({ length: n }, () => +r().toFixed(10)); };
  assert.deepEqual(first(0), [0.2664292087, 0.0003297457, 0.2232720274]);
  assert.deepEqual(first(1), [0.6270739406, 0.0027357212, 0.52744704]);
  assert.deepEqual(first(123456789), [0.2577907438, 0.9707721116, 0.7853280143]);
  assert.deepEqual(first(4294967295), [0.8964226141, 0.1894782567, 0.7156526782]);
});

test('deriveSeed values are pinned too', () => {
  assert.deepEqual([0, 1, 2].map(k => deriveSeed(42, k)), [862081050, 2860932040, 404444327]);
  assert.equal(deriveSeed(0, 0), 301794027);
  assert.equal(deriveSeed(4294967295, 1), 3621581888);
});

test('the same seed gives the same sequence; a different seed gives a different one; seeds are taken modulo 2^32', () => {
  const take = (seed, n = 50) => { const r = mulberry32(seed); return Array.from({ length: n }, r); };
  assert.deepEqual(take(7), take(7));
  assert.notDeepEqual(take(7), take(8));
  assert.deepEqual(take(7), take(7 + 2 ** 32));
  assert.deepEqual(take(-1), take(4294967295));
});

test('numbers are in [0, 1) and spread evenly (fixed seeds, so this can never flake)', () => {
  for (const seed of [1, 2, 3, 1234567, 4294967295]) {
    const r = mulberry32(seed), buckets = new Array(10).fill(0), N = 100000;
    let sum = 0;
    for (let i = 0; i < N; i++) { const x = r(); assert.ok(x >= 0 && x < 1, `out of range: ${x}`); sum += x; buckets[Math.floor(x * 10)]++; }
    assert.ok(Math.abs(sum / N - 0.5) < 0.005, `mean ${sum / N}`);
    const chi2 = buckets.reduce((a, b) => a + (b - N / 10) ** 2 / (N / 10), 0);   // 9 degrees of freedom: 27.9 is the 0.1% point
    assert.ok(chi2 < 27.9, `seed ${seed}: chi-square ${chi2.toFixed(1)} over buckets ${buckets}`);
  }
});

test('streams derived from one seed differ, and neighbouring seeds do not give shifted copies of each other', () => {
  const take = (seed, n = 200) => { const r = mulberry32(seed); return Array.from({ length: n }, r); };
  const a = take(deriveSeed(5, 1)), b = take(deriveSeed(5, 2));
  assert.notDeepEqual(a, b);
  assert.equal(a.filter((x, i) => x === b[i]).length, 0);
  for (let seed = 0; seed < 50; seed++) {
    const s1 = take(deriveSeed(seed, 1)), s2 = take(deriveSeed(seed + 1, 1));
    const set = new Set(s1);
    assert.equal(s2.filter(x => set.has(x)).length, 0, `seeds ${seed} and ${seed + 1} share values`);
  }
});
