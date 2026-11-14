import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { encodeBackup, decodeBackup, mergeProfiles, previewImport, crc32, CODE_MAX, JSON_MAX } from '../../src/backup.js';
import { cleanProfileDoc } from '../../src/profile.js';
import { MAX_RACES, updateBests } from '../../src/records.js';
import { mulberry32 } from '../../src/sim/rng.js';
import { finishRecord, goodRecord } from '../helpers/records.js';

const SETTINGS = { level: 'veteran', presets: { veteran: { pv: 1, tune: { gain: 2 }, assist: null } } };
const day = i => new Date(Date.UTC(2026, 10, 1) + i * 3600e3).toISOString();
const docOf = (races, settings = SETTINGS, extra = {}) => { const bests = {}; for (const r of races) updateBests(bests, r); return cleanProfileDoc({ version: 2, settings, races, bests, updatedAt: '2026-11-14T10:00:00.000Z', ...extra }); };
const race = (id, i, time = 80 + (i % 7), level = 'veteran') => { const r = finishRecord(id, time, [27 + (i % 3), 26.5, 27]); r.ts = day(i); r.level = level; return r; };
const races = (n, prefix = 'r') => Array.from({ length: n }, (_, i) => race(prefix + i, i));
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const codeOf = (kind, bytes) => `MMP1:${kind}:${crc32(bytes)}:${b64(bytes)}`;

test('a profile survives being turned into a code and back, compressed or raw, and the code is plain text that is shorter when compressed', async () => {
  const doc = docOf(races(40)); doc.garage = { selected: 'scout' };
  const z = await encodeBackup(doc, { compress: true }), r = await encodeBackup(doc, { compress: false });
  assert.match(z, /^MMP1:z:[0-9a-f]{8}:[A-Za-z0-9_-]+$/); assert.match(r, /^MMP1:r:[0-9a-f]{8}:[A-Za-z0-9_-]+$/);
  assert.ok(z.length < r.length * 0.6, `compressed ${z.length} against raw ${r.length}`);
  for (const code of [z, r]) { const d = await decodeBackup(code); assert.equal(d.ok, true); assert.deepEqual(d.doc, JSON.parse(JSON.stringify(doc))); }
});

test('a full 500-race history makes a code of a size that can be copied (measured)', async () => {
  const code = await encodeBackup(docOf(races(MAX_RACES)));
  assert.ok(code.length < 220000, `${code.length} characters for 500 races`);
});

test('whitespace in a pasted code is ignored: line wraps, indents, a trailing newline', async () => {
  const code = await encodeBackup(docOf(races(5)));
  const wrapped = '  ' + code.replace(/(.{60})/g, '$1\n   ') + '\n\n';
  const d = await decodeBackup(wrapped); assert.equal(d.ok, true); assert.equal(d.doc.races.length, 5);
  assert.equal((await decodeBackup(code.replace(/:/g, ': '))).ok, true);
});

test('every way a code can be wrong gets a sentence for the player, never an exception', async () => {
  const good = await encodeBackup(docOf(races(3)));
  const cases = [[undefined, /no code/], [null, /no code/], [5, /no code/], ['', /Paste/], ['   \n ', /Paste/], ['hello', /not a Micro Mayhem/], ['MMP2:z:00000000:abc', /not a Micro Mayhem/], ['mmp1:z:00000000:abc', /not a Micro Mayhem/],
    [good.slice(0, -12), /damaged or cut short/], [good.slice(0, 14), /damaged or cut short|not a Micro/], [good.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), /damaged/], [good.replace(/^(MMP1:z:[0-9a-f]{8}:.)./, '$1!'), /damaged/],
    ['MMP1:z:zzzzzzzz:abc', /not a Micro Mayhem/], [good + 'x'.repeat(CODE_MAX), /too big/]];
  for (const [input, re] of cases) { const d = await decodeBackup(input); assert.equal(d.ok, false, String(input).slice(0, 40)); assert.match(d.error, re, String(input).slice(0, 40)); }
});

