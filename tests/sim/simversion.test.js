import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';
import { gameplay, scripted, fnv } from '../helpers/fingerprint.js';

// The rules of the game are versioned: a saved race can only be replayed by the sim that played it, so any change to physics, AI, weapons,
// damage, the track, or the order or number of random draws changes SIM_VERSION. This test is what makes forgetting impossible: it plays four
// fixed races and compares a hash of the whole way through (every 5 s and the end) with the hashes pinned below for that version.
//
//   Failing because you changed the rules on purpose?  1. Add 1 to SIM_VERSION in src/sim/sim.js.  2. Replace PINNED below with the numbers this
//   test prints.  3. Note the change in docs/ROADMAP.md (saved races of older versions can no longer be replayed by the new sim).
//   Failing and you did NOT mean to change the rules?  Then something you touched changes how races play out; find out what.
//
// (Rendering, sound, the interface, the steering feel and anything else outside src/sim/ is not part of the rules.)
const PINNED = { version: 1, hashes: { 'race, autopilot': '1499eefb', 'race, scripted driver with Rookie assist': '57a7af17', 'lab, scripted driver': 'cf24b8ee', 'attract': 'ee5c4376' } };

const DT = 1 / 60;
function hashOf(config, { steps, auto = false }) {
  const S = Sim.create(1); Sim.reset(S, config); S.player.auto = auto || config.mode === 'attract';
  let acc = '';
  for (let k = 0; k < steps; k++) {
    if (!S.player.auto) scripted(S, k);
    Sim.step(S, DT); S.events.length = 0;
    if (k % 300 === 0) acc += gameplay(S);
  }
  return fnv(acc + gameplay(S));
}
const SCENARIOS = {
  'race, autopilot': () => hashOf({ mode: 'race', seed: 1 }, { steps: 60 * 60, auto: true }),
  'race, scripted driver with Rookie assist': () => hashOf({ mode: 'race', seed: 2, assist: true, tune: { assistLane: 1.5, assistSpeed: 1.5 } }, { steps: 60 * 60 }),
  'lab, scripted driver': () => hashOf({ mode: 'lab', seed: 3 }, { steps: 60 * 40 }),
  'attract': () => hashOf({ mode: 'attract', seed: 4 }, { steps: 60 * 60 })
};

test(`the rules of the game are unchanged since SIM_VERSION ${Sim.SIM_VERSION}`, () => {
  const got = Object.fromEntries(Object.entries(SCENARIOS).map(([k, f]) => [k, f()]));
  const message = `The simulation plays out differently from simVersion ${PINNED.version}. If the rules were changed on purpose: bump SIM_VERSION in src/sim/sim.js and set PINNED to ${JSON.stringify({ version: Sim.SIM_VERSION + 1, hashes: got })}`;
  assert.equal(Sim.SIM_VERSION, PINNED.version, 'SIM_VERSION and PINNED.version must be changed together');
  assert.deepEqual(got, PINNED.hashes, message);
});
