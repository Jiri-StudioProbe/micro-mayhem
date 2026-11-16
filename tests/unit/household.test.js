import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, uniqueName, cleanCharacters, cleanHousehold, addCharacter, renameCharacter, removeCharacter, setCurrent, currentCharacter,
  mergeCharacter, newCharacter, MAX_CHARACTERS, NAME_MAX, DEFAULT_NAME } from '../../src/household.js';
import { cleanProfileDoc } from '../../src/profile.js';
import { MAX_RACES } from '../../src/records.js';
import { finishRecord } from '../helpers/records.js';
import { ctx, T0, character, profileDoc } from '../helpers/household.js';

/* ---------- names ---------- */
test('a name is trimmed, its white space collapsed, and cut to 16 characters', () => {
  assert.equal(cleanName('  Ada  '), 'Ada'); assert.equal(cleanName('Ada\t\n  Lovelace'), 'Ada Lovelace'); assert.equal(cleanName('x'.repeat(40)), 'x'.repeat(NAME_MAX));
  assert.equal(cleanName('Ünïcode Náme'), 'Ünïcode Náme'); assert.equal(cleanName('日本語の名前'), '日本語の名前');
  assert.equal(cleanName('a'.repeat(15) + ' b'), 'a'.repeat(15), 'a cut that ends in a space is trimmed');
  assert.equal(cleanName('😀'.repeat(20)), '😀'.repeat(NAME_MAX), 'it counts characters, not UTF-16 units, so an emoji is never cut in half');
});

test('what is not a usable name is null: nothing, only white space, or only invisible characters; a non-string', () => {
  for (const x of ['', '   ', '\n\t', '​', '‮', '​‍﻿', '\u0000\u0007', '\ud800', 7, null, undefined, {}, [], ['Ada']]) assert.equal(cleanName(x), null, JSON.stringify(x));
});

test('characters that could make one name look like another or break the screen are removed: direction overrides, zero-width, control, lone surrogates, private use', () => {
  assert.equal(cleanName('Ada‮'), 'Ada'); assert.equal(cleanName('A​d​a'), 'Ada', 'zero-width characters inside a name');
  assert.equal(cleanName('Ad\u0000a'), 'Ad a'); assert.equal(cleanName('A\ud800da'), 'Ada'); assert.equal(cleanName('Ada'), 'Ada');
  assert.equal(cleanName('Ada Bo'), 'Ada Bo', 'a line separator is just a space'); assert.equal(cleanName('Ada Bo'), 'Ada Bo');
  assert.equal(cleanName('<img src=x onerror=1>'), '<img src=x onerr', 'markup is not removed (names are only ever shown as text) but it is cut like any name');
});

test('names that differ only by capitals clash; a clash gets a number, and the number fits inside the length limit', () => {
  assert.equal(uniqueName('Ada', ['Bo', 'Tom']), 'Ada'); assert.equal(uniqueName('Ada', ['ada']), 'Ada 2'); assert.equal(uniqueName('Ada', ['ADA', 'Ada 2']), 'Ada 3');
  const long = 'x'.repeat(NAME_MAX), u = uniqueName(long, [long]);
  assert.equal(u, 'x'.repeat(NAME_MAX - 2) + ' 2'); assert.equal([...u].length, NAME_MAX);
  assert.equal(uniqueName(long, [long, u]), 'x'.repeat(NAME_MAX - 2) + ' 3');
});

/* ---------- cleaning ---------- */
const raw = (id, name = 'P' + id, extra = {}) => ({ id, name, ...extra });

