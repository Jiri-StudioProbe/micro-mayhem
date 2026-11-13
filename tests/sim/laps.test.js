import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';

const { N, LAPS } = Sim, DT = 1 / 60;
const run = (config, { steps = 60 * 240, auto = true, each } = {}) => {
  const S = Sim.create(1); Sim.reset(S, config); S.player.auto = auto;
  for (let k = 0; k < steps && S.state !== 'over'; k++) { if (each) each(S, k); Sim.step(S, DT); S.events.length = 0; }
  return S;
};

test('every race result carries the lap times, the best lap, the wall touches and whether assist was toggled', () => {
  // Measured over 300 autopilot races: finished races always had exactly 3 laps of 24.5 to 29.5 s, and the time before the first crossing
  // of the line was 0.88 to 0.93 s; races that ended early had 0 to 2 laps. The bounds below are far looser than that.
  const kinds = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const S = run({ mode: 'race', seed }), r = S.result;
    kinds.add(r.kind);
    assert.ok(Array.isArray(r.laps) && r.laps.length <= LAPS, `seed ${seed}: ${r.laps.length} laps`);
    for (const l of r.laps) assert.ok(Number.isFinite(l) && l > 18 && l < 60, `seed ${seed}: a lap of ${l} s`);
    assert.equal(r.bestLap, r.laps.length ? Math.min(...r.laps) : null);
    assert.equal(r.wallTouches, S.touches); assert.ok(Number.isInteger(r.wallTouches) && r.wallTouches >= 0);
    assert.equal(r.assistChanged, false);
    if (r.kind === 'finish') {
      assert.equal(r.laps.length, LAPS, 'a finished race has all its laps');
      const gap = r.time - r.laps.reduce((a, b) => a + b, 0);
      assert.ok(gap >= 0 && gap < 3, `seed ${seed}: ${gap} s between the green flag and the first crossing of the line`);
    }
  }
  assert.ok(kinds.has('finish') && kinds.size >= 2, 'both finished and unfinished races were exercised: ' + [...kinds]);
});

test('lap timing: crossing the line starts a lap, crossing it again ends it, and reversing over the line voids the lap in progress', () => {
  const S = Sim.create(1); Sim.reset(S, { mode: 'lab', seed: 1 }); S.player.auto = false;
  const at = (prog, steps = 1) => { S.player.prog = prog; for (let k = 0; k < steps; k++) { Sim.step(S, DT); S.events.length = 0; } };
  at(-5); assert.deepEqual(S.laps, []);
  at(2, 60);                                 // across the line: the clock starts (the 60 steps run on afterwards)
  assert.equal(S.lapNo, 0); assert.deepEqual(S.laps, []);
  at(N + 2); assert.equal(S.laps.length, 1); assert.ok(Math.abs(S.laps[0] - 60 / 60) < 0.05, `the lap took ${S.laps[0]} s`);
  at(N - 8, 30); assert.equal(S.lapT0, null, 'reversed back over the line: the lap in progress is void');
  at(N + 3, 30); assert.equal(S.laps.length, 1, 'and crossing again starts a fresh lap that is not yet finished');
  at(2 * N + 3); assert.equal(S.laps.length, 2); assert.ok(S.laps[1] > 0.4 && S.laps[1] < 0.6, `${S.laps[1]}`);
});

test('a new race forgets the previous one\'s laps', () => {
  const S = run({ mode: 'race', seed: 3 }); assert.ok(S.laps.length > 0 || S.result);
  Sim.reset(S, { mode: 'race', seed: 4 });
  assert.deepEqual([S.laps, S.lapNo, S.lapT0, S.assistChanged], [[], -1, null, false]);
});

test('assistChanged: set when the assist setting differs from the race\'s config at any step, and stays set', () => {
  const asked = (config, flips) => { const S = Sim.create(1); Sim.reset(S, { mode: 'race', seed: 2, ...config }); S.state = 'race'; flips(S); return S; };
  const steps = (S, n) => { for (let k = 0; k < n; k++) { Sim.step(S, DT); S.events.length = 0; } };
  let S = asked({ assist: false }, S => steps(S, 30)); assert.equal(S.assistChanged, false);
  S = asked({ assist: true, tune: { assistLane: 1, assistSpeed: 1.1 } }, S => steps(S, 30)); assert.equal(S.assistChanged, false, 'assist on from the start is not a change');
  S = asked({ assist: false }, S => { steps(S, 10); S.assist = true; steps(S, 10); }); assert.equal(S.assistChanged, true, 'switched on in the race');
  S = asked({ assist: true }, S => { steps(S, 10); S.assist = false; steps(S, 10); S.assist = true; steps(S, 10); }); assert.equal(S.assistChanged, true, 'switched off and on again: still marked');
});
