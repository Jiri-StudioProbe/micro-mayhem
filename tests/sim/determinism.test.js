import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../helpers/sim.js';
import { mulberry32, deriveSeed } from '../../src/sim/rng.js';

// Everything that decides a race, as one string, with exact numbers: the same seed must give bit-identical results.
// (Particles and rings are decoration and are checked separately.)
const gameplay = S => JSON.stringify({
  state: S.state, raceT: S.raceT, cd: S.cd, result: S.result && { kind: S.result.kind, place: S.result.place, time: S.result.time, kills: S.result.kills },
  cars: S.cars.map(c => [c.x, c.y, c.a, c.vx, c.vy, c.hp, c.alive, c.weapon, c.ammo, c.prog, c.finished, c.place, c.kills, c.ai.skill, c.ai.aggr, c.ai.lane]),
  bullets: S.bullets.map(b => [b.x, b.y, b.life]), rockets: S.rockets.map(r => [r.x, r.y, r.a]), mines: S.mines.map(m => [m.x, m.y, m.arm]),
  crates: S.crates.map(c => c.cd)
});
const events = [];
const DT = 1 / 60;

// A scripted "human": the inputs are a pure function of the step number, so two runs get exactly the same inputs.
const scripted = (S, k) => { S.input.steer = Math.sin(k / 25) * 0.8; S.input.thr = k % 400 < 330 ? 1 : 0; S.input.brk = k % 400 >= 330 ? 1 : 0; S.input.fire = k % 40 < 8 ? 1 : 0; };

// Runs a race and returns a fingerprint of the whole way through, not just the end.
function run(seed, { auto = true, steps = 60 * 70, mode = 'race', tweak } = {}) {
  const S = Sim.create(999); Sim.reset(S, mode, seed); S.player.auto = auto;
  if (tweak) tweak(S);
  const trail = [];
  for (let k = 0; k < steps && S.state !== 'over'; k++) {
    if (!auto) scripted(S, k);
    Sim.step(S, DT);
    for (const e of S.events) events.push(e.t);
    S.events.length = 0;
    if (k % 120 === 0) trail.push(gameplay(S));
  }
  trail.push(gameplay(S));
  return { S, trail, events: events.splice(0) };
}

test('the same seed and the same inputs play out the same race, step for step (autopilot)', () => {
  const a = run(12345), b = run(12345);
  assert.deepEqual(a.trail, b.trail);
  assert.deepEqual(a.events, b.events);
  assert.ok(a.trail.length > 10, 'the race ran for a while');
});

test('the same seed and the same inputs play out the same race, step for step (a scripted human driver)', () => {
  const a = run(777, { auto: false }), b = run(777, { auto: false });
  assert.deepEqual(a.trail, b.trail);
  assert.deepEqual(a.events, b.events);
});

test('different seeds give different races', () => {
  const finals = new Set(); const skills = new Set();
  for (let seed = 1; seed <= 12; seed++) { const r = run(seed, { steps: 60 * 20 }); finals.add(r.trail.at(-1)); skills.add(r.S.cars[1].ai.skill); }
  assert.equal(finals.size, 12, 'every seed plays out differently');
  assert.equal(skills.size, 12, 'and the AI drivers get different characters');
});

test('a race is a function of its seed alone: resetting a used sim gives the same race as a fresh one', () => {
  const fresh = run(31337).trail;
  const S = Sim.create(1); Sim.reset(S, 'race', 5); S.player.auto = true;
  for (let k = 0; k < 600; k++) { Sim.step(S, DT); S.events.length = 0; }   // dirty it: a race in progress
  S.input.steer = 1; S.input.thr = 1; S.input.fire = 1;
  Sim.reset(S, 'race', 31337); S.player.auto = true; S.input.steer = S.input.thr = S.input.brk = S.input.fire = 0;
  const trail = [];
  for (let k = 0; k < 60 * 70 && S.state !== 'over'; k++) { Sim.step(S, DT); S.events.length = 0; if (k % 120 === 0) trail.push(gameplay(S)); }
  trail.push(gameplay(S));
  assert.deepEqual(trail, fresh, 'nothing leaks from the previous race');
});

test('a session is reproducible: the same master seed gives the same sequence of race seeds and races', () => {
  const session = master => { const S = Sim.create(master); const seeds = []; for (let i = 0; i < 4; i++) { Sim.reset(S, 'race'); seeds.push(S.seed); for (let k = 0; k < 120; k++) { Sim.step(S, DT); S.events.length = 0; } seeds.push(gameplay(S)); } return seeds; };
  assert.deepEqual(session(42), session(42));
  assert.notDeepEqual(session(42), session(43));
  const S = Sim.create(42); Sim.reset(S, 'race'); const s1 = S.seed; Sim.reset(S, 'race'); assert.notEqual(S.seed, s1, 'each reset draws a new seed');
  Sim.reset(S, 'race', 9); assert.equal(S.seed, 9, 'an explicit seed is used as given and recorded');
  assert.notEqual(S.rng(), S.fxRng(), 'the gameplay and decoration streams are different streams');
});

