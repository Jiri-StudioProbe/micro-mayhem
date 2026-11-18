// Households and characters (M3.1). Pure logic: no DOM, no storage. The profile stores what this module builds and cleans.
//
// A HOUSEHOLD is the account: a random id and the characters in it. A CHARACTER is one player of the family:
//   { id, name, level, createdAt, updatedAt, races, bests }
// `races` and `bests` are exactly what a version 2 profile held at its top level (src/records.js works on either), so a character is a
// small profile of its own: the history is per character (the latest MAX_RACES each) and so are the personal bests.
// The family leaderboard is derived from the characters' bests; the device remembers who played last (`settings.character`).
//
// Everything that comes back from storage or from a backup code passes through cleanCharacters() and cleanHousehold(): a damaged character is
// dropped, a damaged field repaired, and the rest kept. A name is the one free text in the whole profile, so it is cleaned hard (see cleanName).
import { cleanRaces, cleanBests, bestsFromRaces, mergeBests, MAX_RACES } from './records.js';
import { newId, ownCopy } from './util.js';

export const MAX_CHARACTERS = 8;    // a household holds this many (8 full histories are about 1.4 MB of the 5 MB localStorage allows)
export const NAME_MAX = 16;         // characters (code points) in a name
export const DEFAULT_NAME = 'Player';
export const MAX_TOMBSTONES = 200;   // how many deleted players the household remembers (to tell other devices); the oldest are forgotten first
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isoOk = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const ctxOf = c => ({ newId: (c && c.newId) || newId, now: (c && c.now) || (() => new Date().toISOString()) });
const ts = r => { const t = Date.parse(r.ts); return Number.isFinite(t) ? t : 0; };

/* ---------- names ---------- */
// A name made safe to show: control characters, zero-width and direction-changing characters (which could make one name look like another)
// and lone surrogates are removed, runs of white space become one space, it is trimmed and cut to NAME_MAX characters. Null if nothing is left.
// (It is still only ever shown with textContent: this limits what a name can look like, it does not make it markup-safe.)
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\p{Cf}\p{Cs}\p{Co}]/gu, '').replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ');
  return [...s].slice(0, NAME_MAX).join('').trim() || null;
}
const nameKey = n => n.toLowerCase();
// `name`, or with " 2", " 3" ... added until it differs (ignoring case) from every name in `taken`.
export function uniqueName(name, taken) {
  const used = new Set(taken.map(nameKey));
  if (!used.has(nameKey(name))) return name;
  for (let i = 2; ; i++) {
    const suffix = ' ' + i, cand = [...name].slice(0, NAME_MAX - suffix.length).join('').trimEnd() + suffix;
    if (!used.has(nameKey(cand))) return cand;
  }
}

/* ---------- cleaning ---------- */
export function newCharacter({ name = DEFAULT_NAME, level = 'veteran' } = {}, ctx) {
  const c = ctxOf(ctx), t = c.now();
  return { id: c.newId(), name, level, createdAt: t, updatedAt: t, races: [], bests: {} };
}

// A canonical copy of a stored character, or null. Fields this version does not know are kept (a newer version may have written them).
export function cleanCharacter(raw, ctx) {
  if (!isObject(raw) || !isStr(raw.id, 64)) return null;
  const c = ownCopy(raw);
  c.id = raw.id; c.name = cleanName(raw.name) || DEFAULT_NAME;
  c.level = isStr(raw.level, 32) ? raw.level : 'veteran';   // (whether it is a level this game knows is the settings' business)
  c.createdAt = isoOk(raw.createdAt) ? raw.createdAt : ctx.now();
  c.updatedAt = isoOk(raw.updatedAt) ? raw.updatedAt : c.createdAt;
  c.races = cleanRaces(raw.races);
  c.bests = mergeBests(cleanBests(raw.bests), bestsFromRaces(c.races));
  return c;
}
// The characters of a household from stored data: valid ones only, once each, at most MAX_CHARACTERS, with names that differ, and no race
// in two characters (a race id is unique in the household: the cloud will rely on it).
export function cleanCharacters(raw, ctx) {
  const out = [], ids = new Set(), raceIds = new Set(), c = ctxOf(ctx);
  if (!Array.isArray(raw)) return out;
  for (const r of raw.slice(0, 64)) {
    if (out.length >= MAX_CHARACTERS) break;
    const ch = cleanCharacter(r, c);
    if (!ch || ids.has(ch.id)) continue;
    ids.add(ch.id);
    ch.races = ch.races.filter(x => !raceIds.has(x.id)); for (const x of ch.races) raceIds.add(x.id);
    ch.name = uniqueName(ch.name, out.map(o => o.name));
    out.push(ch);
  }
  return out;
}
// The players that were deleted: { id: when }, so that a device that has not heard of it yet can be told (the sync, M3.2). **A deleted id is gone for
// good** (see src/net/merge.js: deleting always wins); the time is only so that the oldest can be forgotten. At most MAX_TOMBSTONES, newest kept.
export function cleanDeleted(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  const entries = Object.keys(raw).filter(k => k !== '__proto__' && isStr(k, 64) && isoOk(raw[k])).sort((a, b) => Date.parse(raw[b]) - Date.parse(raw[a]) || (a < b ? -1 : 1));
  for (const k of entries.slice(0, MAX_TOMBSTONES)) out[k] = raw[k];
  return out;
}
export function cleanHousehold(raw, ctx) {
  const c = ctxOf(ctx), h = isObject(raw) ? ownCopy(raw) : {};
  h.id = isObject(raw) && isStr(raw.id, 64) ? raw.id : c.newId();
  h.createdAt = isObject(raw) && isoOk(raw.createdAt) ? raw.createdAt : c.now();
  h.deleted = cleanDeleted(isObject(raw) ? raw.deleted : null);
  return h;
}

