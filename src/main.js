// The game shell: it builds the pieces and wires them together. Nothing here is logic.
//   sim/sim.js    the simulation (pure; reads S.input, pushes S.events)
//   input.js      keyboard, touch pad and joystick -> S.input
//   ui/           the HUD and screens (hud.js), buttons for sound, assist and level (settings.js), the Steering Lab (lab.js), ?debug (debug.js)
//   game.js       race flow and the simulation's events -> sound, toasts, effects
//   camera.js     the camera rig;  render/  everything drawn;  audio.js  sound;  loop.js  the frame loop
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
import { createSettingsUi } from './ui/settings.js';
import { createLab } from './ui/lab.js';
import { createDebugOverlay } from './ui/debug.js';
import { createCameraRig } from './camera.js';
import { createGame } from './game.js';
import { createLoop } from './loop.js';

// First, so that anything that goes wrong while starting up is recorded too (shown under ?debug).
const diag = createDiag(); watchWindow(diag, window);
const { T, N, HALF_W, LAPS, WEAP, create, reset, step, ranking, angDiff } = Sim;
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
const hud = createHud({ S, doc: document, N, LAPS, WEAP, ranking, stickRelease: input.stickRelease });
const settingsUi = createSettingsUi({ S, doc: document, audio, settings, Profile });
const lab = createLab({ S, doc: document, N, settings, Profile, settingsUi });
const rig = createCameraRig({ S, cam, ranking, angDiff });
const game = createGame({ S, doc: document, reset, audio, hud, lab, input, rig, fx });
input.connect({ overlayOpen: hud.overlayOpen, startRace: game.startRace, toggleMute: settingsUi.toggleMute, exitLab: game.exitLab });
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

createLoop({ S, step, reset, ranking, ctx, diag, canStepDown, stepDown, input, game, lab, hud, rig, fx, render, drawMini: minimap.draw, audio, debugUpdate }).start();
