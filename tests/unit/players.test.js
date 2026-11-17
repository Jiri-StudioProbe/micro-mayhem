import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWho, describePlayers, describePlayer, describeError } from '../../src/ui/players.js';
import { newCharacter, MAX_CHARACTERS } from '../../src/household.js';
import { ctx, character } from '../helpers/household.js';
import { finishRecord } from '../helpers/records.js';

test('the start screen button says who is playing; an unused Player is asked for a name instead', () => {
  const fresh = newCharacter({}, ctx());
  assert.equal(describeWho(fresh), 'WHO ARE YOU? SET YOUR NAME');
  assert.equal(describeWho(character('a', 'Ada')), 'PLAYING AS ADA · CHANGE');
  assert.equal(describeWho({ ...fresh, name: 'Player', races: [finishRecord('r', 80, [27, 26, 26])] }), 'PLAYING AS PLAYER · CHANGE', 'a Player who has raced is a real player');
  assert.equal(describeWho(character('a', '<b>Ada</b>')), 'PLAYING AS <B>ADA</B> · CHANGE', 'text only: the caller sets textContent');
});

test('the household list: one row each, in order, with level and race count, and who is on', () => {
  const rows = describePlayers([character('a', 'Ada', [finishRecord('r1', 80, [27, 26, 26]), finishRecord('r2', 81, [27, 26, 26])]), character('b', 'Bo', [], { level: 'rookie' }), character('c', 'Cy', [], { level: 'odd' })], 'b');
  assert.deepEqual(rows, [{ id: 'a', name: 'Ada', current: false, sub: 'VETERAN · 2 RACES' }, { id: 'b', name: 'Bo', current: true, sub: 'ROOKIE · 0 RACES' }, { id: 'c', name: 'Cy', current: false, sub: 'ODD · 0 RACES' }]);
  assert.equal(describePlayers([character('a', 'Ada', [finishRecord('r1', 80, [27, 26, 26])])], 'a')[0].sub, 'VETERAN · 1 RACE');
  assert.deepEqual(describePlayers([], 'x'), []);
});

test('every refusal has a sentence, and an unknown code still gets one', () => {
  const fallback = describeError('nonsense'), seen = new Set();
  for (const code of ['name', 'taken', 'full', 'last', 'unknown']) { const t = describeError(code); assert.match(t, /^[A-Z].*\.$/, code); assert.notEqual(t, fallback, code + ' has a sentence of its own'); seen.add(t); }
  assert.equal(seen.size, 5, 'and each differs from the others'); assert.match(describeError('last'), /last player/);
  assert.match(describeError('full'), new RegExp('up to ' + MAX_CHARACTERS));
  assert.equal(describeError('nonsense'), 'That did not work.'); assert.equal(describeError(undefined), 'That did not work.');
});

test('the one-player screen: a new player cannot be deleted; an existing one can unless they are the last, and the note says what deleting costs', () => {
  const n = describePlayer(null, 2);
  assert.deepEqual([n.title, n.save, n.canDelete], ['New player', 'ADD PLAYER', false]); assert.match(n.note, /nickname/);
  const withRaces = describePlayer(character('a', 'Ada', [finishRecord('r1', 80, [27, 26, 26]), finishRecord('r2', 81, [27, 26, 26])]), 2);
  assert.deepEqual([withRaces.title, withRaces.save, withRaces.canDelete], ['Ada', 'SAVE NAME', true]); assert.match(withRaces.note, /their 2 races/);
  assert.match(describePlayer(character('a', 'Ada', [finishRecord('r1', 80, [27, 26, 26])]), 2).note, /their 1 race\./);
  assert.match(describePlayer(character('a', 'Ada'), 2).note, /no races yet/);
  const last = describePlayer(character('a', 'Ada'), 1);
  assert.equal(last.canDelete, false); assert.equal(last.note, describeError('last'));
});
