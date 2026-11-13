import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord, cleanRaces, cleanBests, updateBests, mergeBests, bestsFromRaces, addRace, createRecorder, bestKey, assistTag, makeRecord, newRaceId, MAX_RACES } from '../../src/records.js';
import { realRace, goodRecord, finishRecord } from '../helpers/records.js';

const clone = o => JSON.parse(JSON.stringify(o));

test('a record built from a real race is valid, canonical, and survives JSON unchanged', () => {
  for (const kind of ['finish', 'wrecked', 'last']) {
    const rec = goodRecord({ kind });
    assert.deepEqual(cleanRecord(rec), rec, kind);
    assert.deepEqual(cleanRecord(clone(rec)), rec, kind + ' through JSON');
    assert.ok(JSON.stringify(rec).length < 1500, `a record is small (${JSON.stringify(rec).length} bytes)`);
  }
  const f = goodRecord({ kind: 'finish' });
  assert.equal(f.result.laps.length, 3); assert.equal(f.laps, 3); assert.equal(f.track, 'classic'); assert.equal(f.config.mode, 'race');
});

test('makeRecord copies the result: changing the live result afterwards cannot change a saved record', () => {
  const { header, result } = realRace('finish'), live = clone(result);
  const rec = makeRecord({ id: 'x', ts: '2026-11-13T12:00:00.000Z', appVersion: '1.4.0', header, level: 'veteran', result: live });
  live.laps.push(99); live.time = 1;
  assert.notEqual(rec.result.time, 1); assert.equal(rec.result.laps.length, 3);
});

test('cleanRecord refuses anything that is not a well-formed race record', () => {
  for (const x of [null, undefined, 0, 'a', true, [], [goodRecord()], () => 1]) assert.equal(cleanRecord(x), null, String(x));
  const broken = [
    ['id', ''], ['id', 5], ['id', 'x'.repeat(65)], ['id', null], ['ts', 'yesterday'], ['ts', 5], ['ts', ''], ['appVersion', ''], ['appVersion', 1], ['simVersion', 1.5], ['simVersion', -1], ['simVersion', '1'],
    ['track', ''], ['laps', 0], ['laps', 100], ['laps', 2.5], ['level', ''], ['level', 'x'.repeat(33)], ['level', 3],
    ['config', null], ['config', []], ['config', { mode: 'lab', seed: 1, assist: false, tune: { assistLane: 1, assistSpeed: 1.1 } }],
    ['config', { mode: 'race', assist: false, tune: { assistLane: 1, assistSpeed: 1.1 } }],
    ['config', { mode: 'race', seed: 1.5, assist: false, tune: { assistLane: 1, assistSpeed: 1.1 } }],
    ['config', { mode: 'race', seed: 1, assist: 'no', tune: { assistLane: 1, assistSpeed: 1.1 } }],
    ['config', { mode: 'race', seed: 1, assist: false, tune: { assistLane: 9, assistSpeed: 1.1 } }],
    ['config', { mode: 'race', seed: 1, assist: false, tune: { assistLane: 1, assistSpeed: 1.1 }, extra: 1 }],
    ['result', null], ['result', []], ['result', 'finish']
  ];
  for (const [k, v] of broken) { const r = goodRecord(); r[k] = v; assert.equal(cleanRecord(r), null, `${k} = ${JSON.stringify(v)}`); }
  for (const k of ['id', 'ts', 'appVersion', 'simVersion', 'track', 'laps', 'level', 'config', 'result']) { const r = goodRecord(); delete r[k]; assert.equal(cleanRecord(r), null, 'missing ' + k); }
  const badResult = [
    ['kind', 'quit'], ['kind', undefined], ['place', 0], ['place', 7], ['place', 1.5], ['total', 0], ['total', 13], ['time', -1], ['time', NaN], ['time', Infinity], ['time', 99999], ['time', '60'],
    ['kills', -1], ['kills', 1.5], ['laps', 'a'], ['laps', [1, 2, 3, 4]], ['laps', [-1, 20, 20]], ['laps', [NaN, 20, 20]], ['bestLap', 1], ['bestLap', null], ['bestLap', '20'], ['laps', [20, 20]],
    ['wallTouches', -1], ['wallTouches', 1.5], ['wallTouches', null], ['assistChanged', 'no'], ['assistChanged', undefined]
  ];
  for (const [k, v] of badResult) { const r = goodRecord({ kind: 'finish' }); r.result[k] = v; assert.equal(cleanRecord(r), null, `result.${k} = ${JSON.stringify(v)}`); }
  const fin = goodRecord({ kind: 'finish' }); fin.result.laps = [24, 25]; fin.result.bestLap = 24;
  assert.notEqual(cleanRecord(fin), null, 'a finished race may have fewer timed laps (reversing over the line voids one)');
  fin.result.laps = []; fin.result.bestLap = null; assert.notEqual(cleanRecord(fin), null);
  const w = goodRecord({ kind: 'wrecked' }); w.result.laps = [20, 21]; w.result.bestLap = 20; assert.notEqual(cleanRecord(w), null, 'a wrecked race may have fewer than all its laps');
  w.result.laps = [20, 21, 22, 23]; assert.equal(cleanRecord(w), null, 'but not more than the race has');
});

