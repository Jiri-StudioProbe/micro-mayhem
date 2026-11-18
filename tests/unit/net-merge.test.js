import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, mergeBestsStable, mergeRow, mergeMeta, metaEqual, cleanMeta, metaOf, rowOf, orderRows, fitHousehold } from '../../src/net/merge.js';
import { mulberry32 } from '../../src/sim/rng.js';
import { MAX_CHARACTERS } from '../../src/household.js';
import { finishRecord } from '../helpers/records.js';
import { character, profileDoc } from '../helpers/household.js';

const at = n => new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString();   // at(1) < at(2) < ...
const best = (time, timeRace, bestLap, bestLapRace) => ({ time, timeRace, bestLap, bestLapRace });
const row = (id, o = {}) => ({ id, name: id.toUpperCase(), level: 'veteran', createdAt: at(0), updatedAt: at(1), bests: {}, ...o });
const meta = (characters = [], deleted = {}) => ({ characters, deleted });
const V = 'classic/veteran/manual', R = 'classic/rookie/assist';

/* ---------- bests ---------- */
test('bests merge to the better of each, board by board; a missing value is no value; an exact tie names the smaller race id, whichever side it is on', () => {
  const a = { [V]: best(80, 'r2', 27, 'r2') }, b = { [V]: best(81, 'r1', 26, 'r1'), [R]: best(90, 'r3', null, null) };
  assert.deepEqual(mergeBestsStable(a, b), { [R]: best(90, 'r3', null, null), [V]: best(80, 'r2', 26, 'r1') });
  const t1 = { [V]: best(80, 'rb', 27, 'rb') }, t2 = { [V]: best(80, 'ra', 27, 'rz') };
  assert.deepEqual(mergeBestsStable(t1, t2), mergeBestsStable(t2, t1)); assert.deepEqual(mergeBestsStable(t1, t2), { [V]: best(80, 'ra', 27, 'rb') });
  assert.deepEqual(mergeBestsStable({ [V]: best(null, null, 25, 'l') }, { [V]: best(80, 'r', null, null) }), { [V]: best(80, 'r', 25, 'l') });
  assert.deepEqual(mergeBestsStable({}, {}), {}); assert.deepEqual(mergeBestsStable(a, {}), a);
});

/* ---------- rows ---------- */
test('a row merges to the later one\'s name, level and unknown fields, the earlier creation date, and the better bests', () => {
  const x = row('a', { name: 'Old', level: 'rookie', createdAt: at(3), updatedAt: at(5), bests: { [V]: best(80, 'r1', 27, 'r1') }, livery: 'red' });
  const y = row('a', { name: 'New', level: 'veteran', createdAt: at(2), updatedAt: at(9), bests: { [V]: best(82, 'r2', 26, 'r2') } });
  const m = mergeRow(x, y);
  assert.deepEqual(m, { id: 'a', name: 'New', level: 'veteran', createdAt: at(2), updatedAt: at(9), bests: { [V]: best(80, 'r1', 26, 'r2') } });
  assert.deepEqual(mergeRow(y, x), m, 'either way round');
  assert.equal(mergeRow(x, y).livery, undefined, 'the later row has no livery, so the merged one has none');
});

test('two rows changed at the very same moment are told apart by their own text, the same on every device', () => {
  const x = row('a', { name: 'Zed', updatedAt: at(4) }), y = row('a', { name: 'Amy', updatedAt: at(4) });
  assert.equal(mergeRow(x, y).name, 'Amy'); assert.equal(mergeRow(y, x).name, 'Amy');
});

/* ---------- the meta: the laws ---------- */
test('deleting always wins: a tombstone removes the character whenever it was made, and is remembered with its latest time', () => {
  const alive = meta([row('a', { updatedAt: at(5) })]);
  assert.deepEqual(mergeMeta(alive, meta([], { a: at(7) })), meta([], { a: at(7) }), 'deleted after the last change: gone');
  assert.deepEqual(mergeMeta(alive, meta([], { a: at(3) })), meta([], { a: at(3) }), 'changed on another device after the deletion: still gone');
  assert.deepEqual(mergeMeta(meta([row('a'), row('b')]), meta([], { a: at(1) })).characters.map(r => r.id), ['b'], 'and nobody else is touched');
  assert.deepEqual(mergeMeta(meta([], { a: at(3) }), meta([], { a: at(8) })).deleted, { a: at(8) }, 'the later tombstone');
  assert.deepEqual(mergeMeta(meta([row('b')]), meta([row('a')])).characters.map(r => r.id), ['a', 'b'], 'in one fixed order');
});

