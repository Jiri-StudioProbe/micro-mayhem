// How two copies of a household's shared state become one (M3.2). Pure: no network, no storage, no clock.
//
// What is shared is the META of a household: each character's ROW (everything about them except their races: name, level, dates, personal
// bests, anything a later version adds) and the TOMBSTONES of the characters that were deleted. Races are not part of it: a race never changes
// once it is recorded, so they are simply collected by id (see sync.js).
//
// mergeMeta(a, b) is a JOIN: it gives the same result whichever way round the two copies come, whichever way three or more are grouped, and
// merging a copy with something it already contains changes nothing (tests/unit/net-merge.test.js checks all three on thousands of random
// cases). That is what makes devices that sync in any order, any number of times, end with the same household: there is nothing to coordinate.
//   - A character's name and level (and any field this version does not know) are those of whoever changed them LAST (updatedAt; an exact tie
//     is broken by comparing the rows themselves, the same way everywhere).
//   - Personal bests are the better of the two, board by board, whoever changed them when.
//   - A tombstone says "deleted". **Deleting always wins**: a character with a tombstone is gone, whatever changed on another device afterwards
//     (a rename of someone who was just deleted is lost, which is the right way round for a family). It could not be otherwise: if a later change
//     could bring a deleted character back, merging in a different grouping would give a different household, because the dropped row's bests
//     would be lost in one grouping and kept in the other (the property test found exactly that). The time on a tombstone is only for forgetting
//     the oldest ones. A deleted id is never used again: restoring a deleted player from a backup makes a new character.
// Everything that comes from a server goes through cleanMeta first: it is untrusted, like a stored profile.
import { cleanCharacter, cleanDeleted, MAX_CHARACTERS, uniqueName } from '../household.js';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const time = iso => Date.parse(iso);
const ctx = { now: () => new Date(0).toISOString() };   // (cleanMeta does not invent dates: a row with none is not a row)

// JSON with sorted keys: the same value always gives the same text, so that rows can be compared and ordered.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (isObject(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/* ---------- personal bests ---------- */
// The better of two sets of bests, board by board. Unlike records.mergeBests, an exact tie is decided by the race id (the smaller one is named),
// not by which side is "this device": the result must not depend on the order. (Both sets of bests are already clean: cleanBests only lets
// well-formed board names through, so no key here can be `__proto__`.)
const pick = (xv, xr, yv, yr) => {
  if (xv === null || xv === undefined) return [yv ?? null, yv === null || yv === undefined ? null : yr];
  if (yv === null || yv === undefined) return [xv, xr];
  if (xv !== yv) return xv < yv ? [xv, xr] : [yv, yr];
  return [xv, (xr || '') <= (yr || '') ? xr : yr];
};
export function mergeBestsStable(a, b) {
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = has(a, k) ? a[k] : null, y = has(b, k) ? b[k] : null;
    if (!x || !y) { out[k] = { ...(x || y) }; continue; }
    const [time_, timeRace] = pick(x.time, x.timeRace, y.time, y.timeRace), [bestLap, bestLapRace] = pick(x.bestLap, x.bestLapRace, y.bestLap, y.bestLapRace);
    out[k] = { time: time_, timeRace, bestLap, bestLapRace };
  }
  return out;
}

/* ---------- rows ---------- */
export const rowOf = c => { const { races, ...row } = c; return row; };   // eslint-disable-line no-unused-vars
const stable = r => canonical({ ...r, bests: null, createdAt: null });

// Which of two rows for the same character is the later one: by updatedAt, and on an exact tie by the rows' own text (the same on every device).
const later = (x, y) => {
  const a = time(x.updatedAt), b = time(y.updatedAt);
  if (a !== b) return a > b ? x : y;
  return stable(x) <= stable(y) ? x : y;
};
export function mergeRow(x, y) {
  const w = later(x, y);
  return { ...w, createdAt: time(x.createdAt) <= time(y.createdAt) ? x.createdAt : y.createdAt, bests: mergeBestsStable(x.bests, y.bests) };
}

/* ---------- the meta ---------- */
// meta = { characters: [row], deleted: { id: when } }. The characters come out in one fixed order (oldest first, then by id).
export const orderRows = rows => rows.slice().sort((a, b) => time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function mergeMeta(a, b) {
  const deleted = {};
  for (const m of [a, b]) for (const id of Object.keys(m.deleted)) if (!has(deleted, id) || time(m.deleted[id]) > time(deleted[id])) deleted[id] = m.deleted[id];
  const rows = new Map();
  for (const m of [a, b]) for (const r of m.characters) rows.set(r.id, rows.has(r.id) ? mergeRow(rows.get(r.id), r) : r);
  return { characters: orderRows([...rows.values()].filter(r => !has(deleted, r.id))), deleted };
}
export const metaEqual = (a, b) => canonical(a) === canonical(b);

// A meta from a server (or anywhere else outside this device): well-formed, or empty. Rows that are not rows are dropped and the rest kept, and a
// row never carries races (they travel separately).
export function cleanMeta(raw) {
  const out = { characters: [], deleted: {} };
  if (!isObject(raw)) return out;
  out.deleted = cleanDeleted(raw.deleted);
  const seen = new Set();
  for (const r of Array.isArray(raw.characters) ? raw.characters.slice(0, 64) : []) {
    if (!isObject(r) || typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string' || !Number.isFinite(time(r.createdAt)) || !Number.isFinite(time(r.updatedAt))) continue;
    const c = cleanCharacter({ ...r, races: [] }, ctx);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); out.characters.push(rowOf(c));
  }
  out.characters = orderRows(out.characters);
  return out;
}

// The meta of a profile document: its characters' rows and the household's tombstones.
export const metaOf = data => ({ characters: orderRows(data.characters.map(rowOf)), deleted: { ...data.household.deleted } });

// A household holds MAX_CHARACTERS and no two names alike, whatever was merged: the oldest characters stay, and a name that is taken gets a number
// (the same on every device, because the order is). A renamed character counts as changed `now`, so that the new name is the later one everywhere.
// -> { characters: [row], dropped: [id], renamed: [id] }
export function fitHousehold(meta, now) {
  const kept = orderRows(meta.characters).slice(0, MAX_CHARACTERS), dropped = orderRows(meta.characters).slice(MAX_CHARACTERS).map(r => r.id), renamed = [], names = [];
  const characters = kept.map(r => {
    const name = uniqueName(r.name, names); names.push(name);
    if (name === r.name) return r;
    renamed.push(r.id); return { ...r, name, updatedAt: now };
  });
  return { characters, dropped, renamed };
}
