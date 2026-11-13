// What the results screen says about records. Pure: it turns what recording a race returned (src/records.js) into the words and numbers to show.
//   describeBests(info) -> null (nothing to show: the lab, or a race that could not be recorded)
//                       or { note, rows: [{ label, race, best, tag }] }
// race / best are display strings ("1:23.41", or an em dash when there is none); tag is null, { text: 'NEW BEST', kind: 'new' }, or
// { text: '+0.82 s', kind: 'slower' } (how much slower than your best), { text: 'TIED BEST', kind: 'tied' }.
import { fmtTime } from './format.js';
import { assistTag } from '../records.js';

const DASH = '—';
const t2 = v => (v === null || v === undefined ? DASH : fmtTime(v, 2));

function tagFor(race, best, isNew) {
  if (race === null) return null;
  if (isNew) return { text: 'NEW BEST', kind: 'new' };
  if (best === null) return null;
  const d = race - best;
  return d > 0 ? { text: '+' + d.toFixed(2) + ' s', kind: 'slower' } : { text: 'TIED BEST', kind: 'tied' };
}

export function describeBests(info) {
  if (!info || !info.record) return null;
  const rec = info.record, r = rec.result, tag = assistTag(rec);
  if (tag === 'mixed') return { note: 'ASSIST WAS SWITCHED DURING THIS RACE, SO IT SETS NO RECORD', rows: [] };
  const board = rec.level.toUpperCase() + ' · ' + (tag === 'assist' ? 'ASSIST' : 'NO ASSIST');
  const best = info.best || { time: null, bestLap: null };
  const raceTime = r.kind === 'finish' ? r.time : null;
  if (raceTime === null && r.bestLap === null && best.time === null && best.bestLap === null) return { note: board + ' · FINISH A LAP TO SET YOUR FIRST BEST', rows: [] };
  return {
    note: board,
    rows: [
      { label: 'Race time', race: t2(raceTime), best: t2(best.time), tag: tagFor(raceTime, best.time, info.newBestTime) },
      { label: 'Best lap', race: t2(r.bestLap), best: t2(best.bestLap), tag: tagFor(r.bestLap, best.bestLap, info.newBestLap) }
    ]
  };
}