test('a character is cleaned: a name, a level, dates and an empty history are filled in; fields it does not know are kept', () => {
  const [c] = cleanCharacters([{ id: 'c1', livery: { body: '#f00' } }], ctx());
  assert.deepEqual(c, { id: 'c1', livery: { body: '#f00' }, name: DEFAULT_NAME, level: 'veteran', createdAt: T0, updatedAt: T0, races: [], bests: {} });
  const [d] = cleanCharacters([{ id: 'c2', name: ' Bo ', level: 'rookie', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: 'not a date' }], ctx());
  assert.deepEqual([d.name, d.level, d.createdAt, d.updatedAt], ['Bo', 'rookie', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'], 'a bad updatedAt falls back to createdAt');
});

test('only valid characters are kept, each id once, at most 8', () => {
  const many = Array.from({ length: 20 }, (_, i) => raw('c' + i));
  assert.equal(cleanCharacters(many, ctx()).length, MAX_CHARACTERS); assert.deepEqual(cleanCharacters(many, ctx()).map(c => c.id), many.slice(0, 8).map(c => c.id));
  assert.deepEqual(cleanCharacters([raw('a'), raw('a', 'Other'), null, 5, 'x', [], { name: 'no id' }, { id: '' }, { id: 'x'.repeat(65) }, raw('b')], ctx()).map(c => [c.id, c.name]), [['a', 'Pa'], ['b', 'Pb']]);
  for (const bad of [undefined, null, 5, 'abc', {}, { 0: raw('a'), length: 1 }]) assert.deepEqual(cleanCharacters(bad, ctx()), [], JSON.stringify(bad));
});

test('two characters with the same name are told apart, and a stored name is cleaned', () => {
  const names = cleanCharacters([raw('a', 'Ada'), raw('b', 'ada'), raw('c', ' ADA​ '), raw('d', '‮')], ctx()).map(c => c.name);
  assert.deepEqual(names, ['Ada', 'ada 2', 'ADA 3', 'Player']);
});

test('a character\'s bests are never worse than its races show, and a stored best whose race is gone is kept', () => {
  const r = race('r', 3, 80);
  const [fromRaces] = cleanCharacters([raw('a', 'Ada', { races: [r], bests: {} })], ctx());
  assert.equal(fromRaces.bests['classic/veteran/manual'].time, 80, 'bests are rebuilt from the races when the stored ones lack them');
  const [kept] = cleanCharacters([raw('a', 'Ada', { races: [r], bests: { 'classic/veteran/manual': { time: 70, timeRace: 'gone', bestLap: 27.5, bestLapRace: 'gone' } } })], ctx());
  assert.deepEqual(kept.bests['classic/veteran/manual'], { time: 70, timeRace: 'gone', bestLap: 26, bestLapRace: 'r' });
});

test('a race belongs to one character: a race id found in two is kept in the first only (the cloud will rely on ids being unique)', () => {
  const x = finishRecord('same', 80, [27, 26, 26]), y = finishRecord('other', 81, [27, 26, 26]);
  const [a, b] = cleanCharacters([raw('a', 'Ada', { races: [x] }), raw('b', 'Bo', { races: [x, y] })], ctx());
  assert.deepEqual(a.races.map(r => r.id), ['same']); assert.deepEqual(b.races.map(r => r.id), ['other']);
});

test('the household has an id and a date: kept if they are good, made if not', () => {
  assert.deepEqual(cleanHousehold({ id: 'h', createdAt: T0, plan: 'x' }, ctx()), { id: 'h', createdAt: T0, plan: 'x' });
  for (const bad of [undefined, null, 5, 'x', [], {}, { id: 7, createdAt: 'no' }, { id: '' }]) assert.deepEqual(cleanHousehold(bad, ctx()), { id: 'gen-1', createdAt: T0 }, JSON.stringify(bad));
  assert.equal(Object.getPrototypeOf(cleanHousehold(JSON.parse('{"__proto__":{"evil":1},"id":"h"}'), ctx())), Object.prototype);
});

/* ---------- the household in a profile ---------- */
const house = () => profileDoc([character('a', 'Ada'), character('b', 'Bo')]);

test('adding a character: a clean name is required, it must be new, and a household holds 8', () => {
  const d = house(), r = addCharacter(d, ' Cy  ', { newId: () => 'cy', now: () => T0, level: 'rookie' });
  assert.deepEqual(r, { ok: true, character: { id: 'cy', name: 'Cy', level: 'rookie', createdAt: T0, updatedAt: T0, races: [], bests: {} } });
  assert.equal(d.characters.length, 3); assert.equal(d.characters[2], r.character);
  assert.deepEqual(addCharacter(d, 'cy'), { ok: false, error: 'taken' }); assert.deepEqual(addCharacter(d, '​ '), { ok: false, error: 'name' }); assert.deepEqual(addCharacter(d, 7), { ok: false, error: 'name' });
  assert.equal(d.characters.length, 3, 'a refused add changes nothing');
  for (let i = 3; i < MAX_CHARACTERS; i++) assert.equal(addCharacter(d, 'P' + i).ok, true);
  assert.deepEqual(addCharacter(d, 'one more'), { ok: false, error: 'full' }); assert.equal(d.characters.length, MAX_CHARACTERS);
  assert.equal(addCharacter(house(), 'Dee', { level: 'constructor' }).character.level, 'constructor', 'any level string is kept; the settings fall back for one this game does not know');
  assert.equal(addCharacter(house(), 'Dee', { level: 7 }).character.level, 'veteran');
});

test('renaming: another character\'s name is refused, capital letters may change, an unchanged name touches nothing', () => {
  const d = house();
  assert.deepEqual(renameCharacter(d, 'a', 'bo'), { ok: false, error: 'taken' }); assert.deepEqual(renameCharacter(d, 'a', '  '), { ok: false, error: 'name' }); assert.deepEqual(renameCharacter(d, 'zz', 'X'), { ok: false, error: 'unknown' });
  assert.equal(d.characters[0].name, 'Ada');
  assert.deepEqual(renameCharacter(d, 'a', 'ADA', { now: () => 'LATER' }), { ok: true }); assert.deepEqual([d.characters[0].name, d.characters[0].updatedAt], ['ADA', 'LATER']);
  assert.deepEqual(renameCharacter(d, 'a', 'ADA', { now: () => 'EVEN LATER' }), { ok: true }); assert.equal(d.characters[0].updatedAt, 'LATER', 'no change, no new updatedAt');
});

test('removing: the last character stays; the races go with the character; if it was the one playing, someone else is', () => {
  const d = house(); d.characters[1].races.push(finishRecord('r1', 80, [27, 26, 26])); setCurrent(d, 'b');
  assert.deepEqual(removeCharacter(d, 'zz'), { ok: false, error: 'unknown' });
  assert.deepEqual(removeCharacter(d, 'b'), { ok: true }); assert.deepEqual(d.characters.map(c => c.id), ['a']); assert.equal(currentCharacter(d).id, 'a'); assert.equal(d.settings.character, 'a');
  assert.deepEqual(removeCharacter(d, 'a'), { ok: false, error: 'last' }); assert.equal(d.characters.length, 1);
});

test('who is playing: switching works for a character that exists only', () => {
  const d = house();
  assert.equal(setCurrent(d, 'b'), true); assert.equal(currentCharacter(d).name, 'Bo');
  assert.equal(setCurrent(d, 'nope'), false); assert.equal(setCurrent(d, '__proto__'), false); assert.equal(currentCharacter(d).name, 'Bo');
});

/* ---------- merging ---------- */
const race = (id, day, time = 80) => { const r = finishRecord(id, time, [27, 26, 26]); r.ts = new Date(Date.UTC(2026, 10, day)).toISOString(); return r; };

test('merging a character adds the races it lacks in date order; the local copy of a race, name and level win; bests are the better of the two', () => {
  const local = character('a', 'Ada', [race('x', 2, 80), race('y', 5, 85)]), imported = character('a', 'Ada!', [race('y', 5, 50), race('z', 3, 70)], { level: 'rookie' });
  const m = mergeCharacter(local, imported);
  assert.deepEqual(m.races.map(r => r.id), ['x', 'z', 'y']); assert.equal(m.races.find(r => r.id === 'y').result.time, 85);
  assert.deepEqual([m.name, m.level], ['Ada', 'veteran']); assert.equal(m.bests['classic/veteran/manual'].time, 50, 'the imported character\'s own best (its race y, 50 s) is better than anything here');
  assert.deepEqual(local.races.map(r => r.id), ['x', 'y'], 'the arguments are not changed');
});

test('merging skips a race that is already in another character of the household, and keeps the latest 500', () => {
  const local = character('a', 'Ada', [race('x', 2)]), imported = character('a', 'Ada', [race('mine-elsewhere', 3), race('new', 4)]);
  assert.deepEqual(mergeCharacter(local, imported, new Set(['x', 'mine-elsewhere'])).races.map(r => r.id), ['x', 'new']);
  const big = character('a', 'Ada', Array.from({ length: 400 }, (_, i) => race('l' + i, 20)));
  assert.equal(mergeCharacter(big, character('a', 'Ada', Array.from({ length: 300 }, (_, i) => race('o' + i, 3)))).races.length, MAX_RACES);
});

test('a new character is a name, a level, two dates, an id and an empty history', () => {
  assert.deepEqual(newCharacter({ name: 'Cy', level: 'rookie' }, ctx()), { id: 'gen-1', name: 'Cy', level: 'rookie', createdAt: T0, updatedAt: T0, races: [], bests: {} });
  assert.equal(newCharacter().name, DEFAULT_NAME); assert.equal(typeof newCharacter().id, 'string');
});

test('cleaning a whole document keeps a household valid whatever it is given', () => {
  const doc = cleanProfileDoc({ version: 3, settings: { presets: {}, character: 'x' }, characters: [raw('a'), raw('b')] }, ctx());
  assert.equal(doc.settings.character, 'a', 'a remembered character that is gone becomes the first');
  assert.equal(currentCharacter(doc).id, 'a');
});
