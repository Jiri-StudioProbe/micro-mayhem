// What the history screens say. Pure: records in, words out. (The DOM is src/ui/historyui.js.)
//   describeBoards(bests)         -> [{ board, time, lap }]   your personal bests, one line per board
//   describeRace(rec, fmtDate)    -> { id, kind, win, head, sub, when }   one line of the list
//   describeDetail(rec, fmtDate)  -> { kick, title, rows: [[label, value]], tech }   one race in full
// Every string that came from storage ends up as text (never markup): the caller sets textContent.
import { fmtTime } from './format.js';
import { assistTag } from '../records.js';
import { describeResult } from './results.js';

const DASH = '—', DOT = ' · ';
const t2 = v => (v === null || v === undefined ? DASH : fmtTime(v, 2));

// The local date and time of a race, short: "14 Nov, 15:30". Passed in so that tests do not depend on the machine's time zone.
export function defaultFmtDate(ts) {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : DASH;
}

const ASSIST_WORDS = { assist: 'ASSIST', manual: 'NO ASSIST', mixed: 'ASSIST SWITCHED' };
export const boardName = rec => rec.level.toUpperCase() + DOT + ASSIST_WORDS[assistTag(rec)];

export function describeBoards(bests) {
  return Object.keys(bests).sort().map(key => {
    const [, level, kind] = key.split('/');
    return { board: level.toUpperCase() + DOT + (kind === 'assist' ? 'ASSIST' : 'NO ASSIST'), time: t2(bests[key].time), lap: t2(bests[key].bestLap) };
  });
}

export function describeRace(rec, fmtDate = defaultFmtDate) {
  const r = rec.result, d = describeResult(r);
  const head = r.kind === 'finish' ? d.place + DOT + fmtTime(r.time) : d.head + DOT + fmtTime(r.time);
  // win: first across the line, or the last car running
  return {
    id: rec.id, kind: r.kind, win: (r.kind === 'finish' && r.place === 1) || r.kind === 'last', head,
    sub: boardName(rec) + (r.bestLap === null ? '' : DOT + 'BEST LAP ' + fmtTime(r.bestLap, 2)), when: fmtDate(rec.ts)
  };
}

export function describeDetail(rec, fmtDate = defaultFmtDate) {
  const r = rec.result, d = describeResult(r), tag = assistTag(rec);
  const timeLabel = d.timeLabel.charAt(0) + d.timeLabel.slice(1).toLowerCase();
  return {
    kick: d.kick, title: d.head,
    rows: [
      ['Date', fmtDate(rec.ts)],
      ['Level', rec.level.toUpperCase()],
      ['Driving assist', tag === 'mixed' ? 'switched during the race' : tag === 'assist' ? 'on' : 'off'],
      ['Place', r.kind === 'wrecked' ? DASH : d.place + ' of ' + r.total],
      [timeLabel, fmtTime(r.time, 2)],
      ['Best lap', t2(r.bestLap)],
      ['Laps', r.laps.length ? r.laps.map((l, i) => (i + 1) + ': ' + fmtTime(l, 2)).join('\n') : DASH],
      ['Wrecks', String(r.kills)],
      ['Wall touches', String(r.wallTouches)]
    ],
    tech: 'seed ' + rec.config.seed + DOT + 'rules v' + rec.simVersion + DOT + 'game ' + rec.appVersion + DOT + 'id ' + rec.id.slice(0, 8)
  };
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// What a backup code holds and what restoring it would do, for the Backup screen: { lines: [...], merge, replace }. `p` is previewImport's result and
// `localRaces` how many races this device has now.
export function describePreview(p, fmtDate = defaultFmtDate) {
  const lines = [];
  lines.push(plural(p.races, 'race', 'races') + (p.races ? (p.newRaces ? ', ' + p.newRaces + ' new to this device.' : ', none new to this device.') : '.'));
  lines.push(p.boards ? plural(p.boards, 'board', 'boards') + ' of bests' + (p.betterBests ? ', ' + p.betterBests + ' better than yours' : '') + (p.newBoards ? ', ' + p.newBoards + ' new to this device' : '') + '.' : 'No bests.');
  if (p.savedAt) lines.push('Saved ' + fmtDate(p.savedAt) + '. Level in the code: ' + String(p.level).toUpperCase() + '.');
  if (p.droppedRaces) lines.push(plural(p.droppedRaces, 'damaged record was', 'damaged records were') + ' left out.');
  if (p.newerVersion) lines.push('This code comes from a newer version of the game. What this version does not know is kept, but not shown.');
  return {
    lines,
    merge: 'ADD TO THIS DEVICE keeps your settings and everything you have, and adds what is missing.',
    replace: 'REPLACE EVERYTHING puts the code\'s profile in place of this device\'s: its races, bests and settings.' + (p.localOnly ? ' The ' + plural(p.localOnly, 'race', 'races') + ' here that ' + (p.localOnly === 1 ? 'is' : 'are') + ' not in the code would be lost.' : '')
  };
}
