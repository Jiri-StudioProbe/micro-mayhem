// Race records and personal bests. Pure logic (no DOM, no storage): the profile stores what this module builds and cleans.
//
// A race record is one finished or wrecked race, written once and never changed:
//   { id, ts, appVersion, simVersion, track, laps, level, config, result }
// `config` and `simVersion` are the RaceConfig the sim played (so the race can be replayed once inputs are recorded); `level` is the shell's
// difficulty level; `result` is what the sim reported: { kind, place, total, time, kills, bestLap, laps: [...], wallTouches, assistChanged }.
//
// Everything that comes back from storage (or, later, from an imported backup code) passes through cleanRecord(), which returns a fresh
// canonical record or null: a damaged record is dropped and the rest of the history is kept.
import { Sim } from './sim/sim.js';

export const MAX_RACES = 500;        // the history keeps this many of the latest races; personal bests are kept for ever
export const TRACK_ID = 'classic';   // the one track so far (M8 adds more)
const KINDS = ['finish', 'last', 'wrecked'];
const MAX_RECORD_BYTES = 16384;      // storage is finite: a record bigger than this is refused (a normal one is about 450 bytes)
const KNOWN = ['id', 'ts', 'appVersion', 'simVersion', 'track', 'laps', 'level', 'config', 'result'];
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;

// A fresh id for a race. Made on the device so that a race uploaded twice later is still one race.
export function newRaceId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

// What kind of assist the race was driven with, for grouping bests: 'assist', 'manual', or 'mixed' (it was toggled during the race).
export const assistTag = rec => (rec.result.assistChanged ? 'mixed' : rec.config.assist ? 'assist' : 'manual');

// The record of a race that has just ended. `header` is Sim.raceHeader(S), `result` is S.result.
export function makeRecord({ id, ts, appVersion, header, level, result }) {
  return {
    id, ts, appVersion, simVersion: header.simVersion, track: TRACK_ID, laps: Sim.LAPS, level, config: header.config,
    result: { kind: result.kind, place: result.place, total: result.total, time: result.time, kills: result.kills, bestLap: result.bestLap,
      laps: result.laps.slice(), wallTouches: result.wallTouches, assistChanged: !!result.assistChanged }
  };
}

function cleanResult(r, laps) {
  if (!isObj(r) || !KINDS.includes(r.kind)) return null;
  if (!isInt(r.total, 1, 12) || !isInt(r.place, 1, r.total) || !isNum(r.time, 0, 7200) || !isInt(r.kills, 0, 100)) return null;
  if (!Array.isArray(r.laps) || r.laps.length > laps || !r.laps.every(l => isNum(l, 0.001, 7200))) return null;
  const best = r.laps.length ? Math.min(...r.laps) : null;
  if (r.bestLap !== best) return null;                                    // the best lap must be one of the laps
  // (A finished race may have fewer than all its laps timed: reversing back over the line voids the lap in progress.)
  if (!isInt(r.wallTouches, 0, 100000) || typeof r.assistChanged !== 'boolean') return null;
  return { kind: r.kind, place: r.place, total: r.total, time: r.time, kills: r.kills, bestLap: r.bestLap, laps: r.laps.slice(), wallTouches: r.wallTouches, assistChanged: r.assistChanged };
}

// A canonical copy of a record, or null if it is not a well-formed race record. Fields this version does not know are kept (a newer version
// of the game may have written them), unless the record is then too big.
export function cleanRecord(raw) {
  if (!isObj(raw)) return null;
  if (!isStr(raw.id, 64) || !isStr(raw.ts, 40) || !Number.isFinite(Date.parse(raw.ts)) || !isStr(raw.appVersion, 32) || !isInt(raw.simVersion, 0, 1e6)) return null;
  if (!isStr(raw.track, 32) || !isInt(raw.laps, 1, 99) || !isStr(raw.level, 32)) return null;
  if (!isObj(raw.config) || raw.config.mode !== 'race' || !Number.isInteger(raw.config.seed) || Sim.configProblems(raw.config).length) return null;
  const result = cleanResult(raw.result, raw.laps);
  if (!result) return null;
  const rec = {};
  for (const k of Object.keys(raw)) if (!KNOWN.includes(k) && k !== '__proto__') rec[k] = raw[k];
  Object.assign(rec, { id: raw.id, ts: raw.ts, appVersion: raw.appVersion, simVersion: raw.simVersion, track: raw.track, laps: raw.laps, level: raw.level,
    config: { mode: 'race', seed: raw.config.seed, assist: raw.config.assist, tune: { assistLane: raw.config.tune.assistLane, assistSpeed: raw.config.tune.assistSpeed } }, result });
  let size; try { size = JSON.stringify(rec).length; } catch (_) { return null; }
  return size <= MAX_RECORD_BYTES ? rec : null;
}

