// Race flow: starting a race or the lab, leaving the lab, and turning the simulation's events into sound, toasts and screen effects.
// To add a sound, a toast or a screen effect, add an event type in the simulation and a case in handleEvents().
// Moved verbatim out of src/main.js in M0.7.
import { ord } from './ui/format.js';

export function createGame({ S, doc, reset, raceConfig, audio, hud, lab, input, rig, fx }) {
  const { init: initAudio, tone, noise, vol } = audio;
  const { toast } = hud;
  let overTimer = 0;

  function startRace(mode) {
    if (typeof mode !== 'string') mode = 'race';   // used directly as a click/key handler
    initAudio();
    clearTimeout(overTimer);
    lab.setLab(mode === 'lab');
    if (mode === 'lab') lab.resetStats();
    reset(S, raceConfig(mode));
    S.input.steer = S.input.thr = S.input.brk = S.input.fire = 0;
    hud.showRace();
    rig.reset(); fx.hurtFlash = 0;
  }
  function exitLab() {
    lab.setLab(false); reset(S, raceConfig('attract'));
    input.stickRelease(); S.input.steer = S.input.thr = S.input.brk = S.input.fire = 0;
    hud.showMenu();
  }
  doc.getElementById('start').addEventListener('click', startRace);
  doc.getElementById('again').addEventListener('click', startRace);

  function handleEvents() {
    for (const e of S.events) {
      switch (e.t) {
        case 'tick': tone(520, 0.14, 'square', 0.1); break;
        case 'go': tone(880, 0.4, 'square', 0.13); break;
        case 'shot': {
          const v = vol(e.x, e.y);
          if (e.w === 'mg') tone(240, 0.07, 'sawtooth', 0.07 * v, -120);
          else if (e.w === 'rocket') { noise(0.35, 0.16 * v, 2400); tone(180, 0.3, 'sawtooth', 0.07 * v, -100); }
          else tone(300, 0.12, 'triangle', 0.1 * v, -150);
          break; }
        case 'boom': noise(0.7, 0.45 * vol(e.x, e.y), 1400); break;
        case 'hit': tone(900, 0.04, 'square', 0.05 * vol(e.x, e.y)); break;
        case 'crash': noise(0.18, 0.2, 700); break;
        case 'hurt': fx.hurtFlash = Math.min(1, fx.hurtFlash + 0.3 + e.amt * 0.02); break;
        case 'pickup':
          if (e.car.isPlayer && !S.attract) { toast('+ ' + e.label, 'good'); tone(660, 0.1, 'square', 0.1); setTimeout(() => tone(990, 0.12, 'square', 0.1), 80); }
          break;
        case 'empty': toast('OUT OF AMMO'); break;
        case 'kill': {
          if (S.attract) break;
          const k = e.killer, v = e.victim;
          noise(0.9, 0.5 * vol(e.x, e.y), 1200);
          if (v.isPlayer) toast(k ? k.name + ' WRECKED YOU' : 'YOU CRASHED OUT', 'bad');
          else if (k && k.isPlayer) toast('YOU WRECKED ' + v.name, 'good');
          else toast(k ? k.name + ' WRECKED ' + v.name : v.name + ' CRASHED OUT');
          break; }
        case 'finish': if (!e.car.isPlayer && !S.attract) toast(e.car.name + ' FINISHED ' + ord(e.car.place)); break;
        case 'over': clearTimeout(overTimer); overTimer = setTimeout(hud.showEnd, e.kind === 'wrecked' ? 500 : 1100); break;
      }
    }
    S.events.length = 0;
  }
  return { startRace, exitLab, handleEvents };
}
