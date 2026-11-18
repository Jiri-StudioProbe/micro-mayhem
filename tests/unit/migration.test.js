import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, cleanProfileDoc, PROFILE_KEY } from '../../src/profile.js';
import { addRace, MAX_RACES, bestsFromRaces } from '../../src/records.js';
import { memoryStorage } from '../helpers/storage.js';
import { goodRecord, finishRecord } from '../helpers/records.js';
import { ctx, T0 } from '../helpers/household.js';

const load = (doc, c) => createProfile(memoryStorage({ [PROFILE_KEY]: typeof doc === 'string' ? doc : JSON.stringify(doc) }), c);
// Profiles as the game saved them before households. Version 1 (M0 to M1): settings only, with tweaks and a field a newer game might add.
const V1 = { version: 1, settings: { level: 'rookie', presets: { rookie: { pv: 1, tune: { gain: 1.5, dead: 0.2 }, assist: false }, veteran: { pv: 1, tune: {}, assist: null } } }, driver: { name: 'Ada' } };
// Version 2 (M2): the history and the bests at the top, the level in the settings.
const v2 = (races, bests = bestsFromRaces(races), settings = V1.settings) => ({ version: 2, settings, races, bests, updatedAt: '2026-11-13T09:00:00.000Z' });

test('a version 1 profile becomes version 3: its tuning stays on the device, its level goes to the one character, unknown fields are untouched', () => {
  const p = load(V1, ctx());
  assert.equal(p.data.version, 3);
  assert.deepEqual(p.data.settings.presets, V1.settings.presets); assert.equal(p.data.settings.level, undefined, 'the level left the device settings');
  assert.deepEqual(p.data.driver, { name: 'Ada' });
  assert.equal(p.data.characters.length, 1);
  assert.deepEqual(p.current(), { id: 'gen-2', name: 'Player', level: 'rookie', createdAt: T0, updatedAt: T0, races: [], bests: {} });
  assert.deepEqual(p.data.household, { id: 'gen-1', createdAt: T0, deleted: {} });
  assert.equal(p.data.races, undefined); assert.equal(p.data.bests, undefined, 'nothing is left at the top');
});

test('a version 2 profile becomes one character holding exactly the old history, bests and level; nothing is lost or reordered', () => {
  const rs = [finishRecord('a', 83.4, [28, 27.3, 27.9]), goodRecord({ kind: 'wrecked' }), finishRecord('b', 80.1, [27, 26.5, 26.6], { level: 'rookie', assist: true })];
  rs[1].id = 'w'; rs[0].ts = '2026-11-12T10:00:00.000Z'; rs[1].ts = '2026-11-12T09:00:00.000Z'; rs[2].ts = '2026-11-12T11:00:00.000Z';   // stored order is not date order
  const doc = v2(rs), before = JSON.stringify(doc);
  const p = load(doc, ctx()), c = p.current();
  assert.deepEqual(c.races.map(r => r.id), ['a', 'w', 'b'], 'the stored order is kept');
  assert.deepEqual(c.races, rs); assert.deepEqual(c.bests, bestsFromRaces(rs)); assert.equal(c.level, 'rookie'); assert.equal(c.name, 'Player');
  assert.equal(p.data.characters.length, 1); assert.equal(p.data.settings.character, c.id);
  assert.equal(JSON.stringify(doc), before, 'the stored document object is not changed by loading it');
});

test('bests that outlive the history (a best whose race was trimmed away) survive the migration', () => {
  const r = finishRecord('r', 80, [27, 26, 26]);
  const stored = { 'classic/veteran/manual': { time: 70, timeRace: 'gone', bestLap: 27.5, bestLapRace: 'gone' } };
  const c = load(v2([r], stored), ctx()).current();
  assert.deepEqual(c.bests['classic/veteran/manual'], { time: 70, timeRace: 'gone', bestLap: 26, bestLapRace: 'r' }, 'best time from the stored bests, best lap from the race');
});

