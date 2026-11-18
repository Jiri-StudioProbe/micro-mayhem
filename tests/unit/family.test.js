import test from 'node:test';
import assert from 'node:assert/strict';
import { listBoards, defaultBoard, rankBoard } from '../../src/ui/family.js';
import { boardLabel } from '../../src/ui/history.js';
import { character } from '../helpers/household.js';

// A character with bests given directly: { 'classic/veteran/manual': [time, lap] } (null for a value that is not set).
const withBests = (id, name, bests, extra = {}) => ({ ...character(id, name, [], extra), bests: Object.fromEntries(Object.entries(bests).map(([k, [time, bestLap]]) => [k, { time, timeRace: time === null ? null : 'r', bestLap, bestLapRace: bestLap === null ? null : 'r' }])) });
const V = 'classic/veteran/manual', R = 'classic/rookie/assist';

test('a board is named from its key, the way the personal bests name it', () => {
  assert.equal(boardLabel(V), 'VETERAN · NO ASSIST'); assert.equal(boardLabel(R), 'ROOKIE · ASSIST');
});

test('the boards are every board anyone has a best on, once, in a fixed order; nobody has raced: none', () => {
  const house = [withBests('a', 'Ada', { [V]: [80, 26] }), withBests('b', 'Bo', { [R]: [90, 28], [V]: [85, 27] }), character('c', 'Cy')];
  assert.deepEqual(listBoards(house), [{ key: R, label: 'ROOKIE · ASSIST' }, { key: V, label: 'VETERAN · NO ASSIST' }]);
  assert.deepEqual(listBoards([character('a', 'Ada'), character('b', 'Bo')]), []); assert.deepEqual(listBoards([]), []);
  assert.deepEqual(listBoards(house.slice().reverse()), listBoards(house), 'the order does not depend on who is listed first');
});

test('the board to show first: the player\'s own level and assist, else one they have raced on, else the first', () => {
  const ada = withBests('a', 'Ada', { [V]: [80, 26] }), bo = withBests('b', 'Bo', { [R]: [90, 28] }, { level: 'rookie' });
  const boards = listBoards([ada, bo]);
  assert.equal(defaultBoard(boards, ada, false), V); assert.equal(defaultBoard(boards, bo, true), R);
  assert.equal(defaultBoard(boards, bo, false), R, 'Rookie without assist has no board: the one Bo has raced on');
  assert.equal(defaultBoard(boards, character('c', 'Cy'), true), boards[0].key, 'a player with no races: the first board');
  assert.equal(defaultBoard(boards, { ...ada, level: 'constructor' }, false), V, 'an unknown level counts as Veteran');
  assert.equal(defaultBoard(boards, null, false), V); assert.equal(defaultBoard([], ada, false), null);
  const cy = withBests('c', 'Cy', { [V]: [80, 26] });   // Veteran, and the assist is on: no such board, so the one Cy has raced on (not the first, which is Bo's)
  assert.equal(defaultBoard(listBoards([bo, cy]), cy, true), V);
});

test('ranked by race time: fastest first, ties share a rank, the one playing is marked', () => {
  const house = [withBests('a', 'Ada', { [V]: [83.4, 27.1] }), withBests('b', 'Bo', { [V]: [80.2, 26.9] }), withBests('c', 'Cy', { [V]: [83.4, 26.5] }), withBests('d', 'Di', { [V]: [90, 29] })];
  const { rows, none } = rankBoard(house, V, 'time', 'c');
  assert.deepEqual(rows.map(r => [r.name, r.rank, r.time, r.lap, r.current]), [['Bo', 1, 80.2, 26.9, false], ['Ada', 2, 83.4, 27.1, false], ['Cy', 2, 83.4, 26.5, true], ['Di', 4, 90, 29, false]], 'a tie is 2, 2, then 4, like a race; ties by name');
  assert.deepEqual(none, []);
});

test('ranked by best lap: a different order, from the same bests', () => {
  const house = [withBests('a', 'Ada', { [V]: [83.4, 27.1] }), withBests('b', 'Bo', { [V]: [80.2, 26.9] }), withBests('c', 'Cy', { [V]: [95, 26.5] })];
  assert.deepEqual(rankBoard(house, V, 'lap').rows.map(r => [r.name, r.rank]), [['Cy', 1], ['Bo', 2], ['Ada', 3]]);
  assert.deepEqual(rankBoard(house, V, 'time').rows.map(r => [r.name, r.rank]), [['Bo', 1], ['Ada', 2], ['Cy', 3]]);
});

test('someone with a best lap but no finished race is listed below the ranked, without a rank, when sorting by race time; and the other way round', () => {
  const house = [withBests('a', 'Ada', { [V]: [null, 26] }), withBests('b', 'Bo', { [V]: [80, 27] }), withBests('c', 'Cy', { [V]: [null, 25] })];
  assert.deepEqual(rankBoard(house, V, 'time').rows.map(r => [r.name, r.rank, r.time, r.lap]), [['Bo', 1, 80, 27], ['Cy', null, null, 25], ['Ada', null, null, 26]], 'the unranked are in lap order, not the order they are listed in');
  assert.deepEqual(rankBoard(house, V, 'lap').rows.map(r => [r.name, r.rank]), [['Cy', 1], ['Ada', 2], ['Bo', 3]]);
});

test('players with nothing on a board are named separately, never ranked; a board nobody has raced on is empty', () => {
  const house = [withBests('a', 'Ada', { [V]: [80, 26] }), withBests('b', 'Bo', { [R]: [90, 28] }), character('c', 'Cy')];
  const v = rankBoard(house, V, 'time'); assert.deepEqual(v.rows.map(r => r.name), ['Ada']); assert.deepEqual(v.none, ['Bo', 'Cy']);
  assert.deepEqual(rankBoard([...house, withBests('x', 'Xi', { [V]: [null, null] })], V).none, ['Bo', 'Cy', 'Xi'], 'a best with neither a time nor a lap is nothing');
  const nobody = rankBoard(house, 'classic/veteran/assist', 'time'); assert.deepEqual([nobody.rows, nobody.none], [[], ['Ada', 'Bo', 'Cy']]);
  assert.deepEqual(rankBoard([], V), { rows: [], none: [] });
});

test('the order is the same however the household is listed, and the same value of different players is told apart by name', () => {
  const house = [withBests('a', 'zed', { [V]: [80, 26] }), withBests('b', 'Amy', { [V]: [80, 26] }), withBests('c', 'bob', { [V]: [80, 26] })];
  const names = h => rankBoard(h, V).rows.map(r => r.name);
  assert.deepEqual(names(house), ['Amy', 'bob', 'zed']); assert.deepEqual(names(house.slice().reverse()), ['Amy', 'bob', 'zed']);
  assert.deepEqual(rankBoard(house, V).rows.map(r => r.rank), [1, 1, 1]);
});

test('it reads the bests and changes nothing; a prototype-named key is not a board; a name from storage is passed through as it is', () => {
  const house = [withBests('a', '<b>Ada</b>', { [V]: [80, 26] })], before = JSON.stringify(house);
  assert.equal(rankBoard(house, V).rows[0].name, '<b>Ada</b>'); assert.equal(JSON.stringify(house), before);
  assert.deepEqual(rankBoard(house, 'constructor').rows, []); assert.deepEqual(rankBoard(house, '__proto__').rows, []); assert.deepEqual(rankBoard(house, 'toString').none, ['<b>Ada</b>']);
});