/* ---------- the household in a profile (these change `data`; the caller saves) ---------- */
// Who is playing on this device: the one remembered in the settings, or the first.
export const currentCharacter = data => data.characters.find(c => c.id === data.settings.character) || data.characters[0];
export function setCurrent(data, id) {
  if (!data.characters.some(c => c.id === id)) return false;
  data.settings.character = id; return true;
}
const taken = (data, name, exceptId) => data.characters.some(c => c.id !== exceptId && nameKey(c.name) === nameKey(name));

// -> { ok: true, character } or { ok: false, error: 'name' (nothing usable) | 'taken' | 'full' }
export function addCharacter(data, name, { level = 'veteran', ...ctx } = {}) {
  const nm = cleanName(name);
  if (!nm) return { ok: false, error: 'name' };
  if (data.characters.length >= MAX_CHARACTERS) return { ok: false, error: 'full' };
  if (taken(data, nm)) return { ok: false, error: 'taken' };
  const character = newCharacter({ name: nm, level: isStr(level, 32) ? level : 'veteran' }, ctx);
  data.characters.push(character);
  return { ok: true, character };
}
// -> { ok: true } or { ok: false, error: 'unknown' | 'name' | 'taken' }. Capital letters may change (anna -> Anna); another character's name may not be used.
export function renameCharacter(data, id, name, ctx) {
  const ch = data.characters.find(c => c.id === id), nm = cleanName(name);
  if (!ch) return { ok: false, error: 'unknown' };
  if (!nm) return { ok: false, error: 'name' };
  if (taken(data, nm, id)) return { ok: false, error: 'taken' };
  if (ch.name !== nm) { ch.name = nm; ch.updatedAt = ctxOf(ctx).now(); }
  return { ok: true };
}
// A character nobody has used: the one a new device makes for itself (the default name, no races, never renamed or changed). A restore adds the
// code's characters in its place, instead of leaving you playing an empty Player beside your real ones.
export const isPristine = c => c.name === DEFAULT_NAME && c.races.length === 0 && Object.keys(c.bests).length === 0 && c.createdAt === c.updatedAt;

// The last character cannot be removed: a household always has someone to play as. Its races go with it, and a tombstone is left so that the
// other devices of the household can be told.
export function removeCharacter(data, id, ctx) {
  const i = data.characters.findIndex(c => c.id === id);
  if (i < 0) return { ok: false, error: 'unknown' };
  if (data.characters.length === 1) return { ok: false, error: 'last' };
  data.characters.splice(i, 1);
  data.household.deleted = cleanDeleted({ ...data.household.deleted, [id]: ctxOf(ctx).now() });
  if (data.settings.character === id) data.settings.character = data.characters[0].id;
  return { ok: true };
}

// `local` with what `imported` (the same character, from a backup) has added: the races this one lacks (by id, in date order, the latest MAX_RACES)
// and the better of each best. Name, level and the rest stay as they are here. `have` is the ids of every race in the household (a race that is
// already in another character is not added a second time). Neither argument is changed.
export function mergeCharacter(local, imported, have = new Set(local.races.map(r => r.id))) {
  const add = imported.races.filter(r => !have.has(r.id));
  const races = [...local.races, ...add].map((r, i) => [r, i]).sort((a, b) => ts(a[0]) - ts(b[0]) || a[1] - b[1]).map(x => x[0]).slice(-MAX_RACES);
  return { ...local, races, bests: mergeBests(local.bests, imported.bests) };
}