test('a code that passes its check but is not a profile is refused: not deflated data, not JSON, not UTF-8, not an object, no settings', async () => {
  const enc = s => new TextEncoder().encode(s);
  const rawCode = s => codeOf('r', enc(s));
  assert.match((await decodeBackup(codeOf('z', enc('this is not deflated')))).error, /could not be unpacked/);
  for (const s of ['{not json', '', 'null', '5', '"text"', '[1,2]', '{}', '{"settings":[1]}', '{"settings":null}', '{"settings":"x"}']) assert.equal((await decodeBackup(rawCode(s))).ok, false, s);
  assert.match((await decodeBackup(rawCode('{not json'))).error, /readable profile/); assert.match((await decodeBackup(rawCode('[1]'))).error, /does not hold a profile/);
  assert.match((await decodeBackup(codeOf('r', Uint8Array.from([0xff, 0xfe, 0x7b])))).error, /readable profile/);
  assert.equal((await decodeBackup(rawCode('{"settings":{"level":"rookie"}}'))).ok, true);
  const badByte = Uint8Array.from([...enc('{"settings":{"level":"'), 0xc3, 0x28, ...enc('"}}')]);   // an invalid UTF-8 sequence inside a string
  assert.match((await decodeBackup(codeOf('r', badByte))).error, /readable profile/);
});

test('a tiny code that would unpack into 100 MB is refused without unpacking it', async () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(100 * 1024 * 1024)); assert.ok(bomb.length < 200000, `the bomb is ${bomb.length} bytes`);
  const before = process.memoryUsage().arrayBuffers, t0 = Date.now();
  const d = await decodeBackup(codeOf('z', bomb));
  assert.equal(d.ok, false); assert.match(d.error, /too big/);
  assert.ok(process.memoryUsage().arrayBuffers - before < 40 * 1024 * 1024, 'memory stayed small'); assert.ok(Date.now() - t0 < 5000);
  assert.equal((await decodeBackup(codeOf('r', new Uint8Array(CODE_MAX)))).ok, false, 'a raw code is limited by the size of the code'); assert.ok(JSON_MAX > CODE_MAX * 0.75, 'so that no raw code can exceed the unpacked limit');
});

