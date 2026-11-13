import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiag, watchWindow } from '../../src/diag.js';

test('it keeps the most recent entries and counts every one', () => {
  const d = createDiag({ max: 5, now: () => 123 });
  for (let i = 1; i <= 8; i++) d.record('frame', new Error('e' + i));
  assert.equal(d.total, 8);
  assert.deepEqual(d.entries().map(e => e.message), ['e4', 'e5', 'e6', 'e7', 'e8']);
  assert.equal(d.last.message, 'e8'); assert.equal(d.last.at, 123); assert.equal(d.last.source, 'frame');
});

test('an empty log has no last entry; clear empties it', () => {
  const d = createDiag();
  assert.equal(d.last, null); assert.equal(d.total, 0); assert.deepEqual(d.entries(), []);
  d.record('x', 'boom'); d.clear();
  assert.equal(d.total, 0); assert.equal(d.last, null);
});

test('it records whatever was thrown, and never throws itself', () => {
  const d = createDiag();
  const nasty = { get message() { throw new Error('getter exploded'); } };
  const circular = {}; circular.self = circular;
  for (const v of ['text', 42, null, undefined, { message: 'obj' }, new TypeError('typed'), nasty, circular, Symbol('s').description, () => 1]) {
    assert.doesNotThrow(() => d.record('test', v));
  }
  assert.equal(d.total, 10);
  assert.equal(d.entries()[0].message, 'text');
  assert.equal(d.entries()[3].message, 'undefined');
  assert.equal(d.entries()[4].message, 'obj');
  assert.equal(d.entries()[6].message, 'unprintable error');
});

test('long messages and stacks are cut so the log stays small', () => {
  const d = createDiag(), e = new Error('x'.repeat(5000)); e.stack = 'y'.repeat(5000);
  d.record('big', e);
  assert.equal(d.last.message.length, 300); assert.equal(d.last.stack.length, 800);
});

test('entries() returns a copy, so callers cannot change the log', () => {
  const d = createDiag(); d.record('a', 'one');
  d.entries().pop();
  assert.equal(d.entries().length, 1);
});

test('uncaught errors and unhandled rejections from the window are recorded', () => {
  const d = createDiag(), target = new EventTarget();
  watchWindow(d, target);
  const err = new Error('uncaught'); const ev = new Event('error'); ev.error = err; target.dispatchEvent(ev);
  const rej = new Event('unhandledrejection'); rej.reason = new Error('rejected'); target.dispatchEvent(rej);
  const bare = new Event('error'); bare.message = 'Script error.'; target.dispatchEvent(bare);
  assert.deepEqual(d.entries().map(e => [e.source, e.message]), [['window', 'uncaught'], ['promise', 'rejected'], ['window', 'Script error.']]);
});