test('the migration is saved only when the game saves, and is stable: loading a migrated profile changes nothing', () => {
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify(v2([finishRecord('a', 80, [27, 26, 26])])) });
  const p = createProfile(st); assert.equal(st.writes, 0, 'loading does not write');
  p.save(); const once = JSON.parse(st.m.get(PROFILE_KEY));
  const q = createProfile(st); q.save(); const twice = JSON.parse(st.m.get(PROFILE_KEY));
  delete once.updatedAt; delete twice.updatedAt;
  assert.deepEqual(twice, once, 'the same ids, names, dates and races after another load and save'); assert.equal(once.version, 3);
});

test('the history and bests survive a save and a reload exactly', () => {
  const st = memoryStorage(), a = createProfile(st);
  const info = addRace(a.current(), finishRecord('one', 80, [27, 26, 26])); addRace(a.current(), finishRecord('two', 78, [26, 26, 25.5], { level: 'rookie', assist: true }));
  a.save();
  const b = createProfile(st);
  assert.deepEqual(b.current().races, a.current().races); assert.deepEqual(b.current().bests, a.current().bests);
  assert.equal(info.newBestTime, true);
  assert.equal(b.current().bests['classic/rookie/assist'].time, 78);
});

test('a damaged record is dropped and the others kept; the bests never contain anything a dropped record said', () => {
  const good1 = finishRecord('g1', 80, [27, 26, 26]), good2 = finishRecord('g2', 79, [26, 26, 26]);
  const bad = { ...finishRecord('bad', 1, [1, 1, 1]), result: { kind: 'finish', place: 0 } }, junk = 'nonsense', cheat = finishRecord('cheat', -5, [27, 26, 26]);
  cheat.result.time = -5;
  const p = load(v2([good1, bad, junk, null, good2, cheat], {}), ctx());
  assert.deepEqual(p.current().races.map(r => r.id), ['g1', 'g2']);
  assert.equal(p.current().bests['classic/veteran/manual'].time, 79);
});

test('garbage in races and bests is repaired, whatever its shape', () => {
  for (const races of [null, 5, 'x', {}, { length: 3 }, [[]], [null, 1, 'a', {}, []], true]) for (const bests of [null, 5, 'x', [], [1], { 'a/b/manual': 5 }, { __proto__: { x: 1 } }]) {
    const p = load({ version: 2, settings: V1.settings, races, bests }, ctx());
    assert.deepEqual([p.current().races, p.current().bests], [[], {}], JSON.stringify([races, bests]));
  }
  const p = load('{"version":2,"settings":{"level":"rookie","presets":{}},"races":[],"bests":{"__proto__":{"time":1,"bestLap":1}}}', ctx());
  assert.deepEqual(p.current().bests, {}); assert.equal({}.time, undefined);
});

test('garbage where the characters should be is repaired too: a household always has someone to play as', () => {
  for (const characters of [null, 5, 'x', {}, [], [null, 1, 'a', [], {}], [{ name: 'no id' }], [{ id: '' }], [{ id: 7 }], { length: 2, 0: { id: 'a' } }]) {
    const p = load({ version: 3, settings: { presets: {} }, characters }, ctx());
    assert.equal(p.data.characters.length, 1, JSON.stringify(characters)); assert.equal(p.current().name, 'Player');
  }
});

test('a profile from a NEWER game keeps its version and the fields this one does not know (an old cached page must not downgrade it)', () => {
  const r = goodRecord(); r.inputs = 'future-data';
  const doc = { version: 5, household: { id: 'h', createdAt: T0, plan: 'family' }, settings: { presets: {}, theme: 'dark' }, characters: [{ id: 'c1', name: 'Ada', level: 'veteran', races: [r], bests: {}, garage: { selected: 'scout' }, wallet: 40 }], cloud: { etag: 'x' } };
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify(doc) });
  const p = createProfile(st); p.save();
  const saved = JSON.parse(st.m.get(PROFILE_KEY));
  assert.equal(saved.version, 5); assert.deepEqual(saved.cloud, { etag: 'x' }); assert.equal(saved.settings.theme, 'dark'); assert.equal(saved.household.plan, 'family');
  assert.deepEqual(saved.characters[0].garage, { selected: 'scout' }); assert.equal(saved.characters[0].wallet, 40);
  assert.equal(saved.characters[0].races[0].inputs, 'future-data', 'a field the record gained in a newer version survives');
});

