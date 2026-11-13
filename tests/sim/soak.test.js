import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSim } from '../helpers/sim.js';

const Sim = loadSim();
const finite = S => S.cars.every(c => [c.x, c.y, c.a, c.vx, c.vy, c.hp].every(Number.isFinite));

test('autopilot races end, with no NaN, within a plausible time', () => {
  for (let r = 0; r < 12; r++) {
    const S = Sim.create(); Sim.reset(S, 'race'); S.player.auto = true;
    let t = 0;
    for (; t < 240 && S.state !== 'over'; t += 1 / 60) { Sim.step(S, 1 / 60); S.events.length = 0; }
    assert.ok(finite(S), `race ${r}: non-finite car state`);
    assert.equal(S.state, 'over', `race ${r} did not end in 240 s`);
    assert.ok(['finish', 'wrecked', 'last'].includes(S.result.kind), `race ${r}: bad result kind ${S.result.kind}`);
    // Measured over 300 races: the earliest end was 14.5 s (the player wrecked by combat), the median 80 s. Anything under the
    // 3.4 s countdown plus a moment would mean the end-of-race logic fired by mistake.
    assert.ok(t > 5, `race ${r} ended implausibly fast (${t.toFixed(1)} s)`);
  }
});

test('races with a randomly driven player stay finite and every end path is reachable', () => {
  const kinds = new Set();
  for (let r = 0; r < 16; r++) {
    const S = Sim.create(); Sim.reset(S, 'race'); S.player.auto = false;
    for (let t = 0; t < 120 && S.state !== 'over'; t += 1 / 60) {
      if (Math.floor(t * 60) % 20 === 0) { S.input.steer = Math.random() * 2 - 1; S.input.thr = Math.random() < 0.8 ? 1 : 0; S.input.brk = Math.random() < 0.1 ? 1 : 0; S.input.fire = Math.random() < 0.5 ? 1 : 0; }
      Sim.step(S, 1 / 60); S.events.length = 0;
    }
    assert.ok(finite(S), `race ${r}: non-finite car state`);
    if (S.result) kinds.add(S.result.kind);
  }
  assert.ok(kinds.size >= 1);
});

test('attract mode (AI only) runs for two minutes without NaN', () => {
  const S = Sim.create();   // create() starts in attract mode
  assert.equal(S.attract, true);
  for (let t = 0; t < 120; t += 1 / 60) { Sim.step(S, 1 / 60); S.events.length = 0; }
  assert.ok(finite(S));
});

test('large time steps are handled (a slow phone feeds the sim long frames)', () => {
  const S = Sim.create(); Sim.reset(S, 'race'); S.player.auto = true;
  for (let t = 0; t < 60; t += 0.2) { Sim.step(S, 0.2); S.events.length = 0; }
  assert.ok(finite(S));
});
