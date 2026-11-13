// The Steering Lab: the tuning panel (a slider per entry of TUNE_DEFS, level switch, RESET and COPY) and the lap timer and readout.
// Moved verbatim out of src/main.js in M0.7, except that the lap timer is now a separate pure function so that it can be tested in Node.
import { LEVELS, TUNE_DEFS } from '../levels.js';

// Lap timing: prog counts track samples, so floor(prog / N) is the lap index (-1 = still behind the start line).
export function createLapTimer({ S, N }) {
  const lab = { lap: -1, t0: null, last: null, best: null, touches0: 0, prevHits: null };
  function track() {
    const P = S.player, lapNo = Math.floor(P.prog / N);
    if (lapNo > lab.lap) {
      if (lab.t0 !== null) { lab.last = S.t - lab.t0; lab.best = lab.best === null ? lab.last : Math.min(lab.best, lab.last); lab.prevHits = S.touches - lab.touches0; }
      lab.t0 = S.t; lab.touches0 = S.touches; lab.lap = lapNo;
    } else if (lapNo < lab.lap) { lab.lap = lapNo; lab.t0 = null; }   // reversed over the line: this lap doesn't count
  }
  function reset() { Object.assign(lab, { lap: -1, t0: null, last: null, best: null, touches0: 0, prevHits: null }); }
  return { lab, track, reset };
}

export function createLab({ S, doc, N, settings, Profile, settingsUi }) {
  const $ = id => doc.getElementById(id);
  const { tune, loadLevel, setTuneValue, levelAssist, overridesFor } = settings;
  const { showAssist } = settingsUi;
  const hud = $('hud'), padEl = $('pad'), stickEl = $('stick'), lapEl = $('lap');
  const tuneEl = $('tune'), tuneBody = $('tuneBody'), tuneOut = $('tuneOut'), tuneBtn = $('tuneBtn'), labExitBtn = $('labExit');
  const timer = createLapTimer({ S, N }), lab = timer.lab;
  function tuneText() {
    const o = { level: settings.level }; TUNE_DEFS.forEach(d => { o[d.k] = +tune[d.k].toFixed(3); }); o.assist = S.assist ? 'on' : 'off';
    return JSON.stringify(o);
  }
  function refreshTune() {
    TUNE_DEFS.forEach(d => {
      const v = tune[d.k], def = LEVELS[settings.level].tune[d.k], el = $('tv_' + d.k);
      el.firstChild.nodeValue = String(+v.toFixed(2));
      el.lastChild.textContent = v === def ? 'default' : 'default ' + def;
    });
    stickEl.style.width = stickEl.style.height = (2 * tune.radius + 36) + 'px';
    tuneOut.value = tuneText();
  }
  function syncTune() { TUNE_DEFS.forEach(d => { $('t_' + d.k).value = tune[d.k]; }); refreshTune(); }
  TUNE_DEFS.forEach(d => {
    const row = doc.createElement('div'); row.className = 'trow';
    row.innerHTML = '<label for="t_' + d.k + '"><span>' + d.label + '</span><b id="tv_' + d.k + '">0<i></i></b></label>' +
      '<input type="range" id="t_' + d.k + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '"><small>' + d.hint + '</small>';
    tuneBody.appendChild(row);
    const inp = row.querySelector('input'); inp.value = tune[d.k];
    inp.addEventListener('input', () => { setTuneValue(d.k, +inp.value); refreshTune(); });
  });
  $('tuneReset').addEventListener('click', () => {   // back to this level's defaults
    const ov = overridesFor(settings.level); ov.tune = {}; ov.assist = null; Profile.save();
    loadLevel(settings.level); S.assist = levelAssist(); showAssist(); syncTune();
  });
  $('tuneCopy').addEventListener('click', () => {
    tuneOut.value = tuneText(); tuneOut.focus(); tuneOut.select();
    const b = $('tuneCopy'), done = ok => { b.textContent = ok ? 'COPIED' : 'SELECTED'; setTimeout(() => { b.textContent = 'COPY'; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tuneOut.value).then(() => done(true), () => done(false)); else done(false);
  });
  function openTune(open) { tuneEl.hidden = !open; if (open) refreshTune(); }
  tuneBtn.addEventListener('click', () => openTune(tuneEl.hidden));
  $('tuneClose').addEventListener('click', () => openTune(false));
  refreshTune();
  // The settings buttons keep the panel up to date: the JSON follows the assist state, the sliders follow a level change.
  settingsUi.hooks.assistShown = () => { tuneOut.value = tuneText(); };
  settingsUi.hooks.levelLoaded = syncTune;
  showAssist();

  const setTxt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  function updateHud() {
    setTxt(lapEl, String(Math.max(1, Math.floor(S.player.prog / N) + 1)));
    const lt = t => t === null ? '—' : t.toFixed(1) + ' s';
    setTxt($('lsLast'), lt(lab.last)); setTxt($('lsBest'), lt(lab.best));
    const cur = S.touches - lab.touches0;
    setTxt($('lsHits'), cur + (lab.prevHits === null ? '' : '  (last lap ' + lab.prevHits + ')'));
  }
  function setLab(on) {
    hud.classList.toggle('lab', on); padEl.classList.toggle('lab', on);
    tuneBtn.hidden = labExitBtn.hidden = !on;
    if (on) { padEl.classList.add('avail'); openTune(true); } else openTune(false);
  }
  // actions = { startLab(), exitLab() }: the buttons that start and leave the lab.
  function connect(actions) {
    labExitBtn.addEventListener('click', actions.exitLab); $('tuneExit').addEventListener('click', actions.exitLab);
    $('labBtn').addEventListener('click', actions.startLab);
  }
  return { setLab, track: timer.track, resetStats: timer.reset, updateHud, connect };
}