test('races an older page saved after the migration (left at the top) are added to the character who is playing, not lost', () => {
  const mine = finishRecord('mine', 80, [27, 26, 26]), stray = finishRecord('stray', 70, [24, 23, 23]); stray.ts = '2026-11-15T10:00:00.000Z';
  const doc = { version: 3, household: { id: 'h', createdAt: T0 }, settings: { presets: {}, character: 'b', level: 'veteran' },
    characters: [{ id: 'a', name: 'Ada', races: [] }, { id: 'b', name: 'Bo', races: [mine] }], races: [stray, mine], bests: {} };
  const p = load(doc, ctx()), bo = p.data.characters[1];
  assert.deepEqual(bo.races.map(r => r.id), ['mine', 'stray'], 'merged in date order, without a second copy of a race that was already there');
  assert.deepEqual(p.data.characters[0].races, []); assert.equal(bo.bests['classic/veteran/manual'].time, 70);
  assert.equal(p.data.races, undefined); assert.equal(p.data.settings.level, undefined);
});

test('a race left at the top that is already in another character is not added a second time (a race id is unique in the household)', () => {
  const x = finishRecord('x', 80, [27, 26, 26]);
  const doc = { version: 3, household: { id: 'h', createdAt: T0 }, settings: { presets: {}, character: 'b' }, characters: [{ id: 'a', name: 'Ada', races: [x] }, { id: 'b', name: 'Bo', races: [] }], races: [x] };
  const p = load(doc, ctx());
  assert.deepEqual(p.data.characters.map(c => c.races.length), [1, 0]);
});

test('only the latest 500 races of a longer stored history are loaded, and the profile stays small', () => {
  const many = Array.from({ length: MAX_RACES + 100 }, (_, i) => ({ ...finishRecord('m' + i, 90 + (i % 7), [30, 30, 30]) }));
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify(v2(many, {})) });
  const p = createProfile(st); assert.equal(p.current().races.length, MAX_RACES); assert.equal(p.current().races[0].id, 'm100');
  p.save(); const size = st.m.get(PROFILE_KEY).length;
  assert.ok(size < 400000, `a full history is ${size} bytes (localStorage allows about 5,000,000)`);
});

test('a full household stays well inside what localStorage allows (8 characters with 500 races each)', () => {
  const chars = Array.from({ length: 8 }, (_, c) => ({ id: 'c' + c, name: 'P' + c, races: Array.from({ length: MAX_RACES }, (_, i) => finishRecord(`c${c}r${i}`, 90 + (i % 7), [30, 30, 30])) }));
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 3, settings: { presets: {} }, characters: chars }) });
  const p = createProfile(st); assert.equal(p.data.characters.length, 8); assert.ok(p.data.characters.every(c => c.races.length === MAX_RACES));
  p.save(); const size = st.m.get(PROFILE_KEY).length;
  assert.ok(size < 2200000, `eight full histories are ${size} bytes (localStorage allows about 5,000,000)`);
});

test('storage that fails while saving a race loses that save, never the game', () => {
  const st = memoryStorage(); const p = createProfile(st);
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  addRace(p.current(), goodRecord()); assert.doesNotThrow(() => p.save());
  assert.equal(p.current().races.length, 1, 'the race is still in memory for this session');
});

test('migrating the same old profile on two devices gives two different households (an old backup is therefore merged into a character, see backup.js)', () => {
  const doc = v2([finishRecord('a', 80, [27, 26, 26])]);
  const a = cleanProfileDoc(doc), b = cleanProfileDoc(doc);
  assert.notEqual(a.household.id, b.household.id); assert.notEqual(a.characters[0].id, b.characters[0].id);
  assert.deepEqual(a.characters[0].races, b.characters[0].races);
});
