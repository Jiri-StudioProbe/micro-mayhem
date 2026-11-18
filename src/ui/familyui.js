// The family board screen (M3.1c): pick a board (a level, with or without assist), see the household ranked on it by race time or best lap.
// The ranking is src/ui/family.js (pure); this is the DOM. Names came from storage, so everything is set with textContent.
// The buttons that open it (on the start screen and on "Who's playing?") are only there for a household of two or more: a board of one is just
// the personal bests. They are empty, not just hidden, when absent, so a single player's start screen is exactly what it was before.
import { listBoards, defaultBoard, rankBoard } from './family.js';
import { fmtTime } from './format.js';

const DASH = '—', t2 = v => (v === null || v === undefined ? DASH : fmtTime(v, 2));

export function createFamilyUi({ doc, router, Profile, assistOn }) {
  const $ = id => doc.getElementById(id);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  let board = null, by = 'time';

  function refreshButtons() {
    const many = Profile.data.characters.length >= 2;
    for (const b of [$('familyBtn'), $('plFamily')]) { b.hidden = !many; b.textContent = many ? 'FAMILY BOARD' : ''; }
  }

  function render() {
    const house = Profile.data.characters, boards = listBoards(house);
    if (!boards.some(b => b.key === board)) board = defaultBoard(boards, Profile.current(), assistOn());
    $('fmEmpty').hidden = boards.length > 0; $('fmControls').hidden = !boards.length;
    const chips = $('fmBoards'); chips.textContent = '';
    for (const b of boards) {
      const chip = el('button', 'snd inline', b.label); chip.type = 'button'; chip.dataset.board = b.key; chip.setAttribute('aria-pressed', String(b.key === board));
      chip.addEventListener('click', () => { board = b.key; render(); });
      chips.appendChild(chip);
    }
    for (const [id, which] of [['fmSortTime', 'time'], ['fmSortLap', 'lap']]) $(id).setAttribute('aria-pressed', String(by === which));
    $('fmHeadTime').className = 'lab' + (by === 'time' ? ' on' : ''); $('fmHeadLap').className = 'lab' + (by === 'lap' ? ' on' : '');
    const rows = $('fmRows'); rows.textContent = '';
    if (!board) { $('fmNone').hidden = true; return; }
    const { rows: ranked, none } = rankBoard(house, board, by, Profile.current().id);
    for (const r of ranked) {
      const row = el('div', 'frow' + (r.current ? ' me' : '') + (r.rank === 1 ? ' first' : ''));
      row.dataset.id = r.id;
      row.append(el('span', 'fr', r.rank === null ? DASH : String(r.rank)), el('span', 'fn', r.name), el('b', by === 'time' ? 'on' : '', t2(r.time)), el('b', by === 'lap' ? 'on' : '', t2(r.lap)));
      rows.appendChild(row);
    }
    $('fmNone').hidden = !none.length; $('fmNone').textContent = none.length ? 'Not raced here yet: ' + none.join(', ') : '';
  }

  function show() { board = null; render(); router.push('family'); }   // (the board starts on the one the player races on now)

  $('familyBtn').addEventListener('click', show); $('plFamily').addEventListener('click', show);
  $('fmBack').addEventListener('click', () => router.back());
  $('fmSortTime').addEventListener('click', () => { by = 'time'; render(); });
  $('fmSortLap').addEventListener('click', () => { by = 'lap'; render(); });
  router.subscribe(cur => { if (cur === 'menu' || cur === 'players') refreshButtons(); });   // the household may have changed since
  refreshButtons();

  return { show, render, refreshButtons, focusFor: () => $('fmBack') };
}
