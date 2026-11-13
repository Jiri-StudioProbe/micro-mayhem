import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';
import { TUNE_DEFS } from '../../src/levels.js';
import { mulberry32 } from '../../src/sim/rng.js';
import { gameplay, scripted } from '../helpers/fingerprint.js';

const { makeConfig, configProblems, raceHeader, TUNE_LIMITS, SIM_VERSION } = Sim;
const DEFAULTS = { mode: 'race', assist: false, tune: { assistLane: 1, assistSpeed: 1.1 } };
const DT = 1 / 60;

test('makeConfig fills in defaults, and leaves the seed out when there is none', () => {
  assert.deepEqual(makeConfig(), DEFAULTS);
  assert.deepEqual(makeConfig({}), DEFAULTS);
  assert.deepEqual(makeConfig({ mode: 'lab', seed: 7, assist: true, tune: { assistLane: 0.3, assistSpeed: 1.2 } }), { mode: 'lab', assist: true, tune: { assistLane: 0.3, assistSpeed: 1.2 }, seed: 7 });
  assert.equal('seed' in makeConfig({ mode: 'race' }), false);
});

test('makeConfig repairs anything it is given: it never throws and always returns a valid, plain-data config', () => {
  const hostile = [null, undefined, 0, 1, 'race', true, [], [1, 2], () => 1, NaN,
    { mode: 'constructor' }, { mode: '__proto__' }, { mode: ['race'] }, { mode: 'RACE' }, { assist: 'true' }, { assist: 1 }, { assist: {} },
    { tune: null }, { tune: [] }, { tune: 'x' }, { tune: { assistLane: NaN, assistSpeed: Infinity } }, { tune: { assistLane: -5, assistSpeed: 99 } }, { tune: { assistLane: '1' } },
    { tune: { __proto__: { assistLane: 1.2 } } }, { seed: NaN }, { seed: Infinity }, { seed: '5' }, { seed: -1 }, { seed: 2 ** 40 + 3 }, { seed: 1.5 },
    JSON.parse('{"__proto__": {"mode": "lab"}, "extra": 1}'), { mode: 'lab', unknown: { deep: 1 } }, Object.create({ mode: 'lab' })];
  for (const h of hostile) {
    let cfg; assert.doesNotThrow(() => { cfg = makeConfig(h); }, String(JSON.stringify(h)));
    assert.deepEqual(configProblems(cfg), [], 'repaired: ' + JSON.stringify(h) + ' -> ' + JSON.stringify(cfg));
    assert.deepEqual(JSON.parse(JSON.stringify(cfg)), cfg, 'plain JSON data');
    assert.deepEqual(Object.keys(cfg).filter(k => !['mode', 'seed', 'assist', 'tune'].includes(k)), []);
  }
  assert.equal(makeConfig({ mode: 'constructor' }).mode, 'race');
  assert.deepEqual(makeConfig({ tune: { assistLane: -5, assistSpeed: 99 } }).tune, { assistLane: 0, assistSpeed: 1.5 }, 'clamped to the allowed range');
  assert.equal(makeConfig({ seed: 2 ** 40 + 3 }).seed, 3, 'seeds are taken modulo 2^32, as reset() always did');
  assert.equal(makeConfig({ assist: 1 }).assist, false, 'only true is true');
});

test('makeConfig output is always valid, for 2000 random inputs', () => {
  const r = mulberry32(5), pick = a => a[Math.floor(r() * a.length)];
  const junk = () => pick([undefined, null, NaN, Infinity, -1, 0, 0.5, 1, 1.5, 2 ** 33, 'a', '', true, false, [], {}, 'lab', 'race', 'attract']);
  for (let i = 0; i < 2000; i++) {
    const c = { mode: junk(), seed: junk(), assist: junk(), tune: pick([junk(), { assistLane: junk(), assistSpeed: junk() }, { assistLane: r() * 4 - 1, assistSpeed: r() * 4 - 1 }]) };
    assert.deepEqual(configProblems(makeConfig(c)), [], JSON.stringify(c));
  }
});

test('configProblems says what is wrong with a config instead of repairing it (for anything loaded from storage)', () => {
  const good = { mode: 'race', seed: 5, assist: true, tune: { assistLane: 0.3, assistSpeed: 1.1 } };
  assert.deepEqual(configProblems(good), []);
  assert.deepEqual(configProblems({ ...good, seed: undefined }), [], 'no seed is allowed (reset draws one)');
  const bad = (patch, re) => { const p = configProblems({ ...good, ...patch }); assert.ok(p.some(x => re.test(x)), `${JSON.stringify(patch)} -> ${JSON.stringify(p)}`); };
  bad({ mode: 'nope' }, /mode/); bad({ mode: undefined }, /mode/); bad({ seed: -1 }, /seed/); bad({ seed: 1.5 }, /seed/); bad({ seed: 2 ** 32 }, /seed/); bad({ seed: '5' }, /seed/); bad({ seed: NaN }, /seed/);
  bad({ assist: 'yes' }, /assist/); bad({ assist: undefined }, /assist/); bad({ tune: null }, /tune/); bad({ tune: {} }, /assistLane/); bad({ tune: { assistLane: 2, assistSpeed: 1 } }, /assistLane/);
  bad({ tune: { assistLane: 1, assistSpeed: 0.1 } }, /assistSpeed/); bad({ tune: { assistLane: 1, assistSpeed: NaN } }, /assistSpeed/); bad({ tune: { ...good.tune, gain: 2 } }, /unknown tune value gain/);
  bad({ extra: 1 }, /unknown field extra/);
  for (const x of [null, undefined, 5, 'race', [], [good]]) assert.ok(configProblems(x).length > 0, String(x));
  assert.ok(Math.max(...Object.values(TUNE_LIMITS).map(l => l[1])) <= 1.5);
});