// The history from stored data: valid records only, once each (the first with an id wins), the latest MAX_RACES, in the order stored.
export function cleanRaces(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const r of raw) { const c = cleanRecord(r); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  return out.slice(-MAX_RACES);
}

/* ---------- personal bests ---------- */
// bests[key] = { time, timeRace, bestLap, bestLapRace }, key = track/level/assistTag. Races with 'mixed' assist count for no best.
const KEY_RE = /^[A-Za-z0-9_-]{1,32}\/[A-Za-z0-9_-]{1,32}\/(assist|manual)$/;
export const bestKey = rec => { const t = assistTag(rec); return t === 'mixed' ? null : rec.track + '/' + rec.level + '/' + t; };
const cleanBest = b => {
  if (!isObj(b)) return null;
  const time = b.time === null || b.time === undefined ? null : isNum(b.time, 0.001, 7200) ? b.time : undefined;
  const lap = b.bestLap === null || b.bestLap === undefined ? null : isNum(b.bestLap, 0.001, 7200) ? b.bestLap : undefined;
  if (time === undefined || lap === undefined || (time === null && lap === null)) return null;
  const id = v => (isStr(v, 64) ? v : null);
  return { time, timeRace: time === null ? null : id(b.timeRace), bestLap: lap, bestLapRace: lap === null ? null : id(b.bestLapRace) };
};
export function cleanBests(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw).slice(0, 200)) { if (!KEY_RE.test(k)) continue; const b = cleanBest(raw[k]); if (b) out[k] = b; }
  return out;
}
// Folds one race into the bests (mutates them). Returns what the results screen needs: whether this race set a new best time or best lap, the
// bests as they were before (`previous`, null if there was none for this track, level and assist setting) and as they are now (`best`).
export function updateBests(bests, rec) {
  const key = bestKey(rec);
  if (key === null) return { key: null, newBestTime: false, newBestLap: false, previous: null, best: null };
  const cur = has(bests, key) ? bests[key] : null;
  const previous = cur ? { time: cur.time, bestLap: cur.bestLap } : null;
  const next = cur ? { ...cur } : { time: null, timeRace: null, bestLap: null, bestLapRace: null };
  let newBestTime = false, newBestLap = false;
  if (rec.result.kind === 'finish' && (next.time === null || rec.result.time < next.time)) { next.time = rec.result.time; next.timeRace = rec.id; newBestTime = true; }
  if (rec.result.bestLap !== null && (next.bestLap === null || rec.result.bestLap < next.bestLap)) { next.bestLap = rec.result.bestLap; next.bestLapRace = rec.id; newBestLap = true; }
  if (newBestTime || newBestLap || !cur) { if (next.time !== null || next.bestLap !== null) bests[key] = next; }
  const now = has(bests, key) ? bests[key] : null;
  return { key, newBestTime, newBestLap, previous, best: now ? { time: now.time, bestLap: now.bestLap } : null };
}
export function bestsFromRaces(races) { const b = {}; for (const r of races) updateBests(b, r); return b; }
// The better of two sets of bests, key by key.
export function mergeBests(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (!has(out, k)) { out[k] = { ...b[k] }; continue; }
    const x = out[k], y = b[k], m = { ...x };
    if (y.time !== null && (x.time === null || y.time < x.time)) { m.time = y.time; m.timeRace = y.timeRace; }
    if (y.bestLap !== null && (x.bestLap === null || y.bestLap < x.bestLap)) { m.bestLap = y.bestLap; m.bestLapRace = y.bestLapRace; }
    out[k] = m;
  }
  return out;
}

/* ---------- the history in a profile ---------- */
// Adds a race to a profile's data (mutates data.races and data.bests). A race with an id already in the history is not added twice.
export function addRace(data, rec) {
  if (data.races.some(r => r.id === rec.id)) return { duplicate: true, key: null, newBestTime: false, newBestLap: false, previous: null, best: null };
  data.races.push(rec);
  if (data.races.length > MAX_RACES) data.races.splice(0, data.races.length - MAX_RACES);
  return { duplicate: false, ...updateBests(data.bests, rec) };
}

// Saves each race that ends. `Profile` is src/profile.js's; `getLevel()` the current difficulty level; `appVersion` the game's version.
export function createRecorder({ Profile, appVersion, getLevel, now = () => new Date(), newId = newRaceId }) {
  return {
    // Records the race that has just ended in S (S.result is set). Only real races count: the lab and the demo behind the menu are not saved.
    // Returns { record, ...info about new bests } or null.
    recordRace(S) {
      if (!S.result || !S.config || S.config.mode !== 'race') return null;
      const made = cleanRecord(makeRecord({ id: newId(), ts: now().toISOString(), appVersion, header: Sim.raceHeader(S), level: getLevel(), result: S.result }));
      if (!made) throw new Error('the record of a finished race was not valid');   // a bug, not a player's doing: the caller logs it; the history is untouched
      const info = addRace(Profile.data, made);
      Profile.save();
      return { record: made, ...info };
    }
  };
}
