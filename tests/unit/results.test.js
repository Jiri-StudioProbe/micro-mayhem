import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBests } from '../../src/ui/results.js';
import { updateBests } from '../../src/records.js';
import { finishRecord, goodRecord } from '../helpers/records.js';

const DASH = '—';
// What the game does at the end of a race: fold it into the bests, then describe what that did.
const after = (bests, rec) => ({ record: rec, ...updateBests(bests, rec) });
const row = (d, label) => d.rows.find(r => r.label === label);

test('nothing to describe without a recorded race (the lab, or a race that could not be recorded)', () => {
  for (const x of [null, undefined, {}, { record: null }]) assert.equal(describeBests(x), null);
});

test('the first finish on a board is a new best for both the time and the lap, shown to hundredths', () => {
  const d = describeBests(after({}, finishRecord('a', 83.416, [28.1, 27.3, 27.9])));
  assert.equal(d.note, 'VETERAN · NO ASSIST');
  assert.deepEqual(row(d, 'Race time'), { label: 'Race time', race: '1:23.42', best: '1:23.42', tag: { text: 'NEW BEST', kind: 'new' } });
  assert.deepEqual(row(d, 'Best lap'), { label: 'Best lap', race: '0:27.30', best: '0:27.30', tag: { text: 'NEW BEST', kind: 'new' } });
});

test('a slower race shows your best and how much slower this one was; a faster lap is a new best on its own', () => {
  const b = {}; updateBests(b, finishRecord('a', 80, [27, 26, 26.5]));
  const d = describeBests(after(b, finishRecord('b', 81.8, [28, 27, 25.9])));
  assert.deepEqual(row(d, 'Race time'), { label: 'Race time', race: '1:21.80', best: '1:20.00', tag: { text: '+1.80 s', kind: 'slower' } });
  assert.deepEqual(row(d, 'Best lap'), { label: 'Best lap', race: '0:25.90', best: '0:25.90', tag: { text: 'NEW BEST', kind: 'new' } });
});

test('equal to your best is "tied", not a new best', () => {
  const b = {}; updateBests(b, finishRecord('a', 80, [27, 26, 26.5]));
  const d = describeBests(after(b, finishRecord('b', 80, [27, 26, 26.5])));
  assert.deepEqual(row(d, 'Race time').tag, { text: 'TIED BEST', kind: 'tied' }); assert.deepEqual(row(d, 'Best lap').tag, { text: 'TIED BEST', kind: 'tied' });
});

test('a race that did not finish has no time of its own, but its laps count; with no lap done there is nothing to compare', () => {
  const b = {}; updateBests(b, finishRecord('a', 80, [27, 26, 26.5]));
  const w = goodRecord({ kind: 'wrecked' }); Object.assign(w.result, { laps: [26.5], bestLap: 26.5 });
  let d = describeBests(after(b, w));
  assert.deepEqual(row(d, 'Race time'), { label: 'Race time', race: DASH, best: '1:20.00', tag: null });
  assert.deepEqual(row(d, 'Best lap'), { label: 'Best lap', race: '0:26.50', best: '0:26.00', tag: { text: '+0.50 s', kind: 'slower' } });
  const none = goodRecord({ kind: 'wrecked' }); Object.assign(none.result, { laps: [], bestLap: null });
  d = describeBests(after(b, none));
  assert.deepEqual([row(d, 'Race time').tag, row(d, 'Best lap').race, row(d, 'Best lap').tag, row(d, 'Best lap').best], [null, DASH, null, '0:26.00']);
});

test('wrecked on an empty board: a hint instead of empty rows', () => {
  const none = goodRecord({ kind: 'wrecked' }); Object.assign(none.result, { laps: [], bestLap: null });
  const d = describeBests(after({}, none));
  assert.deepEqual(d.rows, []); assert.match(d.note, /FINISH A LAP TO SET YOUR FIRST BEST/); assert.match(d.note, /^VETERAN/);
});

test('the board is named by level and assist; a race where assist was switched sets no record and says so', () => {
  assert.equal(describeBests(after({}, finishRecord('r', 80, [27, 26, 26], { level: 'rookie', assist: true }))).note, 'ROOKIE · ASSIST');
  const d = describeBests(after({}, finishRecord('m', 80, [27, 26, 26], { changed: true })));
  assert.deepEqual(d.rows, []); assert.match(d.note, /ASSIST WAS SWITCHED/);
});

test('a finished race with fewer timed laps (one voided by reversing) shows what it has', () => {
  const rec = finishRecord('v', 90, [27]); const d = describeBests(after({}, rec));
  assert.equal(row(d, 'Best lap').race, '0:27.00'); assert.equal(row(d, 'Race time').race, '1:30.00');
});
