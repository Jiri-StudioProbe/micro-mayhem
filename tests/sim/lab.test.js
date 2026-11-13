import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';


test('lab mode: the player alone, nothing to pick up, no way to lose or win', () => {
  const S = Sim.create(); Sim.reset(S, 'lab');
  assert.equal(S.lab, true);
  assert.equal(S.cars.length, 1);
  assert.equal(S.crates.length, 0);
  assert.equal(S.state, 'race', 'lab starts racing immediately (no countdown)');
  S.player.auto = false;
  // drive straight into the wall for six minutes
  S.input.thr = 1; S.input.steer = 0.4;
  for (let t = 0; t < 360; t += 1 / 60) { Sim.step(S, 1 / 60); S.events.length = 0; }
  assert.equal(S.state, 'race', 'lab never ends');
  assert.equal(S.player.hp, 100, 'lab damage is disabled');
  assert.ok(S.touches > 5, `wall touches are counted (${S.touches})`);
});

test('leaving lab mode restores a normal race', () => {
  const S = Sim.create(); Sim.reset(S, 'lab'); Sim.reset(S, 'race');
  assert.equal(S.lab, false);
  assert.equal(S.cars.length, 6);
  assert.equal(S.crates.length, 33);
  assert.equal(S.state, 'countdown');
});
