import test from 'node:test';
import assert from 'node:assert/strict';
test('DELIBERATE FAILURE to prove a broken test blocks the deploy', () => { assert.equal(1 + 1, 3); });