// Random metas from a small pool of ids, times, names and race ids, so that ties, tombstones and clashes are common.
function randomMeta(rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)], ids = ['a', 'b', 'c', 'd'], characters = [], deleted = {};
  for (const id of ids) if (rnd() < 0.7) {
    const bests = {};
    for (const k of [V, R]) if (rnd() < 0.5) bests[k] = best(rnd() < 0.8 ? pick([80, 81, 82]) : null, null, rnd() < 0.8 ? pick([26, 27]) : null, null);
    for (const b of Object.values(bests)) { if (b.time === null && b.bestLap === null) b.time = 90; b.timeRace = b.time === null ? null : pick(['r1', 'r2', 'r3']); b.bestLapRace = b.bestLap === null ? null : pick(['r1', 'r2', 'r3']); }
    characters.push(row(id, { name: pick(['Amy', 'Bo', 'Cy']), level: pick(['rookie', 'veteran']), createdAt: at(pick([0, 1, 2])), updatedAt: at(pick([3, 4, 5, 6])), bests, ...(rnd() < 0.3 ? { livery: pick(['red', 'blue']) } : {}) }));
  }
  for (const id of ids) if (rnd() < 0.3) deleted[id] = at(pick([2, 4, 5, 7]));
  return meta(characters, deleted);
}
const EMPTY = meta();
const N = 3000;

test(`merging is commutative: ${N} random pairs give the same result either way round`, () => {
  const rnd = mulberry32(1);
  for (let i = 0; i < N; i++) { const a = randomMeta(rnd), b = randomMeta(rnd); assert.equal(canonical(mergeMeta(a, b)), canonical(mergeMeta(b, a)), JSON.stringify([a, b])); }
});

test(`merging is associative: ${N} random triples give the same result however they are grouped`, () => {
  const rnd = mulberry32(2);
  for (let i = 0; i < N; i++) {
    const a = randomMeta(rnd), b = randomMeta(rnd), c = randomMeta(rnd);
    assert.equal(canonical(mergeMeta(mergeMeta(a, b), c)), canonical(mergeMeta(a, mergeMeta(b, c))), JSON.stringify([a, b, c]));
  }
});

test(`merging is idempotent, and merging what is already contained changes nothing: ${N} random cases`, () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < N; i++) {
    const a = randomMeta(rnd), b = randomMeta(rnd), ab = mergeMeta(a, b);
    assert.equal(canonical(mergeMeta(a, a)), canonical(mergeMeta(a, EMPTY)), 'a with itself is a, with only the dead dropped');
    assert.equal(canonical(mergeMeta(ab, a)), canonical(ab)); assert.equal(canonical(mergeMeta(ab, b)), canonical(ab)); assert.equal(canonical(mergeMeta(ab, ab)), canonical(ab));
  }
});

test('three devices that sync in any order, any number of times, end up with the same household', () => {
  const rnd = mulberry32(4);
  for (let t = 0; t < 300; t++) {
    const devices = [randomMeta(rnd), randomMeta(rnd), randomMeta(rnd)], server = { m: EMPTY };
    const sync = d => { const merged = mergeMeta(devices[d], server.m); devices[d] = merged; server.m = merged; };   // a sync: merge with the server, both keep the result
    for (let round = 0; round < 6; round++) sync(Math.floor(rnd() * 3));
    for (let d = 0; d < 3; d++) sync(d); for (let d = 0; d < 3; d++) sync(d);   // everyone syncs at the end, twice
    assert.equal(canonical(devices[0]), canonical(devices[1])); assert.equal(canonical(devices[1]), canonical(devices[2])); assert.equal(canonical(devices[2]), canonical(server.m));
  }
});

test('two metas are equal when they say the same, whatever order their keys are written in', () => {
  assert.equal(metaEqual(meta([row('a')], { x: at(1), y: at(2) }), meta([{ ...row('a') }], { y: at(2), x: at(1) })), true);
  assert.equal(metaEqual(meta([row('a')]), meta([row('a', { name: 'B' })])), false); assert.equal(metaEqual(meta([], { x: at(1) }), meta()), false);
});

