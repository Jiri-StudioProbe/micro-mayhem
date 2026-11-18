// The game shell: it builds the pieces and wires them together. Nothing here is logic.
//   sim/sim.js    the simulation (pure; reads S.input, pushes S.events)
//   input.js      keyboard, touch pad and joystick -> S.input
//   ui/           the HUD and screens (hud.js), buttons for sound, assist and level (settings.js), the Steering Lab (lab.js), ?debug (debug.js)
//   game.js       race flow and the simulation's events -> sound, toasts, effects
//   camera.js     the camera rig;  render/  everything drawn;  audio.js  sound
//   loop.js       the frame loop: fixed simulation steps (stepper.js), drawn in between by interpolation (interp.js)
// Moved out of index.html in M0.5a and split into these modules in M0.5 to M0.7; the modules never import each other in a circle:
// where one needs an action from another (start a race, leave the lab), the shell passes it in with connect().
import { Sim } from './sim/sim.js';
import { VERSION, readBuild, versionLabel } from './version.js';
import { createDiag, watchWindow } from './diag.js';
import { newSeed } from './util.js';
import { createProfile, browserStorage } from './profile.js';
import { createSettings } from './levels.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createView } from './render/view.js';
import { createDraw } from './render/draw.js';
import { buildProps } from './render/world.js';
import { createMinimap } from './render/minimap.js';
import { createScene } from './render/scene.js';
import { createHud } from './ui/hud.js';
import { createRouter } from './ui/router.js';
import { createHistoryUi } from './ui/historyui.js';
import { createBackupUi } from './ui/backupui.js';
import { createPlayersUi } from './ui/playersui.js';
import { createFamilyUi } from './ui/familyui.js';
import { createSettingsUi } from './ui/settings.js';
import { createLab } from './ui/lab.js';
import { createDebugOverlay } from './ui/debug.js';
import { createCameraRig } from './camera.js';
import { createInterp } from './interp.js';
import { createGame } from './game.js';
import { createLoop } from './loop.js';
import { createRecorder } from './records.js';

// First, so that anything that goes wrong while starting up is recorded too (shown under ?debug).
const diag = createDiag(); watchWindow(diag, window);
const { T, N, HALF_W, LAPS, STEP, WEAP, create, reset, step, ranking, angDiff } = Sim;
const S = create(newSeed());   // the seed decides every race of this session (S.seed holds the current race's)
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
const DEBUG = /[?&]debug\b/.test(location.search);
$('ver').textContent = versionLabel(VERSION, readBuild(document));   // the release and the deployed commit, on the start screen

// Screen metrics and the camera (src/render/view.js). Canvas resolution steps down automatically on slow devices (see loop.js).
const { view, cam, resize, canStepDown, stepDown } = createView({ canvas: cv, coarse: COARSE, startCam: { x: T.x[0], y: T.y[0], a: T.ang[0] } });
window.addEventListener('resize', resize);

const audio = createAudio({ getPlayer: () => S.player, doc: document });
const Profile = createProfile(browserStorage());
const settings = createSettings(Profile);
const fx = { hurtFlash: 0 };   // screen effects the shell controls; the renderer reads them

const input = createInput({ S, tune: settings.tune, initAudio: audio.init });
let historyUi, playersUi, familyUi;   // (made below, once the profile exists; the router only asks them for a focus target when a screen is shown)
const router = createRouter({ win: window, screens: {
  menu: { el: $('menu') }, end: { el: $('end'), focus: () => $('again') },
  history: { el: $('history'), focus: fresh => historyUi.focusFor('history', fresh) }, backup: { el: $('backup'), focus: () => $('bkBack') }, detail: { el: $('detail'), focus: fresh => historyUi.focusFor('detail', fresh) },
  players: { el: $('players'), focus: fresh => playersUi.focusFor('players', fresh) }, player: { el: $('player'), focus: fresh => playersUi.focusFor('player', fresh) },
  family: { el: $('family'), focus: () => familyUi.focusFor() } } });
router.go('menu');
const hud = createHud({ S, doc: document, router, N, LAPS, WEAP, ranking, stickRelease: input.stickRelease, who: () => Profile.current().name });
const settingsUi = createSettingsUi({ S, doc: document, audio, settings, Profile });
historyUi = createHistoryUi({ doc: document, router, Profile });
createBackupUi({ doc: document, router, Profile });
playersUi = createPlayersUi({ doc: document, router, Profile, settingsUi });
familyUi = createFamilyUi({ doc: document, router, Profile, assistOn: settings.levelAssist });
const lab = createLab({ S, doc: document, N, settings, Profile, settingsUi });
const rig = createCameraRig({ S, cam, ranking, angDiff });
const interp = createInterp({ S, angDiff });
// The RaceConfig of a new race: the player's current settings (the sim fills in the rest). Every race the shell starts gets one.
const raceConfig = mode => ({ mode, assist: settings.levelAssist(), tune: { assistLane: settings.tune.assistLane, assistSpeed: settings.tune.assistSpeed } });
const recorder = createRecorder({ Profile, appVersion: VERSION, getLevel: () => settings.level });
const game = createGame({ S, doc: document, reset, raceConfig, recorder, diag, audio, hud, lab, input, rig, fx });
input.connect({ overlayOpen: hud.overlayOpen, startRace: game.startRace, toggleMute: settingsUi.toggleMute, exitLab: game.exitLab, back: () => router.back(), browsing: () => router.canGoBack() });
lab.connect({ startLab: () => game.startRace('lab'), exitLab: game.exitLab });

/* ---------- renderer (src/render/) ---------- */
const draw = createDraw({ ctx, view, cam });
const props = buildProps({ T, N, HALF_W });
const minimap = createMinimap({ canvas: $('mini'), S, T, N });
const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const { render } = createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion: RM });

const lvParam = /[?&]level=(rookie|veteran)\b/.exec(location.search);
if (lvParam) settingsUi.setLevel(lvParam[1], false);   // for this visit only; not saved
if (/[?&]lab\b/.test(location.search)) game.startRace('lab');
// Test/debug hook: lets tests and ?debug sessions inspect state without depending on how the code is organised.
if (DEBUG) window.__mm = { S, input: S.input, Sim, diag, VERSION, get build() { return readBuild(document); }, get tune() { return settings.tune; }, get level() { return settings.level; } };
const debugUpdate = DEBUG ? createDebugOverlay({ S, view, canvas: cv, diag, doc: document, VERSION, build: () => readBuild(document) }) : null;

createLoop({ S, STEP, step, reset, raceConfig, ranking, ctx, diag, canStepDown, stepDown, input, game, lab, hud, rig, interp, fx, render, drawMini: minimap.draw, audio, debugUpdate }).start();
