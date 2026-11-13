// Everything that decides a race, as one string, with exact numbers: the same seed must give bit-identical results.
// (Particles and rings are decoration and are left out.) Used by the determinism tests and the simulation-version fingerprints.
export const gameplay = S => JSON.stringify({
  state: S.state, raceT: S.raceT, cd: S.cd, result: S.result && { kind: S.result.kind, place: S.result.place, time: S.result.time, kills: S.result.kills },
  cars: S.cars.map(c => [c.x, c.y, c.a, c.vx, c.vy, c.hp, c.alive, c.weapon, c.ammo, c.prog, c.finished, c.place, c.kills, c.ai.skill, c.ai.aggr, c.ai.lane]),
  bullets: S.bullets.map(b => [b.x, b.y, b.life]), rockets: S.rockets.map(r => [r.x, r.y, r.a]), mines: S.mines.map(m => [m.x, m.y, m.arm]),
  crates: S.crates.map(c => c.cd)
});

// A scripted "human": the inputs are a pure function of the step number, so two runs get exactly the same inputs.
export const scripted = (S, k) => { S.input.steer = Math.sin(k / 25) * 0.8; S.input.thr = k % 400 < 330 ? 1 : 0; S.input.brk = k % 400 >= 330 ? 1 : 0; S.input.fire = k % 40 < 8 ? 1 : 0; };

// 32-bit FNV-1a of a string, as 8 hex digits.
export const fnv = str => { let h = 0x811C9DC5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
