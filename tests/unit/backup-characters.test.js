import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBackup, decodeBackup, mergeProfiles, previewImport, rawRaceCount, isLegacyDoc } from '../../src/backup.js';
import { cleanProfileDoc } from '../../src/profile.js';
import { MAX_CHARACTERS, newCharacter, isPristine } from '../../src/household.js';
import { bestsFromRaces } from '../../src/records.js';
import { finishRecord } from '../helpers/records.js';
import { character, profileDoc, T0, ctx } from '../helpers/household.js';

const race = (id, day, time = 80, level = 'veteran') => { const r = finishRecord(id, time, [27, 26, 26], { level }); r.ts = new Date(Date.UTC(2026, 10, day)).toISOString(); return r; };
const ids = c => c.races.map(r => r.id);
const byId = (d, id) => d.characters.find(c => c.id === id);

test('characters are matched by id: the same one gets the races it lacks, a character this device does not have is added', () => {
  const local = profileDoc([character('a', 'Ada', [race('a1', 1)]), character('b', 'Bo', [race('b1', 2)])]);
  const other = profileDoc([character('a', 'Ada', [race('a1', 1), race('a2', 3)]), character('c', 'Cy', [race('c1', 4)])]);
  const m = mergeProfiles(local, other);
  assert.deepEqual(m.characters.map(c => c.id), ['a', 'b', 'c']);
  assert.deepEqual(ids(byId(m, 'a')), ['a1', 'a2']); assert.deepEqual(ids(byId(m, 'b')), ['b1']); assert.deepEqual(ids(byId(m, 'c')), ['c1']);
  assert.deepEqual(local.characters.map(c => c.id), ['a', 'b'], 'the arguments are not changed');
});

test('what stays as it is on this device: settings, which character plays, the household id, and every name and level', () => {
  const local = profileDoc([character('a', 'Ada', [], { level: 'rookie' })], { settings: { presets: { rookie: { pv: 1, tune: { gain: 1.2 }, assist: null } } } });
  const other = profileDoc([character('a', 'Renamed', [race('z', 1)], { level: 'veteran' })], { settings: { presets: {}, character: 'a' } });
  other.household.id = 'someone-elses';
  const m = mergeProfiles(local, other);
  assert.deepEqual(m.settings, local.settings); assert.equal(m.household.id, 'house-1');
  assert.deepEqual([byId(m, 'a').name, byId(m, 'a').level], ['Ada', 'rookie']);
});

test('an added character gets a name that differs from the others\', and the races that are already in another character are not added twice', () => {
  const local = profileDoc([character('a', 'Ada', [race('shared', 1)])]);
  const other = profileDoc([character('x', 'ada', [race('shared', 1), race('own', 2)])]);
  const m = mergeProfiles(local, other);
  assert.deepEqual(m.characters.map(c => c.name), ['Ada', 'ada 2']); assert.deepEqual(ids(byId(m, 'x')), ['own']);
  assert.equal(new Set(m.characters.flatMap(c => ids(c))).size, 2, 'every race id appears once in the household');
});

test('a household holds 8: characters beyond that are left out, and the preview says so', () => {
  const local = profileDoc(Array.from({ length: 7 }, (_, i) => character('l' + i, 'L' + i)));
  const other = profileDoc(Array.from({ length: 4 }, (_, i) => character('o' + i, 'O' + i, [race('r' + i, i + 1)])));
  const m = mergeProfiles(local, other);
  assert.equal(m.characters.length, MAX_CHARACTERS); assert.deepEqual(m.characters.slice(7).map(c => c.id), ['o0']);
  const p = previewImport(local, other);
  assert.deepEqual([p.newCharacters, p.droppedCharacters, p.races, p.newRaces], [1, 3, 4, 1], 'the races of characters that cannot be added are not counted as new');
});