test('cleanRecord keeps fields a newer version added, drops them if the record is then too big, and never lets a key rewrite the prototype', () => {
  const r = goodRecord(); r.inputs = 'abc'; r.ghost = { x: 1 };
  assert.equal(cleanRecord(r).inputs, 'abc'); assert.deepEqual(cleanRecord(r).ghost, { x: 1 });
  r.inputs = 'x'.repeat(20000); assert.equal(cleanRecord(r), null, 'a record bigger than 16 KB is refused');
  const evil = JSON.parse(JSON.stringify(goodRecord()).slice(0, -1) + ',"__proto__":{"polluted":true},"constructor":5}');
  const c = cleanRecord(evil);
  assert.equal(Object.getPrototypeOf(c), Object.prototype); assert.equal(c.polluted, undefined); assert.equal({}.polluted, undefined);
  assert.equal(c.constructor, 5, 'an own field named constructor is only data');
});

test('cleanRecord returns a copy: nothing is shared with what it was given', () => {
  const raw = goodRecord(), c = cleanRecord(raw);
  c.result.laps.push(1); c.config.tune.assistLane = 0; c.level = 'x';
  assert.equal(raw.result.laps.length, 3); assert.equal(raw.config.tune.assistLane, goodRecord().config.tune.assistLane); assert.equal(raw.level, 'veteran');
});

test('cleanRaces: valid records only, each id once (the first wins), the latest 500, in order; anything else gives an empty history', () => {
  for (const x of [null, undefined, 5, 'x', {}, { length: 3 }]) assert.deepEqual(cleanRaces(x), []);
  const a = goodRecord(), b = goodRecord(), dup = { ...goodRecord(), id: a.id, level: 'rookie' }, bad = { ...goodRecord(), id: '' };
  const out = cleanRaces([a, bad, null, b, dup, 7]);
  assert.deepEqual(out.map(r => r.id), [a.id, b.id]); assert.equal(out[0].level, 'veteran', 'the first record with an id wins');
  const many = Array.from({ length: MAX_RACES + 40 }, (_, i) => ({ ...goodRecord(), id: 'm' + i }));
  const kept = cleanRaces(many); assert.equal(kept.length, MAX_RACES); assert.equal(kept[0].id, 'm40'); assert.equal(kept.at(-1).id, 'm' + (MAX_RACES + 39));
});

test('bests: the first finish sets both, a slower one changes nothing, a faster one is a new best and says what it beat', () => {
  const b = {};
  let r = updateBests(b, finishRecord('a', 80, [27, 26, 26]));
  assert.deepEqual(r, { key: 'classic/veteran/manual', newBestTime: true, newBestLap: true, previous: null, best: { time: 80, bestLap: 26 } });
  assert.deepEqual(b['classic/veteran/manual'], { time: 80, timeRace: 'a', bestLap: 26, bestLapRace: 'a' });
  r = updateBests(b, finishRecord('b', 85, [28, 28, 28]));
  assert.deepEqual([r.newBestTime, r.newBestLap, r.previous, r.best], [false, false, { time: 80, bestLap: 26 }, { time: 80, bestLap: 26 }]);
  assert.equal(b['classic/veteran/manual'].timeRace, 'a');
  r = updateBests(b, finishRecord('c', 79, [27, 26.5, 25.5]));
  assert.deepEqual([r.newBestTime, r.newBestLap, r.previous, r.best], [true, true, { time: 80, bestLap: 26 }, { time: 79, bestLap: 25.5 }]);
  assert.deepEqual(b['classic/veteran/manual'], { time: 79, timeRace: 'c', bestLap: 25.5, bestLapRace: 'c' });
  r = updateBests(b, finishRecord('d', 79, [27, 26.5, 25.5]));
  assert.deepEqual([r.newBestTime, r.newBestLap], [false, false], 'a tie is not a new best');
});

