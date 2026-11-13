// The HUD (position, lap, hull, weapon, countdown), toasts, and the screen changes between menu, race and results.
// It reads the simulation and writes only to the DOM, and only when a value changed. The steering lab's own readout is in lab.js.
// Moved verbatim out of src/main.js in M0.7.
import { ord, fmtTime } from './format.js';
import { describeBests } from './results.js';
import { clamp } from '../util.js';

export function createHud({ S, doc, N, LAPS, WEAP, ranking, stickRelease }) {
  const $ = id => doc.getElementById(id);
  const hud = $('hud'), menu = $('menu'), endEl = $('end'), toasts = $('toasts'), cdEl = $('cd');
  const posEl = $('pos'), lapEl = $('lap'), hpEl = $('hp'), hpn = $('hpn'), wname = $('wname'), wammo = $('wammo'), wpn = $('wpn');
  const padEl = $('pad');
  const overlayOpen = () => !menu.hidden || !endEl.hidden;
  const visible = () => !hud.hidden;
  function toast(text, cls) {
    while (toasts.children.length > 3) toasts.firstChild.remove();
    const d = doc.createElement('div'); d.className = 'toast' + (cls ? ' ' + cls : ''); d.textContent = text;
    d.addEventListener('animationend', () => d.remove()); toasts.appendChild(d);
  }
  // The three screens: a race (HUD and touch controls shown), the start menu, and the results.
  function showRace() { menu.hidden = true; endEl.hidden = true; hud.hidden = false; padEl.classList.add('live'); toasts.textContent = ''; }
  function showMenu() { hud.hidden = true; padEl.classList.remove('live'); endEl.hidden = true; menu.hidden = false; }
  // `info` is what recording the race returned (game.lastRace()): it says which records this race broke.
  function showEnd(info) {
    const r = S.result; if (!r) return;
    let kick, head;
    if (r.kind === 'finish') { kick = 'CHEQUERED FLAG'; head = r.place === 1 ? 'YOU WIN' : r.place <= 3 ? 'PODIUM' : 'CROSSED THE LINE'; }
    else if (r.kind === 'last') { kick = 'NOBODY LEFT TO RACE'; head = 'LAST CAR STANDING'; }
    else { kick = 'HULL AT ZERO'; head = 'WRECKED'; }
    $('endKick').textContent = kick; $('endHead').textContent = head;
    $('stPlace').textContent = r.kind === 'wrecked' ? '—' : ord(r.place);
    $('stKills').textContent = r.kills; $('stTime').textContent = fmtTime(r.time);
    $('stTimeLab').textContent = r.kind === 'finish' ? 'RACE TIME' : 'SURVIVED';
    showBests(describeBests(info));
    hud.hidden = true; padEl.classList.remove('live'); stickRelease(); endEl.hidden = false; $('again').focus({ preventScroll: true });
  }
  function showBests(d) {
    const box = $('bests');
    box.hidden = !d;
    if (!d) return;
    $('bsNote').textContent = d.note;
    const rows = [['bsTime', d.rows[0]], ['bsLap', d.rows[1]]];
    for (const [id, row] of rows) {
      const rowEl = $(id + 'Race').parentElement, tagEl = $(id + 'Tag');
      rowEl.hidden = !row;
      if (!row) continue;
      $(id + 'Race').textContent = row.race; $(id + 'Best').textContent = row.best;
      tagEl.textContent = row.tag ? row.tag.text : ''; tagEl.className = 'tag' + (row.tag ? ' ' + row.tag.kind : '');
    }
    $('bests').querySelector('.bhead').hidden = !d.rows.length;
  }
  let lastPos = -1, lastLap = '', lastHp = -1, lastW = '', lastCdText = '';
  function update() {
    const P = S.player, rank = ranking(S), pos = rank.indexOf(P) + 1;
    if (pos !== lastPos) { lastPos = pos; posEl.innerHTML = pos + '<sup>' + ord(pos).slice(String(pos).length) + '</sup>'; }
    const lap = clamp(Math.floor(P.prog / N) + 1, 1, LAPS) + '/' + LAPS;
    if (lap !== lastLap) { lastLap = lap; lapEl.textContent = lap; }
    const hp = Math.max(0, Math.round(P.hp));
    if (hp !== lastHp) {
      lastHp = hp; hpEl.style.width = hp + '%'; hpn.textContent = hp;
      hpEl.style.background = hp > 55 ? 'var(--cool)' : hp > 28 ? 'var(--gold)' : 'var(--hot)';
    }
    const w = P.weapon ? WEAP[P.weapon].name + '|' + P.ammo : 'none';
    if (w !== lastW) {
      lastW = w;
      if (P.weapon) { wname.textContent = WEAP[P.weapon].name; wammo.textContent = '×' + P.ammo; wpn.classList.add('armed'); }
      else { wname.textContent = 'NO WEAPON'; wammo.textContent = ''; wpn.classList.remove('armed'); }
      padEl.classList.toggle('armed', !!P.weapon);
    }
    let cd = '';
    if (S.state === 'countdown') cd = String(Math.max(1, Math.ceil(S.cd - 0.4)));
    else if (S.state === 'race' && S.raceT < 0.9) cd = 'GO!';
    if (cd !== lastCdText) { lastCdText = cd; cdEl.textContent = cd; cdEl.classList.toggle('go', cd === 'GO!'); cdEl.hidden = !cd; }
  }
  return { overlayOpen, visible, toast, showRace, showMenu, showEnd, update };
}
