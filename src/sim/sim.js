// The simulation: pure game rules. No DOM, no canvas, no audio, no storage, no network (enforced by lint, see eslint.config.js).
// State goes in (S.input), plain events come out (S.events). Everything the game needs from the outside is passed in.
// Moved verbatim out of index.html in M0.4; only the `export` below is new. Seeded in M1: see S.seed, S.rng and S.fxRng.
import { mulberry32, deriveSeed } from './rng.js';
export const Sim = (() => {
'use strict';
const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
// Two random streams per race, both from the race's seed. S.rng decides everything that matters to the race (AI character, aim spread, crate
// contents); S.fxRng only decorates it (sparks, smoke, flames), so drawing fewer or more particles can never change who wins.
const rand = (S, a, b) => a + S.rng() * (b - a);
const frand = (S, a, b) => a + S.fxRng() * (b - a);
const newSeed = master => (master() * 4294967296) >>> 0;

const LAPS = 3, HALF_W = 88, SP = 22, LATACC = 640;
const STEP = 1 / 60;   // the simulation's time step: the shell steps the sim in exactly this many seconds, always (M1.2)
// The version of the rules. A saved race is only replayable by the sim that played it, so ANY change to physics, AI, weapons, damage, the track
// or the order or number of random draws must bump this (tests/sim/simversion.test.js fails until it does). Version 1 is the sim as of M1.3.
const SIM_VERSION = 1;

/* ---------- race configuration ---------- */
// A RaceConfig is plain data that, with the steps' inputs, fully determines a race: { mode, seed, assist, tune: { assistLane, assistSpeed } }.
// mode: 'race' (countdown, rivals, crates), 'attract' (the AI drives the player car too) or 'lab' (the player alone, no damage, no end).
// The shell builds one for each race; a saved race stores it with SIM_VERSION. makeConfig() fills in defaults and repairs a config
// (the shell's path); configProblems() says what is wrong with one without repairing it (the path for anything loaded from storage).
const MODES = ['race', 'attract', 'lab'];
const TUNE_LIMITS = { assistLane: [0, 1.5], assistSpeed: [0.8, 1.5] };   // the ranges the tuning panel allows (src/levels.js has the same numbers)
const DEFAULT_TUNE = { assistLane: 1, assistSpeed: 1.1 };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isSeed = v => Number.isInteger(v) && v >= 0 && v <= 4294967295;
function makeConfig(c) {
  c = isObj(c) ? c : {};
  const t = isObj(c.tune) ? c.tune : {};
  const tune = {};
  for (const k in TUNE_LIMITS) tune[k] = typeof t[k] === 'number' && isFinite(t[k]) ? clamp(t[k], TUNE_LIMITS[k][0], TUNE_LIMITS[k][1]) : DEFAULT_TUNE[k];
  const cfg = { mode: MODES.includes(c.mode) ? c.mode : 'race', assist: c.assist === true, tune };
  if (typeof c.seed === 'number' && isFinite(c.seed)) cfg.seed = c.seed >>> 0;   // no seed: reset() takes the next one from the session's master stream
  return cfg;
}
function configProblems(c) {
  if (!isObj(c)) return ['the config is not an object'];
  const p = [];
  for (const k of Object.keys(c)) if (!['mode', 'seed', 'assist', 'tune'].includes(k)) p.push('unknown field ' + k);
  if (!MODES.includes(c.mode)) p.push('mode must be one of ' + MODES.join(', '));
  if (c.seed !== undefined && !isSeed(c.seed)) p.push('seed must be an integer from 0 to 4294967295');
  if (typeof c.assist !== 'boolean') p.push('assist must be true or false');
  if (!isObj(c.tune)) p.push('tune must be an object');
  else {
    for (const k of Object.keys(c.tune)) if (!(k in TUNE_LIMITS)) p.push('unknown tune value ' + k);
    for (const k in TUNE_LIMITS) { const v = c.tune[k]; if (typeof v !== 'number' || !isFinite(v) || v < TUNE_LIMITS[k][0] || v > TUNE_LIMITS[k][1]) p.push('tune.' + k + ' must be a number from ' + TUNE_LIMITS[k][0] + ' to ' + TUNE_LIMITS[k][1]); }
  }
  return p;
}
// What a saved race needs to be replayed: the sim's version and the exact config (with the seed that was actually used). Plain JSON.
const raceHeader = S => ({ simVersion: S.simVersion, config: JSON.parse(JSON.stringify(S.config)) });
const CTRL = [[150,250],[650,200],[1150,220],[1650,300],[2000,520],[2050,900],[1800,1150],[1450,1050],[1250,780],[1000,700],[800,950],[1000,1250],[1300,1500],[1250,1800],[800,1900],[350,1750],[100,1400],[350,1100],[150,800],[-100,500]];

/* ---------- track ---------- */
function buildTrack() {
  const raw = [], m = CTRL.length;
  const cr = (a, b, c, d, t) => 0.5 * ((2*b) + (-a + c) * t + (2*a - 5*b + 4*c - d) * t*t + (-a + 3*b - 3*c + d) * t*t*t);
  for (let i = 0; i < m; i++) {
    const p0 = CTRL[(i + m - 1) % m], p1 = CTRL[i], p2 = CTRL[(i + 1) % m], p3 = CTRL[(i + 2) % m];
    for (let s = 0; s < 24; s++) { const t = s / 24; raw.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]); }
  }
  const cum = [0]; let L = 0;
  for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(L); }
  const n = Math.round(L / SP), sp = L / n;
  const x = new Float32Array(n), y = new Float32Array(n), tx = new Float32Array(n), ty = new Float32Array(n),
        nx = new Float32Array(n), ny = new Float32Array(n), curv = new Float32Array(n), vsafe = new Float32Array(n), ang = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = i * sp; while (cum[j + 1] < target) j++;
    const t = (target - cum[j]) / (cum[j + 1] - cum[j]), a = raw[j], b = raw[(j + 1) % raw.length];
    x[i] = a[0] + (b[0] - a[0]) * t; y[i] = a[1] + (b[1] - a[1]) * t;
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    let dx = x[b] - x[a], dy = y[b] - y[a]; const l = Math.hypot(dx, dy);
    tx[i] = dx / l; ty[i] = dy / l; nx[i] = -ty[i]; ny[i] = tx[i]; ang[i] = Math.atan2(ty[i], tx[i]);
  }
  const rc = new Float32Array(n);
  for (let i = 0; i < n; i++) rc[i] = Math.abs(angDiff(ang[i], ang[(i + 1) % n])) / sp;
  for (let i = 0; i < n; i++) curv[i] = (rc[(i + n - 1) % n] + rc[i] + rc[(i + 1) % n]) / 3;
  for (let i = 0; i < n; i++) {
    let best = 600;
    for (let k = 0; k <= 18; k++) {
      const c = curv[(i + k) % n], vs = Math.min(600, Math.sqrt(LATACC / Math.max(c, 1e-5)));
      best = Math.min(best, Math.sqrt(vs * vs + 2 * 520 * k * sp));
    }
    vsafe[i] = best;
  }
  return { n, len: L, sp, x, y, tx, ty, nx, ny, curv, vsafe, ang };
}
const T = buildTrack();
const N = T.n;