test('bests: laps count from races that did not finish; a race with no complete lap and no finish stores nothing', () => {
  const b = {};
  const w = goodRecord({ kind: 'wrecked' }); Object.assign(w.result, { laps: [24, 25], bestLap: 24, kind: 'wrecked' });
  let r = updateBests(b, w); assert.deepEqual([r.newBestTime, r.newBestLap], [false, true]);
  assert.deepEqual(b['classic/veteran/manual'], { time: null, timeRace: null, bestLap: 24, bestLapRace: w.id });
  const none = goodRecord({ kind: 'wrecked' }); Object.assign(none.result, { laps: [], bestLap: null }); none.level = 'rookie';
  r = updateBests(b, none); assert.deepEqual([r.newBestTime, r.newBestLap, r.previous], [false, false, null]);
  assert.equal(Object.keys(b).length, 1);
});

test('bests are kept apart by level and by assist; a race where assist was toggled counts for none', () => {
  const b = {};
  updateBests(b, finishRecord('a', 80, [27, 26, 26], { level: 'veteran', assist: false }));
  updateBests(b, finishRecord('b', 70, [24, 23, 23], { level: 'veteran', assist: true }));
  updateBests(b, finishRecord('c', 75, [25, 25, 25], { level: 'rookie', assist: true }));
  assert.deepEqual(Object.keys(b).sort(), ['classic/rookie/assist', 'classic/veteran/assist', 'classic/veteran/manual']);
  const mixed = finishRecord('d', 10, [3, 3, 3], { changed: true });
  assert.equal(bestKey(mixed), null); assert.equal(assistTag(mixed), 'mixed');
  assert.deepEqual(updateBests(b, mixed), { key: null, newBestTime: false, newBestLap: false, previous: null, best: null });
  assert.equal(b['classic/veteran/manual'].time, 80, 'the impossible 10 s race changed nothing');
});

test('cleanBests: only well-formed entries under well-formed keys survive', () => {
  for (const x of [null, undefined, 5, 'x', [], [1]]) assert.deepEqual(cleanBests(x), {});
  const raw = JSON.parse(`{
    "classic/veteran/manual": { "time": 80, "timeRace": "a", "bestLap": 26, "bestLapRace": "a" },
    "classic/veteran/assist": { "time": null, "bestLap": 24, "bestLapRace": "x" },
    "bad key": { "time": 80, "bestLap": 26 }, "classic/veteran/mixed": { "time": 80, "bestLap": 26 }, "classic/veteran/manual/extra": { "time": 80, "bestLap": 26 },
    "a/b/manual": { "time": "fast", "bestLap": 1 }, "a/d/manual": { "time": null, "bestLap": null }, "a/e/manual": 5, "a/f/manual": { "time": -1, "bestLap": 1 },
    "a/g/manual": { "time": 80, "bestLap": 26, "junk": 1 }, "__proto__": { "time": 1, "bestLap": 1 } }`);
  const out = cleanBests(raw);
  assert.deepEqual(Object.keys(out).sort(), ['a/g/manual', 'classic/veteran/assist', 'classic/veteran/manual']);
  assert.deepEqual(out['classic/veteran/assist'], { time: null, timeRace: null, bestLap: 24, bestLapRace: 'x' });
  assert.deepEqual(out['a/g/manual'], { time: 80, timeRace: null, bestLap: 26, bestLapRace: null }, 'unknown fields are dropped, missing ids become null');
  assert.equal({}.time, undefined); assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.keys(cleanBests(Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['t' + i + '/veteran/manual', { time: 80, bestLap: 26 }])))).length, 200, 'at most 200 entries');
});

test('mergeBests takes the better value of each field; bestsFromRaces folds a history in order', () => {
  const a = { k: { time: 80, timeRace: 'a', bestLap: 30, bestLapRace: 'a' }, only: { time: 1, timeRace: 'o', bestLap: null, bestLapRace: null } };
  const b = { k: { time: 85, timeRace: 'b', bestLap: 25, bestLapRace: 'b' }, mine: { time: null, timeRace: null, bestLap: 9, bestLapRace: 'm' } };
  assert.deepEqual(mergeBests(a, b), { k: { time: 80, timeRace: 'a', bestLap: 25, bestLapRace: 'b' }, only: a.only, mine: b.mine });
  assert.deepEqual(a.k, { time: 80, timeRace: 'a', bestLap: 30, bestLapRace: 'a' }, 'the inputs are not changed');
  const races = [finishRecord('1', 82, [28, 27, 27]), finishRecord('2', 79, [27, 26, 26]), finishRecord('3', 81, [26.5, 27, 27.5])];
  assert.deepEqual(bestsFromRaces(races)['classic/veteran/manual'], { time: 79, timeRace: '2', bestLap: 26, bestLapRace: '2' });
});

