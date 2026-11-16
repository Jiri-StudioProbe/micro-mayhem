import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, cleanProfileDoc, PROFILE_KEY } from '../../src/profile.js';
import { memoryStorage, throwingStorage } from '../helpers/storage.js';
import { goodRecord } from '../helpers/records.js';
import { ctx, T0 } from '../helpers/household.js';

// What a brand-new profile holds (ids and dates come from the test's own source, so they can be compared).
const FRESH = { version: 3, settings: { presets: {}, character: 'gen-2' }, household: { id: 'gen-1', createdAt: T0 },
  characters: [{ id: 'gen-2', name: 'Player', level: 'veteran', createdAt: T0, updatedAt: T0, races: [], bests: {} }] };

test('a fresh profile is a household with one character, Player, on Veteran; it writes nothing until saved', () => {
  const st = memoryStorage();
  const p = createProfile(st, ctx());
  assert.deepEqual(p.data, FRESH);
  assert.equal(st.writes, 0);
  p.save();
  assert.equal(st.writes, 1);
  const saved = JSON.parse(st.m.get(PROFILE_KEY));
  assert.equal(typeof saved.updatedAt, 'string', 'every save stamps updatedAt (the cloud sync will compare it)');
  assert.ok(Math.abs(Date.parse(saved.updatedAt) - Date.now()) < 5000);
  delete saved.updatedAt;
  assert.deepEqual(saved, FRESH);
});

test('what is saved is what is loaded next time: the device\'s presets, and the character\'s level', () => {
  const st = memoryStorage(), a = createProfile(st);
  a.setLevel('rookie'); a.data.settings.presets.rookie = { pv: 1, tune: { gain: 1.5 }, assist: false };
  a.save();
  const b = createProfile(st);
  assert.equal(b.current().level, 'rookie'); assert.equal(b.current().id, a.current().id); assert.equal(b.data.household.id, a.data.household.id);
  assert.deepEqual(b.data.settings.presets.rookie, { pv: 1, tune: { gain: 1.5 }, assist: false });
  assert.equal(b.data.settings.level, undefined, 'the level is no longer a device setting');
});

test('unknown fields survive a load and save, at the top and in a character (a newer version of the game may have written them)', () => {
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 3, settings: { presets: {} }, driver: { name: 'Ada' }, characters: [{ id: 'c1', name: 'Ada', livery: { body: '#f00' } }] }) });
  const p = createProfile(st); p.save();
  const saved = JSON.parse(st.m.get(PROFILE_KEY));
  assert.deepEqual(saved.driver, { name: 'Ada' }); assert.deepEqual(saved.characters[0].livery, { body: '#f00' });
});

test('damaged parts of an otherwise valid profile are repaired, the rest is kept', () => {
  const p = createProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 1, settings: { level: 7, presets: 'x' }, driver: { name: 'Ada' } }) }));
  assert.equal(p.current().level, 'veteran'); assert.deepEqual(p.data.settings.presets, {});
  assert.deepEqual(p.data.driver, { name: 'Ada' });
});

test('missing parts of a saved profile are filled with defaults', () => {
  const p = createProfile(memoryStorage({ [PROFILE_KEY]: '{"settings":{"level":"rookie"}}' }));
  assert.equal(p.current().level, 'rookie', 'the saved level becomes the level of the one character');
  assert.deepEqual(p.data.settings.presets, {});
  assert.equal(p.data.version, 3, 'a profile from before M3.1 is migrated');
  assert.equal(p.data.characters.length, 1);
});

for (const bad of ['{not json', 'null', '"text"', '[1,2]', '42', '', '{"version":1,"settings":"x"}', '{"settings":null}', '{"settings":[1]}']) {
  test(`a corrupt saved profile is ignored, never an error: ${JSON.stringify(bad)}`, () => {
    const p = createProfile(memoryStorage({ [PROFILE_KEY]: bad }));
    assert.equal(p.data.version, 3);
    assert.equal(p.data.characters.length, 1); assert.deepEqual([p.current().races, p.current().bests], [[], {}]);
    assert.equal(typeof p.current().level, 'string');
    const presets = p.data.settings.presets;
    assert.ok(presets !== null && typeof presets === 'object' && !Array.isArray(presets), 'presets is a plain object');
  });
}

test('keys from before the profile existed are deleted; unrelated keys are left alone', () => {
  const st = memoryStorage({ 'mm-tune': '{}', 'mm-assist': '1', 'someone-elses-key': 'keep' });
  createProfile(st);
  assert.equal(st.m.has('mm-tune'), false); assert.equal(st.m.has('mm-assist'), false);
  assert.equal(st.m.get('someone-elses-key'), 'keep');
});

