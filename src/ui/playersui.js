// The players screens (M3.1b): "Who's playing?" (the household's characters; tap one to play as them), and the screen for one player (a new one,
// or renaming and deleting an existing one). The words are in players.js, the rules in src/household.js; this is the DOM and the order of things.
// Names are the one free text in the profile: only ever set with textContent / value, never as markup.
// Changing who plays changes the level (it is the character's), so the level and assist buttons are refreshed through settingsUi.reload().
import { addCharacter, renameCharacter, removeCharacter, NAME_MAX, MAX_CHARACTERS } from '../household.js';
import { describeWho, describePlayers, describePlayer, describeError } from './players.js';

export function createPlayersUi({ doc, router, Profile, settingsUi, disarmMs = 6000 }) {
  const $ = id => doc.getElementById(id);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  let editing = null, armed = 0, armTimer = 0;   // editing: the id of the player on the one-player screen, or null for a new one
  const name = $('pdName'), status = $('pdStatus'), del = $('pdDelete');
  name.maxLength = NAME_MAX;

  const refreshWho = () => { $('whoBtn').textContent = describeWho(Profile.current()); };
  // Someone else plays now (or the same one, renamed): everything that shows who or their level follows.
  function changed({ level = false } = {}) { Profile.save(); refreshWho(); if (level) settingsUi.reload(); }

  function renderList() {
    const list = $('plList'); list.textContent = '';
    const rows = describePlayers(Profile.data.characters, Profile.current().id);
    for (const r of rows) {
      const row = el('div', 'prow'), pick = el('button', 'pick' + (r.current ? ' win' : ''));
      pick.type = 'button'; pick.dataset.id = r.id; pick.setAttribute('aria-pressed', String(r.current));
      pick.append(el('span', 'hh', r.name), el('span', 'hw', r.current ? 'PLAYING' : 'PLAY'), el('span', 'hs', r.sub));
      pick.addEventListener('click', () => choose(r.id));
      const edit = el('button', 'snd inline', 'EDIT'); edit.type = 'button'; edit.dataset.id = r.id; edit.setAttribute('aria-label', 'Edit ' + r.name);
      edit.addEventListener('click', () => openPlayer(r.id));
      row.append(pick, edit); list.appendChild(row);
    }
    const full = rows.length >= MAX_CHARACTERS;
    $('plNew').disabled = full; $('plNote').textContent = full ? describeError('full') : '';
  }
  function showList() { renderList(); router.push('players'); }

  // Play as this one: remember them, take up their level, and go to the start screen.
  function choose(id) { if (Profile.setCurrent(id)) changed({ level: true }); router.go('menu'); }

  function disarm() { armed = 0; clearTimeout(armTimer); del.textContent = 'DELETE PLAYER'; }
  const say = (text, kind) => { status.textContent = text; status.className = 'bktext' + (kind ? ' ' + kind : ''); };
  function openPlayer(id) {
    editing = id; disarm(); say('');
    const c = id ? Profile.data.characters.find(x => x.id === id) : null;
    if (id && !c) { renderList(); return; }
    const d = describePlayer(c, Profile.data.characters.length);
    $('pdKick').textContent = d.kick; $('pdTitle').textContent = d.title; $('pdSave').textContent = d.save; $('pdNote').textContent = d.note;
    name.value = c ? c.name : ''; del.hidden = !c; del.disabled = !d.canDelete;
    router.push('player');
  }

  function save() {
    const v = name.value;
    if (editing) {
      const r = renameCharacter(Profile.data, editing, v);
      if (!r.ok) { say(describeError(r.error), 'err'); return; }
      changed(); renderList(); router.back();
    } else {
      const r = addCharacter(Profile.data, v);
      if (!r.ok) { say(describeError(r.error), 'err'); return; }
      Profile.setCurrent(r.character.id); changed({ level: true }); router.go('menu');   // the new player is who you want to play as
    }
  }

  // DELETE asks twice: the first tap arms it (and says so), the second, within a few seconds, does it.
  function remove() {
    if (!editing) return;
    if (!armed) { armed = 1; del.textContent = 'TAP AGAIN TO DELETE'; say('Tap again to delete this player.', 'err'); armTimer = setTimeout(disarm, disarmMs); return; }
    const wasCurrent = Profile.current().id === editing, r = removeCharacter(Profile.data, editing);
    disarm();
    if (!r.ok) { say(describeError(r.error), 'err'); return; }
    changed({ level: wasCurrent }); renderList(); router.back();
  }

  $('whoBtn').addEventListener('click', showList);
  $('plBack').addEventListener('click', () => router.back());
  $('plNew').addEventListener('click', () => openPlayer(null));
  $('pdBack').addEventListener('click', () => router.back());
  $('pdSave').addEventListener('click', save); del.addEventListener('click', remove);
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  name.addEventListener('input', () => say(''));
  refreshWho();

  return { refreshWho, renderList, show: showList,
    // where the focus goes when a screen is shown: the player who is on, BACK, or (a new player) the name box
    focusFor: (screen, fresh) => {
      if (screen === 'players') return $('plList').querySelector('.pick.win') || $('plBack');
      return !editing && fresh ? name : $('pdBack');
    } };
}