test('addRace appends, trims the history to the latest 500 (keeping every best), and never adds an id twice', () => {
  const data = { races: [], bests: {} };
  const first = addRace(data, finishRecord('first', 60, [20, 20, 20]));
  assert.deepEqual([first.duplicate, first.newBestTime, first.newBestLap], [false, true, true]);
  for (let i = 0; i < MAX_RACES + 10; i++) addRace(data, finishRecord('r' + i, 90 + i * 0.001, [30, 30, 30]));
  assert.equal(data.races.length, MAX_RACES); assert.equal(data.races[0].id, 'r10'); assert.equal(data.races.at(-1).id, 'r' + (MAX_RACES + 9));
  assert.equal(data.bests['classic/veteran/manual'].time, 60, 'the best came from a race that has since been trimmed away, and is kept');
  const dup = addRace(data, finishRecord('r20', 1, [1, 1, 1]));
  assert.equal(dup.duplicate, true); assert.equal(data.races.length, MAX_RACES); assert.equal(data.bests['classic/veteran/manual'].time, 60);
});

// ---- the recorder ----
const fakeProfile = () => ({ data: { races: [], bests: {} }, saves: 0, save() { this.saves++; } });
const fixedNow = () => new Date('2026-11-13T15:30:00.000Z');

test('the recorder saves a finished race with its header, level, version and time, and says what it set', () => {
  const { S } = realRace('finish'), P = fakeProfile(); let ids = 0;
  const rec = createRecorder({ Profile: P, appVersion: '1.4.0', getLevel: () => 'rookie', now: fixedNow, newId: () => 'id-' + (++ids) });
  const info = rec.recordRace(S);
  assert.equal(P.saves, 1); assert.equal(P.data.races.length, 1);
  const saved = P.data.races[0];
  assert.deepEqual([saved.id, saved.ts, saved.appVersion, saved.level, saved.simVersion, saved.track], ['id-1', '2026-11-13T15:30:00.000Z', '1.4.0', 'rookie', S.simVersion, 'classic']);
  assert.deepEqual(saved.config, S.config); assert.deepEqual(saved.result.laps, S.result.laps);
  assert.deepEqual([info.record.id, info.newBestTime, info.newBestLap, info.previous], ['id-1', true, true, null]);
  assert.deepEqual(P.data.bests['classic/rookie/manual'].time, S.result.time);
  assert.notEqual(cleanRecord(saved), null);
});

test('the recorder saves wrecked and last-car races too, and ignores the lab, the demo, and a race with no result', () => {
  const P = fakeProfile(), rec = createRecorder({ Profile: P, appVersion: '1.4.0', getLevel: () => 'veteran', now: fixedNow });
  for (const kind of ['wrecked', 'last']) assert.ok(rec.recordRace(realRace(kind).S), kind);
  assert.equal(P.data.races.length, 2); assert.equal(P.saves, 2);
  const lab = { result: { kind: 'wrecked' }, config: { mode: 'lab' } }, attract = { result: { kind: 'last' }, config: { mode: 'attract' } };
  assert.equal(rec.recordRace(lab), null); assert.equal(rec.recordRace(attract), null);
  assert.equal(rec.recordRace({ result: null, config: { mode: 'race' } }), null); assert.equal(rec.recordRace({ result: { kind: 'finish' } }), null);
  assert.equal(P.data.races.length, 2); assert.equal(P.saves, 2);
});

test('a result that is not a valid record is reported (it is a bug) and never reaches the history', () => {
  const { S } = realRace('finish'), P = fakeProfile(), rec = createRecorder({ Profile: P, appVersion: '1.4.0', getLevel: () => 'veteran', now: fixedNow });
  const broken = { ...S, result: { ...clone(S.result), laps: [1, 2], bestLap: 99 }, config: S.config, simVersion: S.simVersion };
  assert.throws(() => rec.recordRace(broken), /not valid/); assert.equal(P.data.races.length, 0); assert.equal(P.saves, 0);
});

test('race ids are unique and well-formed', () => {
  const ids = new Set(Array.from({ length: 1000 }, newRaceId));
  assert.equal(ids.size, 1000); for (const id of ids) assert.match(id, /^[0-9a-f-]{32,36}$/);
});
