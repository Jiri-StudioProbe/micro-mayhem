import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, PROFILE_KEY } from '../../src/profile.js';
import { memoryStorage, throwingStorage } from '../helpers/storage.js';

const FRESH = { version: 2, settings: { level: 'veteran', presets: {} }, races: [], bests: {} };

test('a fresh profile has the defaults and writes nothing until saved', () => {
  const st = memoryStorage();
  const p = createProfile(st);
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

test('what is saved is what is loaded next time', () => {
  const st = memoryStorage();
  const a = createProfile(st);
  a.data.settings.level = 'rookie'; a.data.settings.presets.rookie = { pv: 1, tune: { gain: 1.5 }, assist: false };
  a.save();
  const b = createProfile(st);
  assert.equal(b.data.settings.level, 'rookie');
  assert.deepEqual(b.data.settings.presets.rookie, { pv: 1, tune: { gain: 1.5 }, assist: false });
});

test('unknown fields survive a load and save (a newer version of the game may have written them)', () => {
  const st = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 1, settings: { level: 'veteran', presets: {} }, driver: { name: 'Ada' } }) });
  const p = createProfile(st); p.save();
  assert.deepEqual(JSON.parse(st.m.get(PROFILE_KEY)).driver, { name: 'Ada' });
});

test('damaged parts of an otherwise valid profile are repaired, the rest is kept', () => {
  const p = createProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 1, settings: { level: 7, presets: 'x' }, driver: { name: 'Ada' } }) }));
  assert.equal(p.data.settings.level, 'veteran'); assert.deepEqual(p.data.settings.presets, {});
  assert.deepEqual(p.data.driver, { name: 'Ada' });
});

test('missing parts of a saved profile are filled with defaults', () => {
  const p = createProfile(memoryStorage({ [PROFILE_KEY]: '{"settings":{"level":"rookie"}}' }));
  assert.equal(p.data.settings.level, 'rookie');
  assert.deepEqual(p.data.settings.presets, {});
  assert.equal(p.data.version, 2, 'a profile from before M2 is migrated');
});

for (const bad of ['{not json', 'null', '"text"', '[1,2]', '42', '', '{"version":1,"settings":"x"}', '{"settings":null}', '{"settings":[1]}']) {
  test(`a corrupt saved profile is ignored, never an error: ${JSON.stringify(bad)}`, () => {
    const p = createProfile(memoryStorage({ [PROFILE_KEY]: bad }));
    assert.equal(p.data.version, 2);
    assert.deepEqual([p.data.races, p.data.bests], [[], {}]);
    assert.equal(typeof p.data.settings.level, 'string');
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
    p.data.settings.level = 'rookie';
    assert.doesNotThrow(() => p.save());
    assert.equal(p.data.settings.level, 'rookie', 'in-memory data is still usable');
  }
});

import { cleanProfileDoc } from '../../src/profile.js';
import { goodRecord } from '../helpers/records.js';

test('cleanProfileDoc: null for what is not a profile; for what is, a clean copy that shares nothing with the input', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { settings: null }, { settings: [] }, { settings: 'x' }]) assert.equal(cleanProfileDoc(x), null, JSON.stringify(x));
  const raw = { settings: { level: 'rookie', presets: { rookie: { pv: 1, tune: {}, assist: null } } }, extra: { a: 1 } };
  const c = cleanProfileDoc(raw);
  assert.deepEqual([c.version, c.races, c.bests, c.extra], [2, [], {}, { a: 1 }]);
  c.settings.level = 'x'; assert.equal(raw.settings.level, 'rookie', 'the settings object is a copy');
});

test('a __proto__ field in a stored or imported document does not change what the profile inherits from', () => {
  const st = memoryStorage({ [PROFILE_KEY]: '{"__proto__":{"evil":1,"races":["x"]},"settings":{"__proto__":{"level":"hacked"},"level":"rookie"}}' });
  const p = createProfile(st);
  assert.equal(Object.getPrototypeOf(p.data), Object.prototype); assert.equal(p.data.evil, undefined); assert.equal(Object.getPrototypeOf(p.data.settings), Object.prototype);
  assert.equal(p.data.settings.level, 'rookie'); assert.deepEqual(p.data.races, []); assert.equal({}.evil, undefined);
});

test('replace swaps the whole document in place, writes it first, and does nothing if it cannot', () => {
  const st = memoryStorage(), p = createProfile(st), ref = p.data;
  const r = goodRecord(); r.id = 'keep';
  assert.equal(p.replace({ settings: { level: 'rookie', presets: {} }, races: [r], note: 'n' }), true);
  assert.equal(p.data, ref, 'the same object: whoever holds it sees the new document'); assert.deepEqual([p.data.settings.level, p.data.races.length, p.data.note], ['rookie', 1, 'n']);
  assert.equal(JSON.parse(st.m.get(PROFILE_KEY)).races[0].id, 'keep'); assert.equal(typeof p.data.updatedAt, 'string');
  assert.equal(createProfile(st).data.races[0].id, 'keep', 'and it is what the next visit loads');
  const before = JSON.stringify(p.data);
  assert.equal(p.replace({ settings: 5 }), false); assert.equal(p.replace(null), false); assert.equal(JSON.stringify(p.data), before, 'a document that is not a profile changes nothing');
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(p.replace({ settings: { level: 'veteran', presets: {} }, races: [] }), false); assert.equal(JSON.stringify(p.data), before, 'a failed write changes nothing in memory either');
  assert.equal(createProfile(null).replace({ settings: { level: 'x', presets: {} } }), false, 'no storage at all: it cannot keep anything');
});