test('a character with a tombstone is never in a merge result; one that is alive is there with a row that has no races', () => {
  const rnd = mulberry32(5);
  for (let i = 0; i < 1000; i++) {
    const m = mergeMeta(randomMeta(rnd), randomMeta(rnd));
    for (const r of m.characters) { assert.ok(!(r.id in m.deleted)); assert.equal(r.races, undefined); }
    assert.deepEqual(m.characters.map(r => r.id), orderRows(m.characters).map(r => r.id));
  }
});

/* ---------- untrusted data ---------- */
test('a meta from a server is cleaned: rows that are not rows are dropped, the rest kept, with no races and no way to change a prototype', () => {
  const good = row('a', { bests: { [V]: best(80, 'r1', 27, 'r1') } }), races = [finishRecord('r1', 80, [27, 26, 26])];
  const m = cleanMeta({ characters: [{ ...good, races }, null, 5, 'x', [], { id: 'b' }, { ...row('c'), updatedAt: 'no' }, { ...row('d'), createdAt: 7 }, { ...row('a'), name: 'dup' }, { ...row('e'), name: '‮Eve' }], deleted: { x: at(3), y: 'no' } });
  assert.deepEqual(m.characters.map(r => [r.id, r.name]), [['a', 'A'], ['e', 'Eve']]); assert.deepEqual(m.deleted, { x: at(3) });
  assert.ok(m.characters.every(r => r.races === undefined)); assert.deepEqual(m.characters[0].bests, good.bests);
  for (const bad of [undefined, null, 5, 'x', [], { characters: 'x', deleted: 5 }]) assert.deepEqual(cleanMeta(bad), meta(), JSON.stringify(bad));
  const evil = cleanMeta(JSON.parse('{"__proto__":{"x":1},"characters":[{"__proto__":{"y":1},"id":"a","name":"A","level":"veteran","createdAt":"2026-11-01T12:00:00.000Z","updatedAt":"2026-11-01T12:00:01.000Z","bests":{}}],"deleted":{"__proto__":"2026-11-01T12:00:00.000Z"}}'));
  assert.equal(evil.characters.length, 1); assert.equal(({}).x, undefined); assert.equal(({}).y, undefined); assert.deepEqual(evil.deleted, {});
});

test('the meta of a profile is its rows and tombstones, copied: the races stay out, and changing it does not change the profile', () => {
  const d = profileDoc([character('a', 'Ada', [finishRecord('r1', 80, [27, 26, 26])]), character('b', 'Bo')]); d.household.deleted = { z: at(2) };
  const m = metaOf(d); assert.deepEqual(m.characters.map(r => r.id), ['a', 'b']); assert.ok(m.characters.every(r => r.races === undefined)); assert.equal(m.characters[0].bests[V].time > 0, true);
  m.deleted.q = at(1); m.characters[0].name = 'X'; assert.deepEqual(d.household.deleted, { z: at(2) }); assert.equal(d.characters[0].name, 'Ada');
  assert.equal(rowOf(d.characters[0]).races, undefined); assert.equal(d.characters[0].races.length, 1, 'rowOf leaves the character alone');
});

/* ---------- fitting a merged household into the rules ---------- */
test('a merged household keeps the 8 oldest characters, and gives a taken name a number, the same on every device; a renamed row counts as changed now', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row('p' + i, { name: i === 5 ? 'p0' : 'P' + i, createdAt: at(10 - i) }));   // p9 is the oldest
  const fit = fitHousehold(meta(rows), at(50));
  assert.equal(fit.characters.length, MAX_CHARACTERS); assert.deepEqual(fit.dropped.sort(), ['p0', 'p1']); assert.deepEqual(fit.characters.map(r => r.id), ['p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2']);
  assert.deepEqual(fit.characters.map(r => r.name).slice(0, 5), ['P9', 'P8', 'P7', 'P6', 'p0']);
  const clash = fitHousehold(meta([row('b', { name: 'Cy', createdAt: at(2) }), row('a', { name: 'cy', createdAt: at(1) }), row('c', { name: 'CY', createdAt: at(2) })]), at(50));
  assert.deepEqual(clash.characters.map(r => [r.id, r.name]), [['a', 'cy'], ['b', 'Cy 2'], ['c', 'CY 3']]); assert.deepEqual(clash.renamed, ['b', 'c']);
  assert.deepEqual(clash.characters.map(r => r.updatedAt), [at(1), at(50), at(50)]);
  assert.deepEqual(fitHousehold(meta(clash.characters), at(99)).renamed, [], 'a household that already fits is left alone');
});
