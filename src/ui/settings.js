// The sound button, and the driving-assist and difficulty-level buttons (start screen, HUD and lab panel).
// The lab panel has to follow level and assist changes, and this module cannot import it (the panel imports this one), so it
// offers two hooks the panel fills in: hooks.assistShown() and hooks.levelLoaded().
// Moved verbatim out of src/main.js in M0.7.
import { LEVELS, isLevel } from '../levels.js';

export function createSettingsUi({ S, doc, audio, settings, Profile }) {
  const $ = id => doc.getElementById(id);
  const { loadLevel, levelAssist, overridesFor } = settings;
  const hooks = { assistShown: null, levelLoaded: null };
  const sndBtn = $('snd');
  function toggleMute() { audio.setMuted(!audio.muted); sndBtn.textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON'; sndBtn.setAttribute('aria-pressed', String(!audio.muted)); }
  sndBtn.addEventListener('click', toggleMute);
  const assistBtns = [$('assistHud'), $('assistMenu'), $('assistTune')], levelBtns = doc.querySelectorAll('[data-level]');
  function showAssist() {
    const on = !!S.assist;
    assistBtns[0].textContent = assistBtns[2].textContent = on ? 'ASSIST ON' : 'ASSIST OFF'; assistBtns[1].textContent = 'DRIVING ASSIST: ' + (on ? 'ON' : 'OFF');
    assistBtns.forEach(b => b.setAttribute('aria-pressed', String(on)));
    if (hooks.assistShown) hooks.assistShown();
  }
  function showLevel() {
    levelBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
    $('levelBlurb').textContent = LEVELS[settings.level].blurb;
  }
  function setAssist(on) {
    S.assist = on;
    overridesFor(settings.level).assist = on === LEVELS[settings.level].assist ? null : on; Profile.save();   // only a deliberate difference is remembered
    showAssist();
  }
  function setLevel(name, persist) {
    if (!isLevel(name)) return;
    loadLevel(name); if (persist !== false) Profile.save();
    S.assist = levelAssist(); showAssist(); showLevel();
    if (hooks.levelLoaded) hooks.levelLoaded();
  }
  assistBtns.forEach(b => b.addEventListener('click', () => setAssist(!S.assist)));
  levelBtns.forEach(b => b.addEventListener('click', () => setLevel(b.dataset.level)));
  S.assist = levelAssist(); showAssist(); showLevel();
  return { toggleMute, showAssist, setLevel, hooks };
}
