import test from 'node:test';
import assert from 'node:assert/strict';
import { createLapTimer } from '../../src/ui/lab.js';

const N = 100;   // track samples per lap in these tests
const world = () => ({ t: 0, touches: 0, player: { prog: -5 } });
// Moves the player to `prog` at game time `t`, with `touches` wall touches so far, and lets the timer look.
const at = (S, timer, prog, t, touches = S.touches) => { S.player.prog = prog; S.t = t; S.touches = touches; timer.track(); };

test('behind the line nothing is timed; crossing it starts lap 0, the next crossing finishes it', () => {
  const S = world(), timer = createLapTimer({ S, N });
  at(S, timer, -5, 0); assert.equal(timer.lab.lap, -1); assert.equal(timer.lab.t0, null);
  at(S, timer, 3, 1); assert.equal(timer.lab.lap, 0); assert.equal(timer.lab.t0, 1); assert.equal(timer.lab.last, null, 'the first crossing only starts the clock');
  at(S, timer, 60, 20); assert.equal(timer.lab.last, null);
  at(S, timer, 101, 31); assert.equal(timer.lab.lap, 1); assert.equal(timer.lab.last, 30); assert.equal(timer.lab.best, 30);
});

test('best is the minimum, last is the latest; wall touches are counted per lap', () => {
  const S = world(), timer = createLapTimer({ S, N });
  at(S, timer, 1, 0, 0);
  at(S, timer, 101, 40, 3); assert.deepEqual([timer.lab.last, timer.lab.best, timer.lab.prevHits], [40, 40, 3]);
  at(S, timer, 201, 70, 4); assert.deepEqual([timer.lab.last, timer.lab.best, timer.lab.prevHits], [30, 30, 1]);
  at(S, timer, 301, 110, 4); assert.deepEqual([timer.lab.last, timer.lab.best, timer.lab.prevHits], [40, 30, 0], 'a slower lap does not replace the best');
  assert.equal(S.touches - timer.lab.touches0, 0, 'the current lap starts at zero touches');
});

test('reversing back over the line cancels the lap: it is not timed when the line is crossed again', () => {
  const S = world(), timer = createLapTimer({ S, N });
  at(S, timer, 1, 0); at(S, timer, 101, 30);
  at(S, timer, 95, 33);
  assert.equal(timer.lab.lap, 0); assert.equal(timer.lab.t0, null, 'the lap in progress is void');
  at(S, timer, 102, 36); assert.equal(timer.lab.lap, 1); assert.equal(timer.lab.last, 30, 'the void lap added no time');
  at(S, timer, 201, 66); assert.equal(timer.lab.last, 30);
});

test('reset forgets everything (a new lab session)', () => {
  const S = world(), timer = createLapTimer({ S, N });
  at(S, timer, 1, 0); at(S, timer, 101, 30, 2);
  timer.reset();
  assert.deepEqual({ ...timer.lab }, { lap: -1, t0: null, last: null, best: null, touches0: 0, prevHits: null });
});