test('what comes out of a code is cleaned like a stored profile: damaged records dropped, a __proto__ field harmless', async () => {
  const doc = JSON.parse(JSON.stringify(docOf(races(3)))); doc.races.splice(1, 0, { id: 'bad', result: 5 }, null);
  const text = JSON.stringify(doc).replace(/^\{/, '{"__proto__":{"polluted":true},');
  const d = await decodeBackup(codeOf('r', new TextEncoder().encode(text))); assert.equal(d.ok, true);
  const clean = cleanProfileDoc(d.doc);
  assert.equal(clean.races.length, 3); assert.equal(Object.getPrototypeOf(clean), Object.prototype); assert.equal(clean.polluted, undefined); assert.equal({}.polluted, undefined);
  assert.equal(previewImport(docOf([]), clean, d.doc.races.length).droppedRaces, 2);
});

test('round trips of 60 random profiles come back identical', async () => {
  const rnd = mulberry32(11);
  for (let t = 0; t < 60; t++) {
    const n = Math.floor(rnd() * 80), rs = Array.from({ length: n }, (_, i) => { const r = rnd() < 0.2 ? goodRecord({ kind: 'wrecked' }) : race('x' + t + '_' + i, i, 70 + rnd() * 30, rnd() < 0.5 ? 'rookie' : 'veteran'); r.id = 'x' + t + '_' + i; r.ts = day(Math.floor(rnd() * 1000)); return r; });
    const doc = docOf(rs, { level: rnd() < 0.5 ? 'rookie' : 'veteran', presets: {} });
    const d = await decodeBackup(await encodeBackup(doc, { compress: rnd() < 0.7 }));
    assert.equal(d.ok, true); assert.deepEqual(cleanProfileDoc(d.doc), doc, 'profile ' + t);
  }
});

test('merging adds the races this device lacks, in date order; this device\'s copy of a race wins; settings stay as they are here', () => {
  const local = docOf([race('a', 2), race('b', 4), race('c', 6)], { level: 'veteran', presets: {} });
  const other = docOf([race('b', 4, 50), race('d', 3), race('e', 9)], { level: 'rookie', presets: { rookie: { pv: 1, tune: { gain: 1 }, assist: null } } });
  const m = mergeProfiles(local, other);
  assert.deepEqual(m.races.map(r => r.id), ['a', 'd', 'b', 'c', 'e']);
  assert.equal(m.races.find(r => r.id === 'b').result.time, 80 + (4 % 7), 'this device\'s race b is kept, not the imported one');
  assert.deepEqual(m.settings, local.settings);
  assert.deepEqual(local.races.map(r => r.id), ['a', 'b', 'c'], 'the arguments are not changed'); assert.deepEqual(other.races.map(r => r.id), ['b', 'd', 'e']);
});

test('merged bests are never worse than either side, including a best whose race is not in either history', () => {
  const local = docOf([race('a', 1, 80, 'veteran')]); local.bests['classic/veteran/manual'] = { time: 70, timeRace: 'gone', bestLap: 26.5, bestLapRace: 'a' };
  const other = docOf([race('z', 5, 75, 'veteran'), race('y', 6, 90, 'rookie')]); other.bests['classic/rookie/manual'].bestLap = 20; other.bests['classic/veteran/manual'].bestLap = 25;
  const m = mergeProfiles(local, other);
  assert.equal(m.bests['classic/veteran/manual'].time, 70); assert.equal(m.bests['classic/veteran/manual'].bestLap, 25);
  assert.equal(m.bests['classic/rookie/manual'].time, 90); assert.equal(m.bests['classic/rookie/manual'].bestLap, 20);
});

test('merging is safe to repeat and to do in either direction: your own export adds nothing, and A+B has the same races and bests as B+A', async () => {
  const a = docOf(races(20, 'a')), b = docOf(races(25, 'b'));
  const again = mergeProfiles(a, cleanProfileDoc((await decodeBackup(await encodeBackup(a))).doc));
  assert.deepEqual(again.races, a.races); assert.deepEqual(again.bests, a.bests);
  const ab = mergeProfiles(a, b), ba = mergeProfiles(b, a);
  assert.deepEqual(new Set(ab.races.map(r => r.id)), new Set(ba.races.map(r => r.id))); assert.equal(ab.races.length, 45);
  const values = bs => Object.fromEntries(Object.entries(bs).map(([k, v]) => [k, [v.time, v.bestLap]]));
  assert.deepEqual(values(ab.bests), values(ba.bests), 'the same best times and laps (on an exact tie, this device\'s race is the one named)');
  assert.deepEqual(mergeProfiles(ab, b).races, ab.races, 'importing the same thing twice changes nothing');
});

test('a merge keeps only the latest 500 races, and the bests of the ones that fell off', () => {
  const local = docOf(Array.from({ length: 400 }, (_, i) => race('l' + i, i + 1000, 80)));
  const other = docOf([...Array.from({ length: 300 }, (_, i) => race('o' + i, i, 90)), race('fast', 5, 60)]);
  const m = mergeProfiles(local, other);
  assert.equal(m.races.length, MAX_RACES); assert.ok(!m.races.some(r => r.id === 'fast'), 'the oldest races fell off');
  assert.equal(m.bests['classic/veteran/manual'].time, 60, 'but the best from one of them stays');
});

test('the preview says what a merge would do, before anything changes', () => {
  const local = docOf([race('a', 1, 80), race('b', 2, 85)]), other = docOf([race('b', 2, 85), race('c', 3, 70), race('d', 4, 90, 'rookie')]);
  const p = previewImport(local, other, 5);
  assert.deepEqual(p, { races: 3, newRaces: 2, localOnly: 1, droppedRaces: 2, boards: 2, newBoards: 1, betterBests: 1, level: 'veteran', savedAt: '2026-11-14T10:00:00.000Z', newerVersion: false });
  const same = previewImport(local, local); assert.deepEqual([same.newRaces, same.newBoards, same.betterBests, same.droppedRaces, same.localOnly], [0, 0, 0, 0, 0]);
  assert.equal(previewImport(local, { ...other, version: 3 }).newerVersion, true);
  assert.equal(previewImport(docOf([]), docOf([])).savedAt, '2026-11-14T10:00:00.000Z'); assert.equal(previewImport(local, { ...other, updatedAt: 5 }).savedAt, null);
});

test('crc32 is the standard CRC-32', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926'); assert.equal(crc32(new Uint8Array(0)), '00000000');
});

test('only a code is accepted: text before it is refused, and the standard base64 alphabet and padding are tolerated', async () => {
  const good = await encodeBackup(docOf(races(3)));
  assert.equal((await decodeBackup('my code: ' + good)).ok, false); assert.match((await decodeBackup('x' + good)).error, /not a Micro Mayhem/);
  const m = /^(MMP1:r:)([0-9a-f]{8}:)(.*)$/.exec(await encodeBackup(docOf(races(2)), { compress: false })), padded = m[1] + m[2] + m[3].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - m[3].length % 4) % 4);
  assert.equal((await decodeBackup(padded)).ok, true);
});