function nearest(px, py, hint) {
  let best = 0, bd = 1e18;
  if (hint >= 0) {
    for (let k = -14; k <= 14; k++) {
      const i = (hint + k + N) % N, dx = px - T.x[i], dy = py - T.y[i], d = dx*dx + dy*dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd < 250 * 250) return best;
    bd = 1e18;
  }
  for (let i = 0; i < N; i++) {
    const dx = px - T.x[i], dy = py - T.y[i], d = dx*dx + dy*dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ---------- content ---------- */
const WEAP = {
  mg:     { name: 'MACHINE GUN', ammo: 45 },
  rocket: { name: 'ROCKETS',     ammo: 4 },
  mine:   { name: 'MINES',       ammo: 3 }
};
const NAMES = ['YOU', 'BLAZE', 'NITRO', 'VIPER', 'GRIT', 'ROCKO'];
const COLORS = [[255,90,54],[60,120,255],[170,90,250],[255,105,180],[70,205,235],[150,220,60]];

function newCar(S, k, gridK) {
  const row = gridK >> 1, col = gridK & 1;
  const i0 = (N - 3 - row * 3 - col + N * 4) % N;
  const lat = col ? 28 : -28;
  const c = {
    id: k, name: NAMES[k], color: COLORS[k], isPlayer: k === 0,
    x: T.x[i0] + T.nx[i0] * lat, y: T.y[i0] + T.ny[i0] * lat, a: T.ang[i0],
    vx: 0, vy: 0, hp: 100, alive: true, wreck: 0, flash: 0,
    idx: i0, lastIdx: i0, prog: i0 - N, finished: false, place: 0, finishT: 0, kills: 0,
    weapon: null, ammo: 0, cool: 0, steer: 0, throttle: 0, brake: 0, fire: 0,
    maxSpeed: k === 0 ? 372 : 366, accel: 520, auto: k !== 0,
    ai: { skill: k === 0 ? 0.92 : 0.84 + S.rng() * 0.12, lane: 0, laneT: S.rng() * 2, stuck: 0, rev: 0, react: 0, aggr: 0.2 + S.rng() * 0.3 },
    rot: 0
  };
  return c;
}

// `seed` seeds a master stream that supplies the seed of every later reset() that is not given one, so a whole session is reproducible.
function create(seed = 1) {
  const S = { master: mulberry32(seed), seed: 0, rng: null, fxRng: null, cars: [], bullets: [], rockets: [], mines: [], parts: [], rings: [], crates: [], events: [],
    t: 0, raceT: 0, state: 'race', cd: 0, input: { steer: 0, thr: 0, brk: 0, fire: 0 },
    shake: 0, finishOrder: [], result: null, deadT: 0, player: null, lab: false, touches: 0,
    tune: { assistLane: 1, assistSpeed: 1.1 } };
  reset(S, 'attract');
  return S;
}

// Starts a race from a RaceConfig (see above). The same config, steps and inputs always play out the same. Without a seed in the config, the next
// one comes from the master stream. `reset(S, 'race', seed)` is shorthand for a config with only a mode and a seed (the rest are defaults).
// S.config is the normalized config with the seed actually used, and S.simVersion the rules it was played under. S.lab and S.attract are
// conveniences derived from the mode. (S.assist can still be toggled during a race; that is an input, which a replay has to record.)
function reset(S, config, seed) {
  const cfg = makeConfig(typeof config === 'string' || config === undefined ? { mode: config, seed } : config), mode = cfg.mode;
  S.seed = cfg.seed === undefined ? newSeed(S.master) : cfg.seed; cfg.seed = S.seed;
  S.config = cfg; S.simVersion = SIM_VERSION;
  S.assist = cfg.assist; S.tune.assistLane = cfg.tune.assistLane; S.tune.assistSpeed = cfg.tune.assistSpeed;
  S.rng = mulberry32(deriveSeed(S.seed, 1)); S.fxRng = mulberry32(deriveSeed(S.seed, 2));
  S.cars.length = S.bullets.length = S.rockets.length = S.mines.length = S.parts.length = S.rings.length = S.crates.length = 0;
  S.finishOrder.length = 0; S.result = null; S.deadT = 0; S.raceT = 0; S.shake = 0; S.touches = 0;
  S.lab = mode === 'lab';   // steering lab: the player alone, no crates, no damage, no end
  const playerSlot = 3;
  const slots = [0, 1, 2, 4, 5]; let si = 0;
  for (let k = 0; k < (S.lab ? 1 : 6); k++) {
    const slot = k === 0 ? playerSlot : slots[si++];
    S.cars.push(newCar(S, k, slot));
  }
  S.player = S.cars[0];
  const G = S.lab ? 0 : 11;
  for (let g = 0; g < G; g++) {
    const idx = Math.floor(N * (g + 0.55) / G);
    for (const lat of [-46, 0, 46]) {
      S.crates.push({ idx, lat, x: T.x[idx] + T.nx[idx] * lat, y: T.y[idx] + T.ny[idx] * lat, cd: 0 });
    }
  }
  if (mode === 'attract') { S.state = 'race'; S.player.auto = true; S.attract = true; }
  else if (S.lab) { S.state = 'race'; S.player.auto = false; S.attract = false; }
  else { S.state = 'countdown'; S.cd = 3.4; S.cdShown = 4; S.player.auto = false; S.attract = false; }
}

/* ---------- effects ---------- */
function part(S, kind, x, y, h, vx, vy, vh, life, size, r, g, b, grav) {
  if (S.parts.length > 800) return;
  S.parts.push({ kind, x, y, h, vx, vy, vh, life, max: life, size, r, g, b, grav: grav || 0 });
}
function sparks(S, x, y, h, n, spd) {
  for (let i = 0; i < n; i++) { const a = frand(S, 0, TAU), s = frand(S, 0.3, 1) * spd; part(S, 0, x, y, h, Math.cos(a) * s, Math.sin(a) * s, frand(S, 20, 120), frand(S, 0.15, 0.4), 2, 255, frand(S, 180, 240), 90, 300); }
}
function smoke(S, x, y, h, dark) {
  const g = dark ? 40 : 120; part(S, 1, x + frand(S, -3, 3), y + frand(S, -3, 3), h, frand(S, -12, 12), frand(S, -12, 12), frand(S, 20, 50), frand(S, 0.6, 1.1), frand(S, 5, 8), g, g, g + 6, 0);
}
function flame(S, x, y, h) {
  part(S, 2, x + frand(S, -4, 4), y + frand(S, -4, 4), h, frand(S, -15, 15), frand(S, -15, 15), frand(S, 40, 90), frand(S, 0.25, 0.5), frand(S, 5, 9), 255, frand(S, 110, 190), 40, 0);
}
function bigBoom(S, x, y, scale) {
  for (let i = 0; i < 26 * scale; i++) { const a = frand(S, 0, TAU), s = frand(S, 30, 230) * scale; part(S, 2, x, y, 6, Math.cos(a) * s, Math.sin(a) * s, frand(S, 20, 140), frand(S, 0.3, 0.7), frand(S, 7, 14), 255, frand(S, 100, 210), 40, 0); }
  for (let i = 0; i < 14 * scale; i++) { const a = frand(S, 0, TAU), s = frand(S, 10, 90) * scale; part(S, 1, x, y, 8, Math.cos(a) * s, Math.sin(a) * s, frand(S, 30, 80), frand(S, 0.8, 1.5), frand(S, 9, 15), 50, 50, 56, 0); }
  sparks(S, x, y, 8, 18 * scale, 260);
  S.rings.push({ x, y, r: 6, max: 70 * scale, life: 0.35, t: 0.35 });
}
function debris(S, c) {
  for (let i = 0; i < 12; i++) { const a = frand(S, 0, TAU), s = frand(S, 40, 200); part(S, 3, c.x, c.y, 8, Math.cos(a) * s, Math.sin(a) * s, frand(S, 80, 220), frand(S, 0.8, 1.4), frand(S, 2.5, 4.5), c.color[0] * 0.5, c.color[1] * 0.5, c.color[2] * 0.5, 520); }
}

/* ---------- damage ---------- */
function hurt(S, c, amt, by) {
  if (!c.alive || amt <= 0 || S.lab) return;
  c.hp -= amt; c.flash = 0.14;
  if (c.isPlayer) S.events.push({ t: 'hurt', amt });
  if (c.hp <= 0) destroy(S, c, by);
}
function destroy(S, c, by) {
  c.alive = false; c.wreck = 7; c.hp = 0; c.throttle = c.brake = c.steer = c.fire = 0; c.weapon = null; c.ammo = 0;
  bigBoom(S, c.x, c.y, 1.15); debris(S, c);
  if (by && by !== c) by.kills++;
  S.events.push({ t: 'kill', killer: by && by !== c ? by : null, victim: c, x: c.x, y: c.y });
  S.shake = Math.max(S.shake, shakeFor(S, c.x, c.y, 1));
}
function shakeFor(S, x, y, k) { const p = S.player; return clamp(1 - Math.hypot(x - p.x, y - p.y) / 520, 0, 1) * k; }
function explode(S, x, y, R, dmg, owner) {
  bigBoom(S, x, y, R / 62);
  S.events.push({ t: 'boom', x, y });
  S.shake = Math.max(S.shake, shakeFor(S, x, y, 0.7));
  for (const c of S.cars) {
    if (!c.alive) continue;
    const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy);
    if (d < R) {
      const f = 1 - d / R;
      hurt(S, c, (c === owner ? 0.4 : 1) * (dmg * (0.25 + 0.75 * f)), owner);
      const push = 240 * f / Math.max(d, 1);
      c.vx += dx * push; c.vy += dy * push;
    }
  }
}

/* ---------- weapons ---------- */
function tryFire(S, c) {
  if (c.cool > 0 || !c.weapon || c.ammo <= 0 || S.state === 'countdown') return;
  const f = Math.cos(c.a), s = Math.sin(c.a);
  if (c.weapon === 'mg') {
    c.cool = 0.075; c.ammo--;
    const sprd = c.isPlayer && !c.auto ? 0.03 : 0.07, a = c.a + rand(S, -sprd, sprd);
    S.bullets.push({ x: c.x + f * 18, y: c.y + s * 18, vx: Math.cos(a) * 760 + c.vx * 0.7, vy: Math.sin(a) * 760 + c.vy * 0.7, life: 0.62, owner: c, dmg: 2.2 });
    sparks(S, c.x + f * 19, c.y + s * 19, 7, 1, 80);
    S.events.push({ t: 'shot', w: 'mg', x: c.x, y: c.y });
  } else if (c.weapon === 'rocket') {
    c.cool = 0.6; c.ammo--;
    const vf = c.vx * f + c.vy * s;
    S.rockets.push({ x: c.x + f * 20, y: c.y + s * 20, a: c.a, sp: Math.max(vf, 120) + 260, life: 2.1, owner: c });
    S.events.push({ t: 'shot', w: 'rocket', x: c.x, y: c.y });
  } else if (c.weapon === 'mine') {
    c.cool = 0.5; c.ammo--;
    S.mines.push({ x: c.x - f * 26, y: c.y - s * 26, owner: c, arm: 0.9, life: 30 });
    S.events.push({ t: 'shot', w: 'mine', x: c.x, y: c.y });
  }
  if (c.ammo <= 0) { c.weapon = null; if (c.isPlayer) S.events.push({ t: 'empty' }); }
}

/* ---------- AI ---------- */
function aiControl(S, c, dt) {
  const a = c.ai, f = Math.cos(c.a), s = Math.sin(c.a);
  const vf = c.vx * f + c.vy * s, spd = Math.hypot(c.vx, c.vy);
  a.laneT -= dt;
  if (a.laneT <= 0) { a.laneT = rand(S, 1.4, 3.6); a.lane = rand(S, -1, 1) * (HALF_W - 46); }
  let lane = a.lane;
  if (!c.weapon || c.hp < 50) {
    for (const cr of S.crates) {
      if (cr.cd > 0) continue;
      const di = (cr.idx - c.idx + N) % N;
      if (di > 2 && di < 15) { lane = cr.lat; break; }
    }
  }
  // avoid cars directly ahead
  for (const o of S.cars) {
    if (o === c || !(o.alive || o.wreck > 0)) continue;
    const dx = o.x - c.x, dy = o.y - c.y, fw = dx * f + dy * s, lt = -dx * s + dy * f;
    if (fw > 12 && fw < 120 && Math.abs(lt) < 30) lane = clamp(lane + (lt > 0 ? -1 : 1) * 40, -HALF_W + 40, HALF_W - 40);
  }
  const look = 3 + Math.floor(spd / 75), ti = (c.idx + look) % N;
  const tx = T.x[ti] + T.nx[ti] * lane, ty = T.y[ti] + T.ny[ti] * lane;
  const da = angDiff(c.a, Math.atan2(ty - c.y, tx - c.x));
  c.steer = clamp(da * 2.8, -1, 1);
  const target = Math.min(c.maxSpeed * a.skill, T.vsafe[c.idx] * (0.9 + 0.1 * a.skill));
  c.throttle = vf < target ? 1 : 0;
  c.brake = vf > target * 1.1 ? 1 : 0;
  if (Math.abs(da) > 1.2) { c.throttle = vf < 120 ? 1 : 0; }
  if (spd < 22 && S.state === 'race') a.stuck += dt; else a.stuck = Math.max(0, a.stuck - dt * 2);
  if (a.stuck > 1.1) { a.rev = 0.8; a.stuck = 0; }
  if (a.rev > 0) { a.rev -= dt; c.throttle = 0; c.brake = 1; c.steer = -c.steer; }

  // shooting
  c.fire = 0;
  if (c.weapon && S.state === 'race') {
    a.react -= dt; if (a.react > 0) return;
    for (const o of S.cars) {
      if (o === c || !o.alive) continue;
      const dx = o.x - c.x, dy = o.y - c.y, fw = dx * f + dy * s, lt = -dx * s + dy * f;
      if (c.weapon === 'mg' && fw > 20 && fw < 300 && Math.abs(lt) < fw * 0.1 + 8) { c.fire = S.rng() < a.aggr ? 1 : 0; a.react = 0.12; break; }
      if (c.weapon === 'rocket' && fw > 60 && fw < 460 && Math.abs(lt) < fw * 0.2 + 12) { c.fire = S.rng() < a.aggr ? 1 : 0; a.react = rand(S, 0.9, 2.2); break; }
      if (c.weapon === 'mine' && fw < -20 && fw > -150 && Math.abs(lt) < 30) { c.fire = S.rng() < a.aggr ? 1 : 0; a.react = rand(S, 1.0, 2.5); break; }
    }
  }
}

/* ---------- driving assist (touch) ---------- */
// Thumb steering is noisy and a phone player can't lift off the gas mid-corner, so the car helps:
// it holds the lane it is in (steering along the track and away from the walls) and sheds speed
// before corners it could not take. The driver's own steering always takes priority.
function assist(S, c) {
  const spd = Math.hypot(c.vx, c.vy), f = Math.cos(c.a), s = Math.sin(c.a), vf = c.vx * f + c.vy * s;
  const i = c.idx, d = (c.x - T.x[i]) * T.nx[i] + (c.y - T.y[i]) * T.ny[i];
  const lane = clamp(d, -(HALF_W - 44), HALF_W - 44);
  const ti = (i + 3 + Math.floor(spd / 75)) % N;
  const da = angDiff(c.a, Math.atan2(T.y[ti] + T.ny[ti] * lane - c.y, T.x[ti] + T.nx[ti] * lane - c.x));
  if (vf > 20) c.steer = clamp(c.steer + clamp(da * 2.8, -1, 1) * (1 - Math.min(1, Math.abs(c.steer) * 1.3)) * S.tune.assistLane, -1, 1);
  const vmax = T.vsafe[i] * S.tune.assistSpeed;   // corner speed allowed, as a multiple of the AI's safe speed
  if (vf > vmax) c.throttle = 0;
  if (vf > vmax * 1.18 && !c.brake) c.brake = 1;
}

/* ---------- physics ---------- */
function drive(c, dt) {
  const fx = Math.cos(c.a), fy = Math.sin(c.a), rx = -fy, ry = fx;
  let vf = c.vx * fx + c.vy * fy, vl = c.vx * rx + c.vy * ry;
  if (c.throttle > 0) {
    if (vf < -5) vf += 700 * dt; else vf += c.accel * clamp(1 - vf / c.maxSpeed, 0, 1.2) * dt;
  }
  if (c.brake > 0) { if (vf > 2) vf = Math.max(0, vf - 640 * dt); else vf = Math.max(-120, vf - 260 * dt); }
  if (!c.throttle && !c.brake) vf *= Math.exp(-0.9 * dt);
  vf *= Math.exp(-0.12 * dt);
  vl *= Math.exp(-(c.brake > 0 && vf > 60 ? 3.2 : 7.5) * dt);
  const sp = Math.abs(vf);
  const turn = c.steer * 2.75 * clamp(sp / 110, 0, 1) * (1 - 0.22 * clamp(sp / c.maxSpeed, 0, 1)) * (vf < -1 ? -1 : 1);
  c.a += turn * dt;
  c.rot = turn;
  c.vx = fx * vf + rx * vl; c.vy = fy * vf + ry * vl;
  c.x += c.vx * dt; c.y += c.vy * dt;
}

function walls(S, c, dt, track) {
  c.idx = nearest(c.x, c.y, c.idx);
  const i = c.idx, d = (c.x - T.x[i]) * T.nx[i] + (c.y - T.y[i]) * T.ny[i], lim = HALF_W - 11;
  if (c.isPlayer) { const hit = Math.abs(d) > lim; if (hit && !c.touching) S.touches++; c.touching = hit; }
  if (Math.abs(d) > lim) {
    const sg = d > 0 ? 1 : -1, over = Math.abs(d) - lim;
    c.x -= T.nx[i] * sg * over; c.y -= T.ny[i] * sg * over;
    const vn = (c.vx * T.nx[i] + c.vy * T.ny[i]) * sg;
    if (vn > 0) {
      c.vx -= 1.3 * vn * T.nx[i] * sg; c.vy -= 1.3 * vn * T.ny[i] * sg;
      if (c.alive && vn > 100) {
        hurt(S, c, (vn - 110) * 0.04, null);
        sparks(S, c.x + T.nx[i] * sg * 10, c.y + T.ny[i] * sg * 10, 6, 5, 140);
        if (c.isPlayer) S.events.push({ t: 'crash' });
      }
    }
    const k = Math.exp(-1.1 * dt); c.vx *= k; c.vy *= k;
  }
  if (track) {
    let dI = c.idx - c.lastIdx; if (dI > N / 2) dI -= N; else if (dI < -N / 2) dI += N;
    c.prog += dI; c.lastIdx = c.idx;
  }
}

/* ---------- ranking ---------- */
function ranking(S) {
  return S.cars.slice().sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.place - b.place;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.prog - a.prog;
  });
}

