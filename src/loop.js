// The main loop: input, simulation steps, events, the camera, drawing, HUD and engine sound, once per animation frame.
// frame() re-arms requestAnimationFrame first and runs tick() inside try/catch, so one bad frame is logged and never stops the game.
// Moved verbatim out of src/main.js in M0.7.
export function createLoop({ S, step, reset, ranking, ctx, diag, canStepDown, stepDown, input, game, lab, hud, rig, fx, render, drawMini, audio, debugUpdate, requestFrame = cb => requestAnimationFrame(cb), now: clock = () => performance.now() }) {
  let last = clock(), attractT = 0;
  let ft = 16.7, lastAdj = clock() + 3000;
  function frame(now) {
    // Re-arm first: an exception later in the frame (canvas, audio, DOM) must never end the loop.
    requestFrame(frame);
    try { tick(now); }
    catch (e) {
      console.error(e); diag.record('frame', e);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (debugUpdate) debugUpdate(now, ft);
  }
  function tick(now) {
    const raw = now - last;
    // The sim must stay real-time on slow phones: up to 0.25 s is caught up in <=1/60 s sub-steps (the sim costs ~0.1 ms each).
    const dt = Math.min(0.25, raw / 1000); last = now;
    // Adaptive resolution: if frames are slow, drop the canvas resolution a step (never back up, to avoid flip-flopping).
    if (raw < 250) ft += (raw - ft) * 0.05;
    if (ft > 26 && canStepDown() && now - lastAdj > 2500) { stepDown(); lastAdj = now; }
    input.readInput(dt);
    const subs = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let k = 0; k < subs; k++) step(S, dt / subs);
    if (S.lab) lab.track();
    game.handleEvents();
    fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2.2);

    // attract mode: restart the demo when too few cars survive
    if (S.attract) {
      attractT += dt;
      if (S.cars.filter(c => c.alive).length < 3 || attractT > 70) { reset(S, 'attract'); attractT = 0; }
    }
    rig.follow(dt);

    render(dt);
    if (hud.visible()) { if (S.lab) lab.updateHud(); else hud.update(); drawMini(); }
    audio.engine(Math.hypot(S.player.vx, S.player.vy), S.input.thr, hud.visible() && S.player.alive && S.state !== 'over');
  }
  return { start() { requestFrame(frame); } };
}
