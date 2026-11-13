// Real races for the record tests: played by the autopilot in the real sim, so that records have the shapes the game produces.
import { Sim } from './sim.js';
import { makeRecord } from '../../src/records.js';

const cache = new Map();
// A finished (or, with kind 'wrecked' / 'last', such an) autopilot race: { S, header, result }. Cached: the same seed is the same race.
export function realRace(kind = 'finish', assist = false) {
  const key = kind + assist;
  if (cache.has(key)) return cache.get(key);
  if (kind === 'last') {   // the autopilot never wins by outlasting everyone, so this one is made: every rival is wrecked and gone, a few seconds in
    const S = Sim.create(1); Sim.reset(S, { mode: 'race', seed: 7, assist }); S.player.auto = true;
    for (let k = 0; k < 60 * 8; k++) { Sim.step(S, 1 / 60); S.events.length = 0; }
    for (const c of S.cars) if (c !== S.player) { c.alive = false; c.wreck = 0; }
    for (let k = 0; k < 5 && S.state !== 'over'; k++) { Sim.step(S, 1 / 60); S.events.length = 0; }
    const r = { S, header: Sim.raceHeader(S), result: JSON.parse(JSON.stringify(S.result)) }; cache.set(key, r); return r;
  }
  for (let seed = 1; seed < 400; seed++) {
    const S = Sim.create(1); Sim.reset(S, { mode: 'race', seed, assist }); S.player.auto = true;
    for (let k = 0; k < 60 * 240 && S.state !== 'over'; k++) { Sim.step(S, 1 / 60); S.events.length = 0; }
    if (S.result.kind === kind) { const r = { S, header: Sim.raceHeader(S), result: JSON.parse(JSON.stringify(S.result)) }; cache.set(key, r); return r; }
  }
  throw new Error('no ' + kind + ' race found');
}

let n = 0;
// A valid record from a real race. `over` replaces top-level fields (id, level, ts ...); `overResult` replaces fields of the result.
export function goodRecord({ kind = 'finish', assist = false, over = {}, overResult = {} } = {}) {
  const { header, result } = realRace(kind, assist);
  const rec = makeRecord({ id: 'race-' + (++n), ts: '2026-11-13T12:00:00.000Z', appVersion: '1.4.0', header: JSON.parse(JSON.stringify(header)), level: 'veteran', result });
  Object.assign(rec.result, overResult);
  return Object.assign(rec, over);
}

// A finished record with the given time and laps (for the bests tests), deterministic and independent of the sim.
export function finishRecord(id, time, laps, { level = 'veteran', assist = false, changed = false } = {}) {
  const base = goodRecord({ kind: 'finish', assist });
  return Object.assign(base, { id, level }, { result: Object.assign(base.result, { time, laps, bestLap: Math.min(...laps), assistChanged: changed }) });
}
