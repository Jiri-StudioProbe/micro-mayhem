import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBoards, describeRace, describeDetail, defaultFmtDate, boardName } from '../../src/ui/history.js';
import { describeResult } from '../../src/ui/results.js';
import { goodRecord, finishRecord } from '../helpers/records.js';

const DASH = '—';
const fmt = ts => 'D:' + ts.slice(0, 16);

test('describeResult: the headline of each kind of ending', () => {
  assert.deepEqual(describeResult({ kind: 'finish', place: 1 }), { kick: 'CHEQUERED FLAG', head: 'YOU WIN', place: '1ST', timeLabel: 'RACE TIME' });
  assert.equal(describeResult({ kind: 'finish', place: 3 }).head, 'PODIUM'); assert.equal(describeResult({ kind: 'finish', place: 4 }).head, 'CROSSED THE LINE');
  assert.deepEqual(describeResult({ kind: 'last', place: 1 }), { kick: 'NOBODY LEFT TO RACE', head: 'LAST CAR STANDING', place: '1ST', timeLabel: 'SURVIVED' });
  assert.deepEqual(describeResult({ kind: 'wrecked', place: 5 }), { kick: 'HULL AT ZERO', head: 'WRECKED', place: DASH, timeLabel: 'SURVIVED' });
});

test('a list line: the result and time, the board, the best lap, and when', () => {
  const win = finishRecord('a', 83.416, [28.1, 27.3, 27.9]); win.result.place = 1;
  assert.deepEqual(describeRace(win, fmt), { id: 'a', kind: 'finish', win: true, head: '1ST · 1:23.4', sub: 'VETERAN · NO ASSIST · BEST LAP 0:27.30', when: 'D:2026-11-13T12:00' });
  const fourth = finishRecord('b', 90, [30, 30, 30]); fourth.result.place = 4; fourth.level = 'rookie'; fourth.config.assist = true;
  const d = describeRace(fourth, fmt); assert.deepEqual([d.head, d.sub, d.win], ['4TH · 1:30.0', 'ROOKIE · ASSIST · BEST LAP 0:30.00', false]);
  const w = goodRecord({ kind: 'wrecked' }); Object.assign(w.result, { laps: [], bestLap: null, time: 41.2 });
  assert.deepEqual([describeRace(w, fmt).head, describeRace(w, fmt).sub], ['WRECKED · 0:41.2', 'VETERAN · NO ASSIST']);
  const l = goodRecord({ kind: 'last' }); assert.match(describeRace(l, fmt).head, /^LAST CAR STANDING · /);
  assert.equal(describeRace(l, fmt).win, true, 'outlasting everyone is a win');
  assert.equal(describeRace(w, fmt).win, false); w.result.place = 1; assert.equal(describeRace(w, fmt).win, false, 'wrecked is never a win'); const third = finishRecord('t', 90, [30, 30, 30]); third.result.place = 3; assert.equal(describeRace(third, fmt).win, false, 'a podium place is not the win');
});

test('a race where assist was switched is named so, in the list and the details', () => {
  const m = finishRecord('m', 80, [27, 26, 26], { changed: true });
  assert.equal(boardName(m), 'VETERAN · ASSIST SWITCHED'); assert.match(describeRace(m, fmt).sub, /^VETERAN · ASSIST SWITCHED/);
  assert.deepEqual(describeDetail(m, fmt).rows.find(r => r[0] === 'Driving assist'), ['Driving assist', 'switched during the race']);
});

