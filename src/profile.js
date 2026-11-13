// Persistence. Everything that outlives a page load (settings now; character, cars, best times and aura later) lives in ONE
// versioned JSON document, so it can be migrated, exported and backed up as a unit. Never add ad-hoc localStorage keys.
// The storage is passed in (a localStorage-like object, or null for "no persistence"), so this runs in Node tests.

export const PROFILE_KEY = 'mm:profile';
const VERSION = 1;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fresh = () => ({ version: VERSION, settings: { level: 'veteran', presets: {} } });

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
  // migrations go here, oldest first: if (data.version < 2) { ...; data.version = 2; }
  data.version = VERSION;
  const save = () => { try { storage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch (_) {} };
  return { data, save };
}

// localStorage can throw just by being touched (some private modes, blocked site data); then the game simply does not persist.
export function browserStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}
