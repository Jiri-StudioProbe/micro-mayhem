// The main loop: input, fixed simulation steps, events, the camera, drawing, HUD and engine sound, once per animation frame.
// frame() re-arms requestAnimationFrame first and runs tick() inside try/catch, so one bad frame is logged and never stops the game.
// The simulation advances in fixed steps of STEP seconds (M1.2), however long the frames are: a 120 Hz screen gets a step every other frame,
// a slow phone several steps in one, and the renderer draws the moment between two steps by interpolation (src/interp.js).
import { createStepper } from './stepper.js';

export function createLoop({ S, STEP, step, reset, ranking, ctx, diag, canStepDown, stepDown, input, game, lab, hud, rig, interp, fx, render, drawMini, audio, debugUpdate, requestFrame = cb => requestAnimationFrame(cb), now: clock = () => performance.now() }) {
  const stepper = createStepper({ STEP });
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
    const dt = Math.min(0.25, raw / 1000); last = now;
    // Adaptive resolution: if frames are slow, drop the canvas resolution a step (never back up, to avoid flip-flopping).
    if (raw < 250) ft += (raw - ft) * 0.05;
    if (ft > 26 && canStepDown() && now - lastAdj > 2500) { stepDown(); lastAdj = now; }
    // The sim stays real-time on slow phones: up to 0.25 s is caught up in fixed steps (each costs ~0.1 ms). Input is read once per step,
    // so how the controls feel does not depend on the frame rate either.
    const { steps, alpha } = stepper.advance(dt, () => { interp.snapshot(); input.readInput(STEP); step(S, STEP); });
    if (S.lab) lab.track();
    game.handleEvents();
    fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2.2);

    // attract mode: restart the demo when too few cars survive
    if (S.attract) {
      attractT += steps * STEP;
      if (S.cars.filter(c => c.alive).length < 3 || attractT > 70) { reset(S, 'attract'); attractT = 0; }
    }
    // Draw the moment between the last two steps. The camera follows the interpolated car; the real state is always put back.
    interp.apply(alpha);
    try { rig.follow(dt); render(dt); } finally { interp.restore(); }
    if (hud.visible()) { if (S.lab) lab.updateHud(); else hud.update(); drawMini(); }
    audio.engine(Math.hypot(S.player.vx, S.player.vy), S.input.thr, hud.visible() && S.player.alive && S.state !== 'over');
  }
  return { start() { requestFrame(frame); } };
}
