// Version 3 profile documents for the tests: a household of characters with fixed ids and dates, so that results can be compared exactly.
import { cleanProfileDoc } from '../../src/profile.js';
import { bestsFromRaces } from '../../src/records.js';

export const T0 = '2026-11-14T10:00:00.000Z';
// A deterministic id source and clock for createProfile / cleanProfileDoc.
export const ctx = () => { let n = 0; return { newId: () => 'gen-' + (++n), now: () => T0 }; };
// A character as the profile stores it (its bests are those its races show).
export const character = (id, name, races = [], extra = {}) => ({ id, name, level: 'veteran', createdAt: T0, updatedAt: T0, races, bests: bestsFromRaces(races), ...extra });
// A cleaned version 3 profile document. `settings` is merged over { presets: {}, character: <first character> }.
export const profileDoc = (characters, { settings = {}, ...extra } = {}) =>
  cleanProfileDoc({ version: 3, household: { id: 'house-1', createdAt: T0 }, characters, settings: { presets: {}, character: characters[0].id, ...settings }, updatedAt: T0, ...extra }, ctx());
