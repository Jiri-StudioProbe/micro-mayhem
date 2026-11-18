// The family board (M3.1c): the household's characters ranked on their personal bests. Pure: characters in, rows out. (The DOM is familyui.js.)
// Nothing is stored for it: it is read from each character's `bests`, which are kept for ever, so the board is always what the races say.
// A board is a track, a level and whether the driving assist was on (`classic/veteran/manual`), exactly as in the personal bests: a Rookie with
// assist and a Veteran without are never ranked against each other. Names came from storage: the caller shows them with textContent.
import { boardLabel } from './history.js';
import { LEVELS } from '../levels.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const KEY_ORDER = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The boards anyone in the household has a best on, in a fixed order: [{ key, label }].
export function listBoards(characters) {
  const keys = new Set();
  for (const c of characters) for (const k of Object.keys(c.bests)) keys.add(k);
  return [...keys].sort(KEY_ORDER).map(key => ({ key, label: boardLabel(key) }));
}

// The board to show first: the one the character who is playing races on now (their level, with the assist as it starts), else any board they
// have a best on, else the first.
export function defaultBoard(boards, current, assistOn, track = 'classic') {
  if (!boards.length) return null;
  const level = current && has(LEVELS, current.level) ? current.level : 'veteran';
  const wanted = track + '/' + level + '/' + (assistOn ? 'assist' : 'manual');
  if (boards.some(b => b.key === wanted)) return wanted;
  const mine = current ? boards.find(b => has(current.bests, b.key)) : null;
  return (mine || boards[0]).key;
}

// One board ranked by `by` ('time' = race time, 'lap' = best lap; smaller is better). -> { rows, none }
//   rows: [{ id, name, rank, time, lap, current }] ranked first (equal values share a rank, as in a race: 1, 1, 3), then, unranked (rank null),
//         those who have no value for this sort but have the other one (a best lap but no finished race), then
//   none: the names of the characters with no best on this board at all.
export function rankBoard(characters, key, by = 'time', currentId = null) {
  const field = by === 'lap' ? 'bestLap' : 'time';
  const mine = [], rest = [], none = [];
  for (const c of characters) {
    const b = has(c.bests, key) ? c.bests[key] : null;
    if (!b || (b.time === null && b.bestLap === null)) { none.push(c.name); continue; }
    const row = { id: c.id, name: c.name, rank: null, time: b.time, lap: b.bestLap, current: c.id === currentId };
    (b[field] !== null ? mine : rest).push(row);
  }
  const f = r => (by === 'lap' ? r.lap : r.time), g = r => (by === 'lap' ? r.time : r.lap);
  const byName = (a, b) => KEY_ORDER(a.name.toLowerCase(), b.name.toLowerCase()) || KEY_ORDER(a.id, b.id);
  mine.sort((a, b) => f(a) - f(b) || byName(a, b));
  rest.sort((a, b) => g(a) - g(b) || byName(a, b));
  mine.forEach((r, i) => { r.rank = i > 0 && f(r) === f(mine[i - 1]) ? mine[i - 1].rank : i + 1; });
  return { rows: [...mine, ...rest], none };
}