test('the limits the sim enforces on the assist values are the ranges of the tuning panel', () => {
  for (const d of TUNE_DEFS.filter(d => d.k in TUNE_LIMITS)) assert.deepEqual(TUNE_LIMITS[d.k], [d.min, d.max], d.k);
  assert.deepEqual(Object.keys(TUNE_LIMITS).sort(), TUNE_DEFS.filter(d => d.k.startsWith('assist')).map(d => d.k).sort());
});

test('reset takes a config: it is recorded as S.config with the seed actually used, with S.simVersion, and applied', () => {
  const S = Sim.create(1);
  Sim.reset(S, { mode: 'race', seed: 42, assist: true, tune: { assistLane: 0.4, assistSpeed: 1.3 } });
  assert.deepEqual(S.config, { mode: 'race', seed: 42, assist: true, tune: { assistLane: 0.4, assistSpeed: 1.3 } });
  assert.equal(S.seed, 42); assert.equal(S.simVersion, SIM_VERSION);
  assert.equal(S.assist, true); assert.deepEqual([S.tune.assistLane, S.tune.assistSpeed], [0.4, 1.3]);
  assert.equal(S.state, 'countdown');
  Sim.reset(S, { mode: 'race' });                       // no seed: the next one from the master stream, recorded
  assert.ok(Number.isInteger(S.config.seed) && S.config.seed === S.seed && S.config.seed !== 42);
  assert.equal(S.assist, false, 'a config without assist means no assist: nothing is left over from the previous race');
  assert.deepEqual([S.tune.assistLane, S.tune.assistSpeed], [1, 1.1]);
});

test('reset does not keep or change the config object it was given', () => {
  const S = Sim.create(1), mine = { mode: 'race', assist: true, tune: { assistLane: 0.5, assistSpeed: 1.2 } }, copy = JSON.parse(JSON.stringify(mine));
  Sim.reset(S, mine);
  assert.deepEqual(mine, copy, 'the caller\'s config is untouched (no seed was added to it)');
  S.config.tune.assistLane = 99; S.config.mode = 'lab';
  assert.deepEqual(mine, copy, 'and S.config is not the caller\'s object');
});

test('the modes: race counts down with six cars, lab is one car and no end, attract is all AI; anything else is a race', () => {
  const S = Sim.create(1);
  Sim.reset(S, { mode: 'race' }); assert.deepEqual([S.state, S.cars.length, S.lab, S.attract, S.player.auto], ['countdown', 6, false, false, false]);
  Sim.reset(S, { mode: 'lab' }); assert.deepEqual([S.state, S.cars.length, S.lab, S.attract, S.player.auto, S.crates.length], ['race', 1, true, false, false, 0]);
  Sim.reset(S, { mode: 'attract' }); assert.deepEqual([S.state, S.cars.length, S.lab, S.attract, S.player.auto], ['race', 6, false, true, true]);
  Sim.reset(S, { mode: 'banana' }); assert.deepEqual([S.state, S.cars.length, S.config.mode], ['countdown', 6, 'race']);
  assert.equal(Sim.create(1).attract, true, 'a new sim starts in attract mode');
});

test('the shorthand reset(S, mode, seed) is exactly the config with a mode and a seed', () => {
  const run = reset => { const S = Sim.create(9); reset(S); S.player.auto = true; for (let k = 0; k < 900; k++) { Sim.step(S, DT); S.events.length = 0; } return gameplay(S); };
  assert.equal(run(S => Sim.reset(S, 'race', 77)), run(S => Sim.reset(S, { mode: 'race', seed: 77 })));
  assert.equal(run(S => Sim.reset(S, 'lab', 3)), run(S => Sim.reset(S, { mode: 'lab', seed: 3 })));
  const S = Sim.create(1); Sim.reset(S); assert.equal(S.config.mode, 'race', 'no argument at all: a race');
});

test('a race is replayable from its header alone: config and simVersion survive JSON and play out identically', () => {
  const play = (S, steps) => { const trail = []; for (let k = 0; k < steps; k++) { scripted(S, k); Sim.step(S, DT); S.events.length = 0; if (k % 100 === 0) trail.push(gameplay(S)); } trail.push(gameplay(S)); return trail; };
  const A = Sim.create(5); Sim.reset(A, { mode: 'race', assist: true, tune: { assistLane: 1.5, assistSpeed: 1.5 } });   // the seed comes from the master stream
  const header = JSON.parse(JSON.stringify(raceHeader(A)));
  assert.equal(header.simVersion, SIM_VERSION); assert.deepEqual(configProblems(header.config), []); assert.equal(header.config.seed, A.seed);
  const first = play(A, 60 * 40);
  const B = Sim.create(12345);   // a different session altogether: only the header carries over
  Sim.reset(B, header.config);
  assert.deepEqual(play(B, 60 * 40), first);
});

test('raceHeader is plain data that does not alias the live state', () => {
  const S = Sim.create(1); Sim.reset(S, { mode: 'race', seed: 5 });
  const h = raceHeader(S); h.config.tune.assistLane = 99; h.simVersion = 0;
  assert.equal(S.config.tune.assistLane, 1); assert.equal(S.simVersion, SIM_VERSION);
});
