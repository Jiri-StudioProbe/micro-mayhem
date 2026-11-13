import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSim } from '../helpers/sim.js';
import { makeDrivers, runRace } from '../helpers/drivers.js';

const Sim = loadSim();
const drivers = makeDrivers(Sim);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const RUNS = Number(process.env.ASSIST_RUNS || 10);

// This is the measurement behind the Rookie level: a thumb-style driver loses badly without help and wins with it.
// Thresholds are far inside the measured effect (about 4.8 vs 1.8 average place, 7 vs 0.3 wall hits), so they do not flake.
test('assist rescues a thumb-style driver (and lane hold is what does the work)', () => {
  const none = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'thumb', { assist: false }));
  const rookie = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'thumb', { assist: true, lane: 1.5, speed: 1.5 }));
  const p0 = avg(none.map(r => r.place)), p1 = avg(rookie.map(r => r.place));
  const c0 = avg(none.map(r => r.crashes)), c1 = avg(rookie.map(r => r.crashes));
  console.log(`  no assist: place ${p0.toFixed(1)}, wall hits ${c0.toFixed(1)} | Rookie assist: place ${p1.toFixed(1)}, wall hits ${c1.toFixed(1)}`);
  assert.ok(p1 < p0 - 1.5, `assist should improve average place by more than 1.5 (${p0.toFixed(1)} -> ${p1.toFixed(1)})`);
  assert.ok(c1 < c0 / 2, `assist should at least halve wall hits (${c0.toFixed(1)} -> ${c1.toFixed(1)})`);
});

test('a keyboard-style driver is competitive without any assist', () => {
  const kb = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'keyboard'));
  const place = avg(kb.map(r => r.place));
  console.log(`  keyboard driver average place ${place.toFixed(1)}`);
  assert.ok(place < 3.5, `keyboard driver average place ${place.toFixed(1)}`);
});
