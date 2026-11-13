// "Human models" that drive the player car headlessly. Used by the assist test and tools/driver-study.js.
export function makeDrivers(Sim) {
  const { T, N, angDiff, clamp } = Sim;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  // what a perfect human "wants": steer toward a point on the centre line ahead
  const want = c => { const sp = Math.hypot(c.vx, c.vy), i = c.idx, ti = (i + 3 + Math.floor(sp / 75)) % N; return angDiff(c.a, Math.atan2(T.y[ti] - c.y, T.x[ti] - c.x)); };
  return {
    // keys: binary steer, 0.1 s reaction, lifts off the gas in corners (a good desktop player)
    keyboard: { mk: () => ({ q: [] }), f: (c, m) => { const da = want(c); const s = Math.abs(da) < 0.06 ? 0 : Math.sign(da); m.q.push(s); if (m.q.length > 6) m.q.shift();
      const vf = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a); return { steer: m.q[0], thr: vf < T.vsafe[c.idx] * 1.12 ? 1 : 0, brk: 0 }; } },
    // thumb: analog, noisy, 0.2 s delay, understeers, gas always on (a phone player without assist)
    thumb: { mk: () => ({ q: [], n: 0 }), f: (c, m, dt) => { m.n += (gauss() * 0.35 - m.n) * Math.min(1, dt * 6); const da = want(c);
      m.q.push(clamp(da * 1.6 * 0.6 + m.n * 0.5, -1, 1)); if (m.q.length > 12) m.q.shift(); return { steer: m.q[0], thr: 1, brk: 0 }; } }
  };
}

// One race with the player driven by `model`. Returns the outcome.
export function runRace(Sim, drivers, model, { assist = false, lane, speed, maxSeconds = 240 } = {}) {
  const S = Sim.create(); Sim.reset(S, 'race'); S.player.auto = false; S.assist = assist;
  if (lane !== undefined) { S.tune.assistLane = lane; S.tune.assistSpeed = speed; }
  const P = S.player, m = drivers[model].mk(), dt = 1 / 60; let crashes = 0;
  for (let t = 0; t < maxSeconds && S.state !== 'over'; t += dt) {
    if (S.state === 'race') { const o = drivers[model].f(P, m, dt); S.input.steer = o.steer; S.input.thr = o.thr; S.input.brk = o.brk; S.input.fire = 0; }
    Sim.step(S, dt);
    for (const e of S.events) if (e.t === 'crash') crashes++;
    S.events.length = 0;
  }
  const r = S.result;
  return { kind: r && r.kind, place: r && r.place, time: r && r.kind === 'finish' ? r.time : null, crashes, hp: Math.round(P.hp) };
}
