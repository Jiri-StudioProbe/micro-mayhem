import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, PROFILE_KEY } from '../../src/profile.js';
import { addRace, MAX_RACES } from '../../src/records.js';
import { memoryStorage } from '../helpers/storage.js';
import { goodRecord, finishRecord } from '../helpers/records.js';

const load = doc => createProfile(memoryStorage({ [PROFILE_KEY]: typeof doc === 'string' ? doc : JSON.stringify(doc) }));
// A profile as the game saved it before M2 (version 1): settings only, with tweaks and a field a newer game might add.
const V1 = { version: 1, settings: { level: 'rookie', presets: { rookie: { pv: 1, tune: { gain: 1.5, dead: 0.2 }, assist: false }, veteran: { pv: 1, tune: {}, assist: null } } }, driver: { name: 'Ada' } };

test('a version 1 profile becomes version 2: its settings and unknown fields are untouched, with an empty history', () => {
  const p = load(V1);
  assert.equal(p.data.version, 2);
  assert.deepEqual(p.data.settings, V1.settings); assert.deepEqual(p.data.driver, { name: 'Ada' });
  assert.deepEqual([p.data.races, p.data.bests], [[], {}]);
});

test('the migration is saved only when the game saves, and is stable: loading a migrated profile changes nothing', () => {
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify(V1) });
  const p = createProfile(st); assert.equal(st.writes, 0, 'loading does not write');
  p.save(); const once = JSON.parse(st.m.get(PROFILE_KEY));
  const q = createProfile(st); q.save(); const twice = JSON.parse(st.m.get(PROFILE_KEY));
  delete once.updatedAt; delete twice.updatedAt;
  assert.deepEqual(twice, once); assert.equal(once.version, 2);
});

test('the history and bests survive a save and a reload exactly', () => {
  const st = memoryStorage(), a = createProfile(st);
  const info = addRace(a.data, finishRecord('one', 80, [27, 26, 26])); addRace(a.data, finishRecord('two', 78, [26, 26, 25.5], { level: 'rookie', assist: true }));
  a.save();
  const b = createProfile(st);
  assert.deepEqual(b.data.races, a.data.races); assert.deepEqual(b.data.bests, a.data.bests);
  assert.equal(info.newBestTime, true);
  assert.equal(b.data.bests['classic/rookie/assist'].time, 78);
});

test('a damaged record is dropped and the others kept; the bests never contain anything a dropped record said', () => {
  const good1 = finishRecord('g1', 80, [27, 26, 26]), good2 = finishRecord('g2', 79, [26, 26, 26]);
  const bad = { ...finishRecord('bad', 1, [1, 1, 1]), result: { kind: 'finish', place: 0 } }, junk = 'nonsense', cheat = finishRecord('cheat', -5, [27, 26, 26]);
  cheat.result.time = -5;
  const p = load({ version: 2, settings: V1.settings, races: [good1, bad, junk, null, good2, cheat], bests: {} });
  assert.deepEqual(p.data.races.map(r => r.id), ['g1', 'g2']);
  assert.equal(p.data.bests['classic/veteran/manual'].time, 79);
});

test('stored bests are never worse than the history shows, and a best whose race was trimmed away is kept', () => {
  const r = finishRecord('r', 80, [27, 26, 26]);
  const stored = { 'classic/veteran/manual': { time: 70, timeRace: 'gone', bestLap: 27.5, bestLapRace: 'gone' } };
  const p = load({ version: 2, settings: V1.settings, races: [r], bests: stored });
  assert.deepEqual(p.data.bests['classic/veteran/manual'], { time: 70, timeRace: 'gone', bestLap: 26, bestLapRace: 'r' }, 'best time from the stored bests, best lap from the race');
});

test('garbage in races and bests is repaired, whatever its shape', () => {
  for (const races of [null, 5, 'x', {}, { length: 3 }, [[]], [null, 1, 'a', {}, []], true]) for (const bests of [null, 5, 'x', [], [1], { 'a/b/manual': 5 }, { __proto__: { x: 1 } }]) {
    const p = load({ version: 2, settings: V1.settings, races, bests });
    assert.deepEqual([p.data.races, p.data.bests], [[], {}], JSON.stringify([races, bests]));
  }
  const p = load('{"version":2,"settings":{"level":"rookie","presets":{}},"races":[],"bests":{"__proto__":{"time":1,"bestLap":1}}}');
  assert.deepEqual(p.data.bests, {}); assert.equal({}.time, undefined);
});

test('a profile from a NEWER game keeps its version and the fields this one does not know (an old cached page must not downgrade it)', () => {
  const r = goodRecord(); r.inputs = 'future-data';
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 5, settings: V1.settings, races: [r], bests: {}, garage: { selected: 'scout' }, wallet: 40 }) });
  const p = createProfile(st); p.save();
  const saved = JSON.parse(st.m.get(PROFILE_KEY));
  assert.equal(saved.version, 5); assert.deepEqual(saved.garage, { selected: 'scout' }); assert.equal(saved.wallet, 40);
  assert.equal(saved.races[0].inputs, 'future-data', 'a field the record gained in a newer version survives');
});

test('only the latest 500 races of a longer stored history are loaded, and the profile stays small', () => {
  const many = Array.from({ length: MAX_RACES + 100 }, (_, i) => ({ ...finishRecord('m' + i, 90 + (i % 7), [30, 30, 30]) }));
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 2, settings: V1.settings, races: many, bests: {} }) });
  const p = createProfile(st); assert.equal(p.data.races.length, MAX_RACES); assert.equal(p.data.races[0].id, 'm100');
  p.save(); const size = st.m.get(PROFILE_KEY).length;
  assert.ok(size < 400000, `a full history is ${size} bytes (localStorage allows about 5,000,000)`);
});

test('storage that fails while saving a race loses that save, never the game', () => {
  const st = memoryStorage(); const p = createProfile(st);
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  addRace(p.data, goodRecord()); assert.doesNotThrow(() => p.save());
  assert.equal(p.data.races.length, 1, 'the race is still in memory for this session');
});
