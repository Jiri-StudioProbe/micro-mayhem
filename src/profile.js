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

export function createProfile(storage) {
  let data = fresh();
  try {
    const o = JSON.parse(storage.getItem(PROFILE_KEY) || 'null');
    if (isObject(o) && isObject(o.settings)) {
      data = Object.assign(fresh(), o); data.settings = Object.assign(fresh().settings, o.settings);
      if (!isObject(data.settings.presets)) data.settings.presets = {};
      if (typeof data.settings.level !== 'string') data.settings.level = 'veteran';
    }
    ['mm-tune', 'mm-assist'].forEach(k => storage.removeItem(k));   // pre-profile keys, superseded
  } catch (_) {}
  // Migrations, oldest first. 1 -> 2 needs no data change beyond the defaults filled in above; the history and bests of any stored document are
  // cleaned here (a damaged record is dropped, the rest kept), and the bests are never worse than what the surviving races show.
  data.races = cleanRaces(data.races);
  data.bests = mergeBests(cleanBests(data.bests), bestsFromRaces(data.races));
  data.version = Math.max(VERSION, Number.isInteger(data.version) ? data.version : 0);   // a document from a newer game keeps its version
  const save = () => { try { data.updatedAt = new Date().toISOString(); storage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch (_) {} };
  return { data, save };
}

// localStorage can throw just by being touched (some private modes, blocked site data); then the game simply does not persist.
export function browserStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}