test('merging is safe to repeat and to do in either direction, with several characters', async () => {
  const a = profileDoc([character('a', 'Ada', [race('a1', 1), race('a2', 5)]), character('b', 'Bo', [race('b1', 2)])]);
  const b = profileDoc([character('a', 'Ada', [race('a1', 1), race('a3', 3)]), character('c', 'Cy', [race('c1', 4)])]);
  const again = mergeProfiles(a, cleanProfileDoc((await decodeBackup(await encodeBackup(a))).doc));
  assert.deepEqual(again.characters, a.characters, 'your own export adds nothing');
  const ab = mergeProfiles(a, b), ba = mergeProfiles(b, a);
  const sets = d => Object.fromEntries(d.characters.map(c => [c.id, ids(c).sort()]));
  assert.deepEqual(sets(ab), sets(ba)); assert.deepEqual(sets(ab), { a: ['a1', 'a2', 'a3'], b: ['b1'], c: ['c1'] });
  assert.deepEqual(mergeProfiles(ab, b).characters, ab.characters, 'importing the same thing twice changes nothing');
});

test('the boards of a character this device lacks are new, even when another character here has the same board', () => {
  const local = profileDoc([character('a', 'Ada', [race('a1', 1, 80)])]);
  const other = profileDoc([character('c', 'Cy', [race('c1', 2, 60)])]);   // the same board (veteran, no assist), a better time, but not Ada
  const p = previewImport(local, other);
  assert.deepEqual([p.newBoards, p.betterBests, p.newCharacters], [1, 0, 1]);
});

test('the preview counts across characters: players, races, boards, and what is new or better', () => {
  const local = profileDoc([character('a', 'Ada', [race('a1', 1, 80)]), character('b', 'Bo', [race('b1', 2, 90)])]);
  const other = profileDoc([character('a', 'Ada', [race('a1', 1, 80), race('a2', 3, 70)]), character('b', 'Bo', [race('b1', 2, 90)]), character('c', 'Cy', [race('c1', 4, 60, 'rookie')])]);
  assert.deepEqual(previewImport(local, other, 4), { races: 4, newRaces: 2, localOnly: 0, droppedRaces: 0, boards: 3, newBoards: 1, betterBests: 1,
    characters: ['Ada', 'Bo', 'Cy'], newCharacters: 1, droppedCharacters: 0, replacesEmpty: null, legacy: false, into: null, savedAt: T0, newerVersion: false });
  const only = previewImport(profileDoc([character('z', 'Zed', [race('z1', 9)])]), other);
  assert.equal(only.localOnly, 1, 'what REPLACE would lose: a race of this device that the code lacks');
});

/* ---------- a code from before players (a version 1 or 2 profile) ---------- */
const OLD = { version: 2, settings: { level: 'rookie', presets: {} }, races: [race('o1', 1, 75), race('o2', 2, 70)], bests: {}, updatedAt: T0 };

test('an old code holds no characters and is recognised; its races are counted as the code claims them', () => {
  assert.equal(isLegacyDoc(OLD), true); assert.equal(isLegacyDoc({ settings: {}, characters: [] }), false); assert.equal(isLegacyDoc({ settings: {}, characters: 'x' }), true);
  assert.equal(rawRaceCount(OLD), 2); assert.equal(rawRaceCount({ settings: {}, characters: [{ races: [1, 2, 3] }, { races: 'x' }, null, 5, { races: [1] }] }), 4); assert.equal(rawRaceCount({ settings: {}, races: 'x' }), 0);
});

test('an old code is added to the character who is playing: their races, bests and nothing else; no new character appears', () => {
  const local = profileDoc([character('a', 'Ada', [race('mine', 5, 90)]), character('b', 'Bo', [race('bo1', 6)])]);
  const imported = cleanProfileDoc(OLD, ctx());
  const opts = { legacyTo: 'b' }, m = mergeProfiles(local, imported, opts);
  assert.deepEqual(m.characters.map(c => c.id), ['a', 'b']); assert.deepEqual(ids(byId(m, 'b')), ['o1', 'o2', 'bo1']); assert.deepEqual(ids(byId(m, 'a')), ['mine']);
  assert.equal(byId(m, 'b').level, 'veteran', 'the level in the old code is not applied to the character it is added to'); assert.equal(byId(m, 'b').name, 'Bo');
  assert.equal(byId(m, 'b').bests['classic/rookie/manual'], undefined);
  assert.equal(byId(m, 'b').bests['classic/veteran/manual'].time, 70, 'its races were raced on Veteran, as the records say');
  const p = previewImport(local, imported, 2, opts);
  assert.deepEqual([p.legacy, p.into, p.newCharacters, p.newRaces, p.races], [true, 'Bo', 0, 2, 2]);
});

