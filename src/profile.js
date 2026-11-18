// Persistence. Everything that outlives a page load (the household and its characters with their race history and personal bests, the settings of
// this device; cars and aura later) lives in ONE versioned JSON document, so it can be migrated, exported and backed up as a unit. Never add
// ad-hoc localStorage keys. The storage is passed in (a localStorage-like object, or null for "no persistence"), so this runs in Node tests.
//
// Versions: 1 = settings only (M0 to M1). 2 = adds `races` (the history, newest last) and `bests` (see src/records.js), and `updatedAt` (set by
// every save; the later cloud sync uses it to decide which copy of the document is newer). 3 (M3.1) = a household of characters (src/household.js):
//   { version: 3, updatedAt, household: { id, createdAt }, characters: [{ id, name, level, createdAt, updatedAt, races, bests }],
//     settings: { presets, character } }
// The history and the bests moved from the top into each character; the difficulty level moved from the settings into the character (so a child
// can stay on Rookie); `settings` is what belongs to this device (the steering presets, and who played last).
import { cleanRaces, cleanBests, bestsFromRaces, mergeBests } from './records.js';
import { cleanCharacters, cleanHousehold, newCharacter, currentCharacter, setCurrent, mergeCharacter } from './household.js';
import { ownCopy } from './util.js';

export const PROFILE_KEY = 'mm:profile';
const VERSION = 3;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const base = () => ({ version: VERSION, settings: { presets: {} } });

// A profile document made well-formed: defaults filled in, damaged parts repaired, every character's history and bests cleaned (a damaged record is
// dropped, the rest kept) and the bests never worse than what the surviving races show. Returns null if `o` is not a profile at all. Used for the
// stored document and for an imported backup, so both get the same treatment. `ctx` ({ newId, now }) is for tests.
// Migrations, oldest first: 1 -> 2 needs nothing beyond the defaults filled in; 2 -> 3 makes one character of the old history and level (a fresh
// id and the name "Player": the household's first player), and any `races` or `bests` still at the top (a page from before the migration, left
// in a browser's cache, that saved a race after the profile was migrated) are added to the character who is playing.
export function cleanProfileDoc(o, ctx) {
  if (!isObject(o) || !isObject(o.settings)) return null;
  const data = Object.assign(base(), ownCopy(o)); data.settings = Object.assign({ presets: {} }, ownCopy(o.settings));
  data.settings.presets = isObject(o.settings.presets) ? JSON.parse(JSON.stringify(o.settings.presets)) : {};   // (a copy: an imported document is never aliased by the live one)
  const legacyLevel = typeof o.settings.level === 'string' && o.settings.level.length <= 32 ? o.settings.level : 'veteran';
  delete data.settings.level;
  data.household = cleanHousehold(o.household, ctx);
  data.characters = cleanCharacters(o.characters, ctx);
  if (!data.characters.length) data.characters.push(newCharacter({ level: legacyLevel }, ctx));
  if (!data.characters.some(c => c.id === data.settings.character)) data.settings.character = data.characters[0].id;
  const strayRaces = cleanRaces(o.races), strayBests = mergeBests(cleanBests(o.bests), bestsFromRaces(strayRaces));
  if (strayRaces.length || Object.keys(strayBests).length) {
    const at = data.characters.findIndex(c => c.id === data.settings.character), target = data.characters[at];
    const have = new Set(data.characters.flatMap(c => c.races.map(r => r.id)));
    // (An empty history takes the stray races as they are, in the order they were stored, already limited to the latest 500 by cleanRaces; otherwise they are merged in date order.)
    data.characters[at] = target.races.length ? mergeCharacter(target, { races: strayRaces, bests: strayBests }, have)
      : { ...target, races: strayRaces.filter(r => !have.has(r.id)), bests: strayBests };
  }
  delete data.races; delete data.bests;
  data.version = Math.max(VERSION, Number.isInteger(o.version) ? o.version : 0);   // a document from a newer game keeps its version
  return data;
}

export function createProfile(storage, ctx) {
  let data = null;
  try {
    data = cleanProfileDoc(JSON.parse(storage.getItem(PROFILE_KEY) || 'null'), ctx);
    ['mm-tune', 'mm-assist'].forEach(k => storage.removeItem(k));   // pre-profile keys, superseded
  } catch (_) {}
  if (!data) data = cleanProfileDoc(base(), ctx);   // nothing stored, or nothing usable: a new household
  const now = () => (ctx && ctx.now ? ctx.now() : new Date().toISOString());
  const save = () => { try { data.updatedAt = new Date().toISOString(); storage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch (_) {} };
  // Replaces the whole document (a restored backup), in place so that everything holding `data` sees it. Writes to storage first and says whether
  // that worked: if it did not, nothing changes.
  const replace = next => {
    const doc = cleanProfileDoc(next, ctx);
    if (!doc) return false;
    doc.updatedAt = new Date().toISOString();
    delete doc.settings.sync;   // a restore brings races (and a household) the server may not have: the next sync starts from scratch, and finds out
    try { storage.setItem(PROFILE_KEY, JSON.stringify(doc)); } catch (_) { return false; }
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, doc);
    return true;
  };
  return {
    data, save, replace,
    current: () => currentCharacter(data),                 // the character who is playing (always one: a household has at least one)
    setCurrent: id => setCurrent(data, id),                // (changes the data; the caller saves)
    setLevel(name) { const c = currentCharacter(data); if (c.level !== name) { c.level = name; c.updatedAt = now(); } }   // (not touched when unchanged: sync compares updatedAt)
  };
}

// localStorage can throw just by being touched (some private modes, blocked site data); then the game simply does not persist.
export function browserStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}
