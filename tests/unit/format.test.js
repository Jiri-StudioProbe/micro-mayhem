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
