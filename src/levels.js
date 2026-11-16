// Difficulty levels and the touch-steering tunables, plus the settings state that sits on top of the profile.
// A level is a bundle of defaults: whether the driving assist starts on, and every steering tunable. The Steering Lab edits the
// active level; only the values you change are saved (per level), so untouched values follow new defaults.
// Bump PRESET_VERSION when baking new defaults: it discards saved tweaks that would otherwise hide them.
import { clamp } from './util.js';

export const PRESET_VERSION = 1;
export const STEER_BASE = { gain: 2.6, curve: 2.55, maxLock: 1, speedDamp: 0.45, rate: 79, dead: 0.14, radius: 48 };
export const LEVELS = {
  rookie:  { label: 'Rookie',  assist: true,  tune: Object.assign({}, STEER_BASE, { assistLane: 1.5, assistSpeed: 1.5 }),
             blurb: 'Driving assist on at full strength: the car holds your lane and keeps you off the walls.' },
  veteran: { label: 'Veteran', assist: false, tune: Object.assign({}, STEER_BASE, { assistLane: 0.3, assistSpeed: 1.1 }),
             blurb: 'No assist: you do the steering. Assist can still be switched on.' }
};
/* Touch steering tunables (ranges and hints; the default values live in LEVELS). Stick steering =
   sign(x) * min(maxLock, gain * |x|^curve), then eased by `rate`. */
export const TUNE_DEFS = [
  { k: 'gain',        label: 'Sensitivity',           min: 0.5, max: 4,    step: 0.05, hint: 'How hard the car turns for a given thumb movement. Higher = twitchier.' },
  { k: 'curve',       label: 'Fine control',          min: 1,   max: 3,    step: 0.05, hint: 'Above 1, small movements steer very gently while big ones still reach full lock.' },
  { k: 'maxLock',     label: 'Maximum lock',          min: 0.3, max: 1,    step: 0.05, hint: 'Caps how sharply the car can ever turn. Lower = wider, calmer turns.' },
  { k: 'speedDamp',   label: 'Calmer at speed',       min: 0,   max: 0.95, step: 0.05, hint: 'Reduces steering as the car goes faster, the way real cars feel stable at speed.' },
  { k: 'rate',        label: 'Reactivity',            min: 4,   max: 100,  step: 1,    hint: 'How quickly the steering follows your thumb. Higher = snappier, lower = smoother but laggier.' },
  { k: 'dead',        label: 'Dead zone',             min: 0,   max: 0.3,  step: 0.01, hint: 'Thumb movement around the centre that is ignored. Stops tiny wobbles.' },
  { k: 'radius',      label: 'Stick travel (px)',     min: 30,  max: 100,  step: 1,    hint: 'How far the thumb moves for full deflection. Bigger = finer control, more thumb travel.' },
  { k: 'assistLane',  label: 'Assist: lane hold',     min: 0,   max: 1.5,  step: 0.05, hint: 'How strongly the car steers itself along the track when you ease off. Needs ASSIST on.' },
  { k: 'assistSpeed', label: 'Assist: corner speed',  min: 0.8, max: 1.5,  step: 0.02, hint: 'Higher lets you carry more speed into corners before the assist slows you. Needs ASSIST on.' }
];

// Level names come from saved data, so they are checked as own properties: "constructor" or "toString" are not levels.
export const isLevel = name => typeof name === 'string' && Object.hasOwn(LEVELS, name);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// The live settings for one profile: the playing character's level and this device's tuning. `tune` is one object that is updated in place, so holders of it always see current values.
// The saved data may be damaged or hand-edited; nothing in it is trusted to have the right shape.
export function createSettings(Profile) {
  function overridesFor(lv) {
    const settings = Profile.data.settings;
    if (!isObject(settings.presets)) settings.presets = {};
    let o = settings.presets[lv];
    if (!isObject(o) || o.pv !== PRESET_VERSION || !isObject(o.tune)) o = settings.presets[lv] = { pv: PRESET_VERSION, tune: {}, assist: null };
    if (o.assist !== null && typeof o.assist !== 'boolean') o.assist = null;
    return o;
  }
  // The level belongs to the character who is playing; the tuning (presets) belongs to this device.
  const characterLevel = () => (isLevel(Profile.current().level) ? Profile.current().level : 'veteran');
  let level = characterLevel();
  const tune = {};
  function loadLevel(name) {
    if (!isLevel(name)) return;
    level = name; Profile.setLevel(name);
    const ov = overridesFor(name).tune;
    TUNE_DEFS.forEach(d => { const v = ov[d.k]; tune[d.k] = typeof v === 'number' && isFinite(v) ? clamp(v, d.min, d.max) : LEVELS[name].tune[d.k]; });
  }
  function setTuneValue(k, v) {
    tune[k] = v; const ov = overridesFor(level);
    if (v === LEVELS[level].tune[k]) delete ov.tune[k]; else ov.tune[k] = v;
    Profile.save();
  }
  const levelAssist = () => { const a = overridesFor(level).assist; return a === null ? LEVELS[level].assist : a; };
  loadLevel(level);
  // Another character is playing: take up their level (the caller refreshes whatever shows it).
  const reload = () => loadLevel(characterLevel());
  return { tune, get level() { return level; }, loadLevel, reload, setTuneValue, levelAssist, overridesFor };
}