test('an old code restored with REPLACE becomes a household of one character, Player, with its level', () => {
  const doc = cleanProfileDoc(OLD, ctx());
  assert.deepEqual([doc.characters.length, doc.characters[0].name, doc.characters[0].level], [1, 'Player', 'rookie']); assert.deepEqual(ids(doc.characters[0]), ['o1', 'o2']);
});

test('an old code added twice changes nothing the second time, even though each reading makes a new character id', () => {
  const local = profileDoc([character('a', 'Ada', [])]);
  const once = mergeProfiles(local, cleanProfileDoc(OLD, ctx()), { legacyTo: 'a' }), twice = mergeProfiles(once, cleanProfileDoc(OLD, { newId: () => 'other-id', now: () => T0 }), { legacyTo: 'a' });
  assert.deepEqual(twice.characters, once.characters);
  assert.deepEqual(bestsFromRaces(byId(twice, 'a').races), byId(twice, 'a').bests);
});

test('a backup of several characters survives being turned into a code and back, exactly', async () => {
  const doc = profileDoc([character('a', 'Ada', [race('a1', 1), race('a2', 2, 70, 'rookie')]), character('b', 'Bo', [race('b1', 3)], { level: 'rookie', livery: { body: '#0f0' } })]);
  for (const compress of [true, false]) { const d = await decodeBackup(await encodeBackup(doc, { compress })); assert.equal(d.ok, true); assert.deepEqual(cleanProfileDoc(d.doc), doc); }
});

/* ---------- a new device: an unused Player makes way ---------- */
const pristine = () => profileDoc([{ ...newCharacter({}, ctx()), id: 'p0' }]);

test('what an unused character is: the default name, no races, never renamed or changed; anything else is a real one', () => {
  const c = pristine().characters[0];
  assert.equal(isPristine(c), true);
  for (const used of [{ name: 'Tom' }, { races: [race('r', 1)] }, { bests: bestsFromRaces([race('r', 1)]) }, { updatedAt: '2026-11-15T10:00:00.000Z' }]) assert.equal(isPristine({ ...c, ...used }), false, JSON.stringify(Object.keys(used)));
});

test('on a new device the code\'s characters replace the unused Player, and the first of them plays', () => {
  const local = pristine(), other = profileDoc([character('a', 'Ada', [race('a1', 1)]), character('b', 'Bo', [race('b1', 2)])]);
  const m = mergeProfiles(local, other);
  assert.deepEqual(m.characters.map(c => c.id), ['a', 'b']); assert.equal(m.settings.character, 'a'); assert.deepEqual(ids(byId(m, 'a')), ['a1']);
  assert.deepEqual(m.settings.presets, local.settings.presets, 'the device\'s settings are still its own');
  const p = previewImport(local, other);
  assert.deepEqual([p.replacesEmpty, p.newCharacters, p.droppedCharacters, p.localOnly], ['Player', 2, 0, 0]);
});

test('an unused Player is not replaced when it is not the only character, has been used, or the code is an old one (that goes into the character who plays)', () => {
  const other = profileDoc([character('a', 'Ada', [race('a1', 1)])]);
  const two = profileDoc([{ ...newCharacter({}, ctx()), id: 'p0' }, character('t', 'Tom')]);
  assert.deepEqual(mergeProfiles(two, other).characters.map(c => c.id), ['p0', 't', 'a']); assert.equal(previewImport(two, other).replacesEmpty, null);
  const used = profileDoc([{ ...newCharacter({}, ctx()), id: 'p0', races: [race('mine', 5)] }]);
  assert.deepEqual(mergeProfiles(used, other).characters.map(c => c.id), ['p0', 'a']);
  const old = cleanProfileDoc(OLD, ctx()), m = mergeProfiles(pristine(), old, { legacyTo: 'p0' });
  assert.deepEqual(m.characters.map(c => [c.id, c.name, c.races.length]), [['p0', 'Player', 2]]); assert.equal(previewImport(pristine(), old, 2, { legacyTo: 'p0' }).replacesEmpty, null);
});

test('restoring your own backup onto an unused Player of the same id changes nothing (the id is in both)', () => {
  const local = pristine(), same = mergeProfiles(local, local);
  assert.deepEqual(same.characters, local.characters); assert.equal(same.settings.character, 'p0');
});