test('storage that is missing or throws never breaks the game; it just does not persist', () => {
  for (const st of [null, undefined, throwingStorage('all'), throwingStorage('get'), throwingStorage('set')]) {
    const p = createProfile(st);
    assert.deepEqual(p.data.settings.presets, {});
    p.setLevel('rookie');
    assert.doesNotThrow(() => p.save());
    assert.equal(p.current().level, 'rookie', 'in-memory data is still usable');
  }
});

test('cleanProfileDoc: null for what is not a profile; for what is, a clean copy: its document, settings, presets and characters are new objects', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { settings: null }, { settings: [] }, { settings: 'x' }]) assert.equal(cleanProfileDoc(x), null, JSON.stringify(x));
  const raw = { settings: { level: 'rookie', presets: { rookie: { pv: 1, tune: {}, assist: null } } }, extra: { a: 1 } };
  const c = cleanProfileDoc(raw, ctx());
  assert.deepEqual([c.version, c.characters[0].races, c.characters[0].bests, c.extra, c.races, c.bests], [3, [], {}, { a: 1 }, undefined, undefined]);
  c.settings.presets.rookie.pv = 9; assert.equal(raw.settings.presets.rookie.pv, 1, 'the settings are a copy');
  c.characters[0].level = 'x'; assert.equal(raw.characters, undefined, 'the characters are its own');
});

test('a __proto__ field in a stored or imported document does not change what the profile inherits from', () => {
  const st = memoryStorage({ [PROFILE_KEY]: '{"__proto__":{"evil":1,"races":["x"]},"household":{"__proto__":{"evil":2}},"characters":[{"__proto__":{"evil":3},"id":"c1","name":"Ada"}],"settings":{"__proto__":{"level":"hacked"},"level":"rookie"}}' });
  const p = createProfile(st);
  const c = p.current();
  for (const o of [p.data, p.data.settings, p.data.household, c]) assert.equal(Object.getPrototypeOf(o), Object.prototype);
  assert.equal(p.data.evil, undefined); assert.equal(c.evil, undefined); assert.equal(p.data.household.evil, undefined); assert.equal({}.evil, undefined);
  assert.equal(c.id, 'c1'); assert.deepEqual(c.races, []); assert.equal(c.level, 'veteran', 'settings.level is only the level of the migrated character when there were no characters');
});

test('replace swaps the whole document in place, writes it first, and does nothing if it cannot', () => {
  const st = memoryStorage(), p = createProfile(st), ref = p.data;
  const r = goodRecord(); r.id = 'keep';
  assert.equal(p.replace({ settings: { presets: {} }, characters: [{ id: 'c9', name: 'Zed', level: 'rookie', races: [r] }], note: 'n' }), true);
  assert.equal(p.data, ref, 'the same object: whoever holds it sees the new document');
  assert.deepEqual([p.current().id, p.current().level, p.current().races.length, p.data.note], ['c9', 'rookie', 1, 'n']);
  assert.equal(JSON.parse(st.m.get(PROFILE_KEY)).characters[0].races[0].id, 'keep'); assert.equal(typeof p.data.updatedAt, 'string');
  assert.equal(createProfile(st).current().races[0].id, 'keep', 'and it is what the next visit loads');
  const before = JSON.stringify(p.data);
  assert.equal(p.replace({ settings: 5 }), false); assert.equal(p.replace(null), false); assert.equal(JSON.stringify(p.data), before, 'a document that is not a profile changes nothing');
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(p.replace({ settings: { presets: {} }, characters: [] }), false); assert.equal(JSON.stringify(p.data), before, 'a failed write changes nothing in memory either');
  assert.equal(createProfile(null).replace({ settings: { presets: {} } }), false, 'no storage at all: it cannot keep anything');
});

test('the playing character: the one the device remembers, else the first; switching is remembered once saved', () => {
  const doc = { settings: { presets: {}, character: 'b' }, characters: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }] };
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify(doc) }), p = createProfile(st);
  assert.equal(p.current().name, 'Bo');
  assert.equal(p.setCurrent('a'), true); assert.equal(p.current().name, 'Ada'); p.save();
  assert.equal(createProfile(st).current().name, 'Ada');
  assert.equal(p.setCurrent('nobody'), false); assert.equal(p.current().name, 'Ada', 'an unknown id changes nothing');
  for (const remembered of ['nobody', 7, null, {}, '__proto__']) assert.equal(createProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify({ ...doc, settings: { presets: {}, character: remembered } }) })).current().name, 'Ada', JSON.stringify(remembered));
});

test('changing the level touches the character\'s updatedAt only when the level changes (the cloud sync compares it)', () => {
  let t = 0; const p = createProfile(memoryStorage(), { newId: (n => () => 'id' + (++n))(0), now: () => 'T' + (t++) });
  const before = p.current().updatedAt;
  p.setLevel('veteran'); assert.equal(p.current().updatedAt, before, 'the same level: untouched');
  p.setLevel('rookie'); assert.notEqual(p.current().updatedAt, before);
});