test('decoration cannot change the race: a different (even constant) particle stream gives the identical gameplay', () => {
  const base = run(2024), other = run(2024, { tweak: S => { S.fxRng = mulberry32(777); } }), constant = run(2024, { tweak: S => { S.fxRng = () => 0.5; } });
  assert.deepEqual(other.trail, base.trail);
  assert.deepEqual(constant.trail, base.trail);
  assert.deepEqual(other.events, base.events);
  // ...while the decoration itself really did differ, so the test is not vacuous
  assert.notDeepEqual(other.S.parts.slice(0, 20).map(p => p.x), base.S.parts.slice(0, 20).map(p => p.x));
});

test('the simulation never asks for Math.random, in any mode', () => {
  const real = Math.random; let calls = 0;
  Math.random = () => { calls++; return real(); };
  try {
    for (const mode of ['race', 'lab', 'attract']) { const S = Sim.create(3); Sim.reset(S, mode, 4); for (let k = 0; k < 60 * 30; k++) { Sim.step(S, DT); S.events.length = 0; } }
  } finally { Math.random = real; }
  assert.equal(calls, 0);
});

test('the two streams are assigned correctly: reset draws only from the gameplay stream, and each stream starts where it should', () => {
  const S = Sim.create(1); Sim.reset(S, 'race', 77);
  const gameplayStream = mulberry32(deriveSeed(77, 1)), decorationStream = mulberry32(deriveSeed(77, 2));
  assert.equal(S.fxRng(), decorationStream(), 'reset used nothing from the decoration stream, which is the stream derived with salt 2');
  assert.notEqual(S.rng(), gameplayStream(), 'reset did draw from the gameplay stream (the AI characters)');
});

test('decoration (smoke, flames) draws only from the decoration stream: in the lab nothing else draws, so the gameplay stream stays untouched', () => {
  const S = Sim.create(1); Sim.reset(S, 'lab', 5);   // the lab has no rivals, crates or weapons: no gameplay randomness at all
  let gameplayDraws = 0, decorationDraws = 0;
  const g = S.rng, f = S.fxRng; S.rng = () => { gameplayDraws++; return g(); }; S.fxRng = () => { decorationDraws++; return f(); };
  S.player.hp = 20;                                      // smoking and flaming (alive but badly hurt)
  S.rockets.push({ x: S.player.x + 300, y: S.player.y, a: 0, sp: 260, life: 5, owner: S.player });   // a rocket's smoke trail
  for (let k = 0; k < 60 * 3; k++) { S.player.hp = 20; Sim.step(S, DT); S.events.length = 0; }
  assert.ok(decorationDraws > 50, `smoke and flames were drawn (${decorationDraws} draws)`);
  assert.equal(gameplayDraws, 0, 'and none of them touched the gameplay stream');
  S.player.alive = false; S.player.wreck = 7;            // a burning wreck
  for (let k = 0; k < 60 * 2; k++) { Sim.step(S, DT); S.events.length = 0; }
  assert.equal(gameplayDraws, 0, 'a burning wreck neither');
});

test('explosions and debris draw only from the decoration stream either (a rival is blown up with the gameplay randomness quietened)', () => {
  const S = Sim.create(1); Sim.reset(S, 'race', 8); S.state = 'race'; S.player.auto = false;
  for (const c of S.cars.slice(1)) { c.ai.laneT = 1e9; c.weapon = null; c.ammo = 0; }   // no lane changes, no shooting: the AI draws nothing
  let gameplayDraws = 0, decorationDraws = 0;
  const g = S.rng, f = S.fxRng; S.rng = () => { gameplayDraws++; return g(); }; S.fxRng = () => { decorationDraws++; return f(); };
  const victim = S.cars[1]; victim.hp = 5;
  S.mines.push({ x: victim.x, y: victim.y, owner: S.player, arm: 0, life: 30 });
  for (let k = 0; k < 30; k++) { Sim.step(S, DT); S.events.length = 0; }
  assert.equal(victim.alive, false, 'the rival was destroyed (this is the situation under test)');
  assert.ok(decorationDraws > 100, `the blast and the debris drew decoration numbers (${decorationDraws})`);
  assert.equal(gameplayDraws, 0, 'and not one gameplay number');
});
