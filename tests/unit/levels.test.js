import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, TUNE_DEFS, PRESET_VERSION, createSettings } from '../../src/levels.js';

// A stand-in profile: the settings need `data` (the device's presets), the playing character's level, and `save`.
const profile = (settings = {}, level = 'veteran') => ({ data: { settings: { presets: {}, ...settings } }, character: { level }, current() { return this.character; }, setLevel(n) { this.character.level = n; }, saves: 0, save() { this.saves++; } });
const VETERAN = { gain: 2.6, curve: 2.55, maxLock: 1, speedDamp: 0.45, rate: 79, dead: 0.14, radius: 48, assistLane: 0.3, assistSpeed: 1.1 };
const ROOKIE = { ...VETERAN, assistLane: 1.5, assistSpeed: 1.5 };

test('the baked-in defaults are exactly the documented ones', () => {
  assert.deepEqual(LEVELS.veteran.tune, VETERAN); assert.equal(LEVELS.veteran.assist, false);
  assert.deepEqual(LEVELS.rookie.tune, ROOKIE); assert.equal(LEVELS.rookie.assist, true);
  assert.deepEqual(Object.keys(LEVELS), ['rookie', 'veteran']);
});

test('the tunables are consistent: every level defines each one, inside its slider range', () => {
  assert.equal(new Set(TUNE_DEFS.map(d => d.k)).size, TUNE_DEFS.length, 'keys are unique');
  for (const d of TUNE_DEFS) {
    assert.ok(d.min < d.max && d.step > 0 && d.label && d.hint, d.k);
    for (const [name, lv] of Object.entries(LEVELS)) {
      assert.ok(lv.tune[d.k] >= d.min && lv.tune[d.k] <= d.max, `${name}.${d.k} = ${lv.tune[d.k]} is outside ${d.min}..${d.max}`);
    }
  }
  for (const lv of Object.values(LEVELS)) assert.deepEqual(Object.keys(lv.tune).sort(), TUNE_DEFS.map(d => d.k).sort());
});

test('a new profile starts on Veteran with the Veteran defaults and assist off', () => {
  const s = createSettings(profile());
  assert.equal(s.level, 'veteran'); assert.deepEqual(s.tune, VETERAN); assert.equal(s.levelAssist(), false);
});

test('switching level loads that level and remembers the choice', () => {
  const p = profile(), s = createSettings(p), tuneObject = s.tune;
  s.loadLevel('rookie');
  assert.equal(s.level, 'rookie'); assert.deepEqual(s.tune, ROOKIE); assert.equal(s.levelAssist(), true);
  assert.equal(p.character.level, 'rookie', 'the level is the playing character\'s');
  assert.equal(s.tune, tuneObject, 'the tune object is updated in place (other code holds a reference to it)');
});

test('only a changed value is saved, per level; setting it back to the default removes it', () => {
  const p = profile(), s = createSettings(p);
  s.loadLevel('rookie'); s.setTuneValue('gain', 1.9);
  assert.deepEqual(p.data.settings.presets.rookie, { pv: PRESET_VERSION, tune: { gain: 1.9 }, assist: null });
  assert.equal(s.tune.gain, 1.9); assert.equal(p.saves, 1);
  s.setTuneValue('gain', 2.6);
  assert.deepEqual(p.data.settings.presets.rookie.tune, {});
  s.loadLevel('veteran'); assert.equal(s.tune.gain, 2.6);
});

test('saved tweaks are applied on the next start, and kept inside the slider range', () => {
  const p = profile({ presets: { veteran: { pv: PRESET_VERSION, tune: { gain: 3, rate: 9999, dead: -5 }, assist: null } } });
  const s = createSettings(p);
  assert.equal(s.tune.gain, 3);
  assert.equal(s.tune.rate, 100, 'clamped to the slider maximum');
  assert.equal(s.tune.dead, 0, 'clamped to the slider minimum');
  assert.equal(s.tune.curve, 2.55, 'untouched values follow the defaults');
});

test('tweaks saved under older defaults are discarded', () => {
  const p = profile({ presets: { veteran: { pv: PRESET_VERSION - 1, tune: { gain: 0.5 }, assist: true } } });
  const s = createSettings(p);
  assert.equal(s.tune.gain, 2.6); assert.equal(s.levelAssist(), false);
});

test('a deliberate assist choice is remembered only when it differs from the level default', () => {
  const p = profile(), s = createSettings(p);
  s.overridesFor('veteran').assist = true; assert.equal(s.levelAssist(), true);
  s.overridesFor('veteran').assist = null; assert.equal(s.levelAssist(), false);
});

test('using the settings never changes the shipped level data', () => {
  const before = JSON.stringify(LEVELS);
  const s = createSettings(profile()); s.loadLevel('rookie'); s.setTuneValue('gain', 1); s.loadLevel('veteran'); s.setTuneValue('rate', 10);
  assert.equal(JSON.stringify(LEVELS), before);
});

// A saved profile can be damaged or hand-edited. Nothing in it may stop the game from starting.
const HOSTILE_LEVELS = ['nope', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 42, null, {}, ['rookie']];
for (const lv of HOSTILE_LEVELS) {
  test(`a saved level of ${JSON.stringify(lv)} falls back to Veteran`, () => {
    const s = createSettings(profile({}, lv));
    assert.equal(s.level, 'veteran'); assert.deepEqual(s.tune, VETERAN);
  });
}
const HOSTILE_PRESETS = ['x', 5, null, [], [1, 2], { veteran: 5 }, { veteran: null }, { veteran: 'x' }, { veteran: { pv: PRESET_VERSION, tune: null } }, { veteran: { pv: PRESET_VERSION, tune: 'x' } },
  { veteran: { pv: PRESET_VERSION, tune: [1] } }, { veteran: { pv: PRESET_VERSION, tune: { gain: 'abc', curve: null, rate: {}, dead: [1], maxLock: true } } }];
for (const presets of HOSTILE_PRESETS) {
  test(`damaged presets never stop the game starting: ${JSON.stringify(presets)}`, () => {
    const s = createSettings(profile({ presets }));
    for (const d of TUNE_DEFS) assert.ok(Number.isFinite(s.tune[d.k]) && s.tune[d.k] >= d.min && s.tune[d.k] <= d.max, `${d.k} = ${s.tune[d.k]}`);
    assert.doesNotThrow(() => s.setTuneValue('gain', 2));
  });
}
for (const assist of ['yes', 1, 0, 'false', {}, []]) {
  test(`a non-boolean saved assist value (${JSON.stringify(assist)}) is ignored`, () => {
    const s = createSettings(profile({ presets: { veteran: { pv: PRESET_VERSION, tune: {}, assist } } }));
    assert.equal(s.levelAssist(), false, 'falls back to the level default, and is a real boolean');
    assert.equal(typeof s.levelAssist(), 'boolean');
  });
}

test('another character playing: reload takes up their level, and the device\'s tuning stays', () => {
  const p = profile({ presets: { rookie: { pv: PRESET_VERSION, tune: { gain: 1.5 }, assist: null } } }), s = createSettings(p);
  assert.equal(s.level, 'veteran');
  p.character = { level: 'rookie' }; s.reload();
  assert.equal(s.level, 'rookie'); assert.equal(s.tune.gain, 1.5, 'presets are per device, so the same tuning applies to whoever plays'); assert.equal(s.levelAssist(), true);
  p.character = { level: 'nonsense' }; s.reload(); assert.equal(s.level, 'veteran', 'an unknown level falls back to Veteran');
});
