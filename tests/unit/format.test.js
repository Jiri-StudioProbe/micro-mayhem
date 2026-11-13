import test from 'node:test';
import assert from 'node:assert/strict';
import { ord, fmtTime } from '../../src/ui/format.js';

test('ord: ordinal suffixes, including the teens', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(ord), ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH']);
  assert.deepEqual([11, 12, 13, 21, 22, 23, 101, 111, 112].map(ord), ['11TH', '12TH', '13TH', '21ST', '22ND', '23RD', '101ST', '111TH', '112TH']);
});

test('fmtTime: minutes and tenths of a second, seconds zero-padded below ten', () => {
  assert.equal(fmtTime(0), '0:00.0');
  assert.equal(fmtTime(9.94), '0:09.9');
  assert.equal(fmtTime(65.2), '1:05.2');
  assert.equal(fmtTime(83.4), '1:23.4');
  assert.equal(fmtTime(600), '10:00.0');
});

test('fmtTime can show hundredths (the records block does), and still pads the seconds', () => {
  assert.equal(fmtTime(83.416, 2), '1:23.42'); assert.equal(fmtTime(5.5, 2), '0:05.50');
  assert.equal(fmtTime(83.4), '1:23.4', 'one decimal is still the default');
});

test('fmtTime rounds before it splits into minutes, so a time just under a minute never reads 0:60', () => {
  assert.equal(fmtTime(59.96), '1:00.0'); assert.equal(fmtTime(59.949), '0:59.9'); assert.equal(fmtTime(59.999, 2), '1:00.00'); assert.equal(fmtTime(119.996, 2), '2:00.00');
  assert.equal(fmtTime(0), '0:00.0'); assert.equal(fmtTime(0.004, 2), '0:00.00'); assert.equal(fmtTime(600), '10:00.0');
  for (let t = 0; t < 400; t += 0.0137) for (const d of [1, 2]) assert.match(fmtTime(t, d), /^\d+:[0-5]\d\.\d+$/, `${t} -> ${fmtTime(t, d)}`);
});
