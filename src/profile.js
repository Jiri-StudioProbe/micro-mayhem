// Persistence. Everything that outlives a page load (settings, race history and personal bests now; character, cars and aura later) lives in
// ONE versioned JSON document, so it can be migrated, exported and backed up as a unit. Never add ad-hoc localStorage keys.
// The storage is passed in (a localStorage-like object, or null for "no persistence"), so this runs in Node tests.
//
// Versions: 1 = settings only (M0 to M1). 2 = adds `races` (the history, newest last) and `bests` (see src/records.js), and `updatedAt` (set by
// every save; the later cloud sync uses it to decide which copy of the document is newer).
import { cleanRaces, cleanBests, bestsFromRaces, mergeBests } from './records.js';

export const PROFILE_KEY = 'mm:profile';
const VERSION = 2;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fresh = () => ({ version: VERSION, settings: { level: 'veteran', presets: {} }, races: [], bests: {} });

// Copies an object's own fields, except `__proto__`: a stored document is untrusted, and JSON.parse makes `__proto__` an ordinary own field,
// which Object.assign would then use to replace the copy's prototype.
const ownCopy = o => { const out = {}; for (const k of Object.keys(o)) if (k !== '__proto__') out[k] = o[k]; return out; };

// A profile document made well-formed: defaults filled in, damaged parts repaired, the history and bests cleaned (a damaged record is dropped, the
// rest kept) and the bests never worse than what the surviving races show. Returns null if `o` is not a profile at all. Used for the stored document
// and for an imported backup, so both get the same treatment. (Migrations, oldest first: 1 -> 2 needs nothing beyond the defaults filled in here.)
export function cleanProfileDoc(o) {
  if (!isObject(o) || !isObject(o.settings)) return null;
  const data = Object.assign(fresh(), ownCopy(o)); data.settings = Object.assign(fresh().settings, ownCopy(o.settings));
  if (!isObject(data.settings.presets)) data.settings.presets = {};
  if (typeof data.settings.level !== 'string') data.settings.level = 'veteran';
  data.races = cleanRaces(data.races);
  data.bests = mergeBests(cleanBests(data.bests), bestsFromRaces(data.races));
  data.version = Math.max(VERSION, Number.isInteger(data.version) ? data.version : 0);   // a document from a newer game keeps its version
  return data;
}

export function createProfile(storage) {
  let data = cleanProfileDoc(fresh());
  try {
    const loaded = cleanProfileDoc(JSON.parse(storage.getItem(PROFILE_KEY) || 'null'));
    if (loaded) data = loaded;
    ['mm-tune', 'mm-assist'].forEach(k => storage.removeItem(k));   // pre-profile keys, superseded
  } catch (_) {}
  const save = () => { try { data.updatedAt = new Date().toISOString(); storage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch (_) {} };
  // Replaces the whole document (a restored backup), in place so that everything holding `data` sees it. Writes to storage first and says whether
  // that worked: if it did not, nothing changes.
  const replace = next => {
    const doc = cleanProfileDoc(next);
    if (!doc) return false;
    doc.updatedAt = new Date().toISOString();
    try { storage.setItem(PROFILE_KEY, JSON.stringify(doc)); } catch (_) { return false; }
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, doc);
    return true;
  };
  return { data, save, replace };
}

// localStorage can throw just by being touched (some private modes, blocked site data); then the game simply does not persist.
export function browserStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}
