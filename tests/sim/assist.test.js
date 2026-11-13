import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadSim } from '../helpers/sim.js';
import { makeDrivers, runRace } from '../helpers/drivers.js';

const Sim = loadSim();
const drivers = makeDrivers(Sim);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const RUNS = Number(process.env.ASSIST_RUNS || 40);

// The simulation is not seeded until M1, so these are statistical. The sample size and thresholds come from measuring 150 races per
// driver and bootstrapping: at 40 races each, the chance of a false failure is about 0.03% per run (at 10 races it was 2% to 9%).
// Measured means: thumb 4.5th with 8.2 wall hits; thumb + Rookie assist 1.7th with 0.14 hits; keyboard 2.5th.
let thumb, rookie, keyboard;
before(() => {
  thumb = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'thumb', { assist: false }));
  rookie = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'thumb', { assist: true, lane: 1.5, speed: 1.5 }));
  keyboard = Array.from({ length: RUNS }, () => runRace(Sim, drivers, 'keyboard'));
});

// This is the measurement behind the Rookie level: a thumb-style driver loses badly without help and wins with it.
test('assist rescues a thumb-style driver', () => {
  const p0 = avg(thumb.map(r => r.place)), p1 = avg(rookie.map(r => r.place));
  const c0 = avg(thumb.map(r => r.crashes)), c1 = avg(rookie.map(r => r.crashes));
  console.log(`  thumb: place ${p0.toFixed(1)}, wall hits ${c0.toFixed(1)} | thumb + Rookie assist: place ${p1.toFixed(1)}, wall hits ${c1.toFixed(1)}`);
  assert.ok(p1 < p0 - 1.5, `assist should improve average place by more than 1.5 (${p0.toFixed(1)} -> ${p1.toFixed(1)})`);
  assert.ok(c1 < c0 / 2, `assist should at least halve wall hits (${c0.toFixed(1)} -> ${c1.toFixed(1)})`);
});

test('a keyboard-style driver beats a thumb-style driver without any assist', () => {
  const pk = avg(keyboard.map(r => r.place)), p0 = avg(thumb.map(r => r.place));
  console.log(`  keyboard place ${pk.toFixed(1)} vs thumb ${p0.toFixed(1)}`);
  assert.ok(pk < p0 - 0.75, `keyboard ${pk.toFixed(1)} should beat thumb ${p0.toFixed(1)} by more than 0.75`);
});