test('the details: every fact of the race, then a technical line', () => {
  const rec = finishRecord('abcdef123456', 83.416, [28.1, 27.3, 27.9]); Object.assign(rec.result, { place: 2, total: 6, kills: 3, wallTouches: 5 });
  const d = describeDetail(rec, fmt);
  assert.equal(d.kick, 'CHEQUERED FLAG'); assert.equal(d.title, 'PODIUM');
  assert.deepEqual(d.rows, [['Date', 'D:2026-11-13T12:00'], ['Level', 'VETERAN'], ['Driving assist', 'off'], ['Place', '2ND of 6'], ['Race time', '1:23.42'], ['Best lap', '0:27.30'],
    ['Laps', '1: 0:28.10\n2: 0:27.30\n3: 0:27.90'], ['Wrecks', '3'], ['Wall touches', '5']]);
  assert.equal(d.tech, `seed ${rec.config.seed} · rules v${rec.simVersion} · game 1.4.0 · id abcdef12`);
  const w = goodRecord({ kind: 'wrecked' }); Object.assign(w.result, { laps: [], bestLap: null, time: 41.25 });
  const dw = describeDetail(w, fmt); assert.deepEqual([dw.rows[3], dw.rows[4], dw.rows[5], dw.rows[6]], [['Place', DASH], ['Survived', '0:41.25'], ['Best lap', DASH], ['Laps', DASH]]);
});

test('your bests, one line per board, in a steady order', () => {
  const bests = { 'classic/veteran/manual': { time: 80, timeRace: 'a', bestLap: 26, bestLapRace: 'a' }, 'classic/rookie/assist': { time: null, timeRace: null, bestLap: 24.5, bestLapRace: 'b' } };
  assert.deepEqual(describeBoards(bests), [{ board: 'ROOKIE · ASSIST', time: DASH, lap: '0:24.50' }, { board: 'VETERAN · NO ASSIST', time: '1:20.00', lap: '0:26.00' }]);
  assert.deepEqual(describeBoards({}), []);
});

test('defaultFmtDate gives a short local date and time, or a dash for a date that is not one', () => {
  const s = defaultFmtDate('2026-11-13T15:30:00.000Z');
  assert.ok(s.length >= 5 && s !== DASH, s); assert.match(s, /\d/);
  assert.equal(defaultFmtDate('yesterday'), DASH);
});

test('text from storage is passed through as it is (the screens set it as text, never as markup)', () => {
  const rec = finishRecord('<img src=x onerror=alert(1)>', 80, [27, 26, 26], { level: '<b>x</b>' });
  rec.appVersion = '<script>';
  const d = describeDetail(rec, fmt);
  assert.ok(d.tech.includes('id <img src') && d.tech.includes('<script>')); assert.equal(d.rows[1][1], '<B>X</B>');
});

import { describePreview } from '../../src/ui/history.js';
const base = { races: 12, newRaces: 5, localOnly: 3, droppedRaces: 0, boards: 3, newBoards: 1, betterBests: 2, level: 'rookie', savedAt: '2026-11-12T18:02:00.000Z', newerVersion: false };

test('the backup preview says how many races and boards the code holds and what is new, in plain sentences', () => {
  const d = describePreview(base, fmt);
  assert.deepEqual(d.lines, ['12 races, 5 new to this device.', '3 boards of bests, 2 better than yours, 1 new to this device.', 'Saved D:2026-11-12T18:02. Level in the code: ROOKIE.']);
  assert.match(d.merge, /keeps your settings/); assert.match(d.replace, /The 3 races here that are not in the code would be lost\./);
});

test('the preview handles the small cases: one of a thing, none, nothing new, damaged records, a newer version', () => {
  const one = describePreview({ ...base, races: 1, newRaces: 1, localOnly: 1, boards: 1, newBoards: 0, betterBests: 0 }, fmt);
  assert.deepEqual(one.lines.slice(0, 2), ['1 race, 1 new to this device.', '1 board of bests.']); assert.match(one.replace, /The 1 race here that is not in the code would be lost/);
  const none = describePreview({ ...base, races: 0, newRaces: 0, localOnly: 0, boards: 0, newBoards: 0, betterBests: 0, savedAt: null }, fmt);
  assert.deepEqual(none.lines, ['0 races.', 'No bests.']); assert.doesNotMatch(none.replace, /lost/);
  assert.equal(describePreview({ ...base, newRaces: 0 }, fmt).lines[0], '12 races, none new to this device.');
  assert.ok(describePreview({ ...base, droppedRaces: 1 }, fmt).lines.includes('1 damaged record was left out.')); assert.ok(describePreview({ ...base, droppedRaces: 4 }, fmt).lines.includes('4 damaged records were left out.'));
  assert.match(describePreview({ ...base, newerVersion: true }, fmt).lines.at(-1), /newer version/);
});