/* ---------- main step ---------- */
function step(S, dt) {
  dt = Math.min(dt, 1 / 30);
  S.t += dt;
  S.shake = Math.max(0, S.shake - dt * 2.2);
  const P = S.player;

  if (S.state === 'countdown') {
    S.cd -= dt;
    const shown = Math.ceil(S.cd);
    if (shown !== S.cdShown && shown >= 1 && shown <= 3) { S.cdShown = shown; S.events.push({ t: 'tick', n: shown }); }
    if (S.cd <= 0) { S.state = 'race'; S.raceT = 0; S.events.push({ t: 'go' }); }
  } else if (S.state === 'race') S.raceT += dt;

  for (const c of S.cars) {
    c.cool = Math.max(0, c.cool - dt); c.flash = Math.max(0, c.flash - dt);
    if (!c.alive) {
      if (c.wreck > 0) {
        c.wreck -= dt;
        c.vx *= Math.exp(-2.2 * dt); c.vy *= Math.exp(-2.2 * dt);
        c.x += c.vx * dt; c.y += c.vy * dt; walls(S, c, dt, false);
        if (S.fxRng() < dt * 14) flame(S, c.x, c.y, 7);
        if (S.fxRng() < dt * 12) smoke(S, c.x, c.y, 10, true);
      }
      continue;
    }
    if (S.state === 'countdown') { c.vx = c.vy = 0; continue; }
    if (c.isPlayer && !c.auto) {
      c.steer = S.input.steer; c.throttle = S.input.thr; c.brake = S.input.brk; c.fire = S.input.fire;
      if (S.assist && S.state === 'race') assist(S, c);
    } else aiControl(S, c, dt);
    drive(c, dt);
    walls(S, c, dt, true);
    if (c.fire) tryFire(S, c);
    if (c.hp < 45 && S.fxRng() < dt * 9) smoke(S, c.x, c.y, 9, c.hp < 25);
    if (c.hp < 24 && S.fxRng() < dt * 14) flame(S, c.x, c.y, 8);
    if (!c.finished && !S.lab && c.prog >= LAPS * N) {
      c.finished = true; S.finishOrder.push(c); c.place = S.finishOrder.length; c.finishT = S.raceT;
      S.events.push({ t: 'finish', car: c });
      if (c.isPlayer) { c.auto = true; endRace(S, 'finish'); }
    }
  }

  // car vs car (wrecks are immovable)
  const cs = S.cars, R = 24;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    const sa = !a.alive, sb = !b.alive;
    if ((sa && a.wreck <= 0) || (sb && b.wreck <= 0) || (sa && sb)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= R || d < 0.01) continue;
    const nx = dx / d, ny = dy / d, ov = R - d;
    const ia = sa ? 0 : 1, ib = sb ? 0 : 1, tot = ia + ib;
    a.x -= nx * ov * ia / tot; a.y -= ny * ov * ia / tot; b.x += nx * ov * ib / tot; b.y += ny * ov * ib / tot;
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel < 0) {
      const jv = -(1.45) * rel / tot;
      a.vx -= jv * ia * nx; a.vy -= jv * ia * ny; b.vx += jv * ib * nx; b.vy += jv * ib * ny;
      const dmg = Math.max(0, -rel - 110) * 0.035;
      if (dmg > 0) { if (!sa) hurt(S, a, dmg, b); if (!sb) hurt(S, b, dmg, a); sparks(S, (a.x + b.x) / 2, (a.y + b.y) / 2, 6, 6, 150); if (a.isPlayer || b.isPlayer) S.events.push({ t: 'crash' }); }
    }
  }

  // crates
  for (const cr of S.crates) {
    if (cr.cd > 0) { cr.cd -= dt; continue; }
    for (const c of S.cars) {
      if (!c.alive || Math.hypot(c.x - cr.x, c.y - cr.y) > 22) continue;
      cr.cd = 11;
      const r = S.rng();
      let label;
      if (r < 0.2) { c.hp = Math.min(100, c.hp + 40); label = 'REPAIR +40'; }
      else {
        const type = r < 0.56 ? 'mg' : r < 0.8 ? 'rocket' : 'mine';
        if (c.weapon === type) c.ammo += WEAP[type].ammo; else { c.weapon = type; c.ammo = WEAP[type].ammo; }
        label = WEAP[type].name;
      }
      sparks(S, cr.x, cr.y, 10, 10, 120);
      S.events.push({ t: 'pickup', car: c, label, x: cr.x, y: cr.y });
      break;
    }
  }

  // bullets
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) for (const c of S.cars) {
      if (!c.alive || c === b.owner) continue;
      if (Math.hypot(c.x - b.x, c.y - b.y) < 14) {
        hurt(S, c, b.dmg, b.owner); sparks(S, b.x, b.y, 8, 4, 160); dead = true;
        if (c.isPlayer || b.owner.isPlayer) S.events.push({ t: 'hit', x: b.x, y: b.y });
        break;
      }
    }
    if (dead) S.bullets.splice(i, 1);
  }

  // rockets
  for (let i = S.rockets.length - 1; i >= 0; i--) {
    const r = S.rockets[i];
    let tgt = null, bd = 1e9;
    for (const c of S.cars) {
      if (!c.alive || c === r.owner) continue;
      const dx = c.x - r.x, dy = c.y - r.y, d = Math.hypot(dx, dy);
      if (d < 420 && Math.abs(angDiff(r.a, Math.atan2(dy, dx))) < 0.7 && d < bd) { bd = d; tgt = c; }
    }
    if (tgt) r.a += clamp(angDiff(r.a, Math.atan2(tgt.y - r.y, tgt.x - r.x)), -1.9 * dt, 1.9 * dt);
    r.x += Math.cos(r.a) * r.sp * dt; r.y += Math.sin(r.a) * r.sp * dt; r.life -= dt;
    if (S.fxRng() < dt * 60) smoke(S, r.x, r.y, 8, false);
    flame(S, r.x - Math.cos(r.a) * 8, r.y - Math.sin(r.a) * 8, 8);
    let boom = r.life <= 0;
    if (!boom) for (const c of S.cars) {
      if (c.alive && c !== r.owner && Math.hypot(c.x - r.x, c.y - r.y) < 16) { boom = true; break; }
    }
    if (!boom) {
      const ix = nearest(r.x, r.y, -1), d = (r.x - T.x[ix]) * T.nx[ix] + (r.y - T.y[ix]) * T.ny[ix];
      if (Math.abs(d) > HALF_W - 4) boom = true;
    }
    if (boom) { S.rockets.splice(i, 1); explode(S, r.x, r.y, 66, 32, r.owner); }
  }

  // mines
  for (let i = S.mines.length - 1; i >= 0; i--) {
    const m = S.mines[i]; m.arm -= dt; m.life -= dt;
    let boom = m.life <= 0;
    if (m.arm <= 0) for (const c of S.cars) if (c.alive && Math.hypot(c.x - m.x, c.y - m.y) < 22) { boom = true; break; }
    if (boom) { S.mines.splice(i, 1); explode(S, m.x, m.y, 64, 34, m.owner); }
  }

  // particles & rings
  for (let i = S.parts.length - 1; i >= 0; i--) {
    const p = S.parts[i];
    p.life -= dt; if (p.life <= 0) { S.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt; p.vh -= p.grav * dt;
    if (p.kind === 3 && p.h < 0) { p.h = 0; p.vh *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
    if (p.kind === 1) { p.vx *= 0.98; p.vy *= 0.98; }
  }
  for (let i = S.rings.length - 1; i >= 0; i--) { const r = S.rings[i]; r.t -= dt; if (r.t <= 0) S.rings.splice(i, 1); else r.r = r.max * (1 - r.t / r.life); }

  // end of race checks
  if (S.state === 'race' && !S.attract && !S.lab) {
    if (!P.alive) { S.deadT += dt; if (S.deadT > 1.8) endRace(S, 'wrecked'); }
    else if (S.cars.every(c => c === P || !c.alive)) endRace(S, 'last');
  }
}

function endRace(S, kind) {
  if (S.state !== 'race') return;
  const rank = ranking(S), P = S.player;
  S.state = 'over';
  S.result = { kind, place: rank.indexOf(P) + 1, kills: P.kills, time: kind === 'finish' ? P.finishT : S.raceT, total: S.cars.length };
  if (kind === 'last') S.result.place = 1;
  if (kind === 'finish') S.result.place = P.place;
  P.auto = true;
  S.events.push({ t: 'over', kind });
}

return { T, N, HALF_W, LAPS, STEP, SIM_VERSION, TUNE_LIMITS, makeConfig, configProblems, raceHeader, WEAP, create, reset, step, ranking, nearest, TAU, angDiff, clamp };
})();
export default Sim;
