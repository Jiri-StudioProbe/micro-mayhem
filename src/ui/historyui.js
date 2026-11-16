// The records screens: the list of your races with your bests above it, and one race in full. The words come from history.js; this builds the
// DOM, and only ever with textContent: a record's strings (a level name, a version, an id) came from storage and are never markup.
// The list shows the newest 40 races and 40 more at a time (500 rows at once would be slow to build for a screen you read the top of).
import { describeBoards, describeRace, describeDetail, defaultFmtDate } from './history.js';

export function createHistoryUi({ doc, router, Profile, fmtDate = defaultFmtDate, pageSize = 40 }) {
  const $ = id => doc.getElementById(id);
  const listEl = $('histList'), moreBtn = $('histMore'), histEl = $('history');
  let races = [], shown = 0, openedRow = null, savedScroll = 0;

  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function addRows() {
    const next = races.slice(shown, shown + pageSize);
    for (const rec of next) {
      const d = describeRace(rec, fmtDate);
      const row = el('button', 'hrow' + (d.win ? ' win' : '') + (d.kind === 'wrecked' ? ' wrecked' : ''));
      row.type = 'button'; row.dataset.id = d.id;
      row.append(el('span', 'hh', d.head), el('span', 'hw', d.when), el('span', 'hs', d.sub));
      row.addEventListener('click', () => open(rec, row));
      listEl.appendChild(row);
    }
    shown += next.length;
    moreBtn.hidden = shown >= races.length;
  }

  // Fills the screen from the profile as it is now (a race may have been added since it was last opened).
  function render() {
    const who = Profile.current(); races = who.races.slice().reverse();   // newest first, the playing character's
    shown = 0; openedRow = null; listEl.textContent = '';
    const boards = describeBoards(who.bests), rows = $('histBoardRows');
    rows.textContent = '';
    for (const b of boards) { const r = el('div', 'hboard'); r.append(el('span', 'lab', b.board), el('b', null, b.time), el('b', null, b.lap)); rows.appendChild(r); }
    $('histBoards').hidden = !boards.length;
    $('histEmpty').hidden = races.length > 0;
    addRows();
  }

  function open(rec, row) {
    const d = describeDetail(rec, fmtDate);
    $('detKick').textContent = d.kick; $('detTitle').textContent = d.title; $('detTech').textContent = d.tech;
    const dl = $('detRows'); dl.textContent = '';
    for (const [k, v] of d.rows) dl.append(el('dt', null, k), el('dd', null, v));
    openedRow = row || null; savedScroll = histEl.scrollTop;
    router.push('detail');
  }

  function show() { render(); router.push('history'); }

  $('recordsBtn').addEventListener('click', show); $('endRecords').addEventListener('click', show);   // from the start screen and from the results
  $('histBack').addEventListener('click', () => router.back());
  $('detBack').addEventListener('click', () => router.back());
  moreBtn.addEventListener('click', addRows);
  // Coming back from a race's details: the list is where it was, with the focus on the race that was opened.
  router.subscribe((cur, meta) => { if (cur === 'history' && !meta.fresh) histEl.scrollTop = savedScroll; });

  return { render, show, open,
    // where the focus goes when a screen is shown: BACK, or (returning to the list) the race that was opened
    focusFor: (screen, fresh) => (screen === 'history' && !fresh && openedRow && openedRow.isConnected ? openedRow : $(screen === 'history' ? 'histBack' : 'detBack')) };
}
