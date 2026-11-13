// Player input: the keyboard, the on-screen BRAKE and FIRE buttons, and the floating drive joystick.
// It writes S.input (steer, thr, brk, fire) once a frame in readInput(), and nothing else in the simulation.
// The global key handler needs actions that live in other modules (start a race, mute, leave the lab), so it is registered by connect(),
// which the shell calls once everything exists; this is what keeps the modules from importing each other in a circle.
// Moved verbatim out of src/main.js in M0.7.
import { clamp } from './util.js';

export function createInput({ S, tune, initAudio, win = window, doc = document }) {
  const keys = new Set(), touch = new Set();
  const input = S.input;
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'fire', KeyF: 'fire', ShiftLeft: 'fire', ShiftRight: 'fire' };
  const padEl = doc.getElementById('pad');
  padEl.querySelectorAll('button').forEach(b => {
    const act = b.dataset.act;
    const on = e => { e.preventDefault(); touch.add(act); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) {} initAudio(); };
    const off = e => { touch.delete(act); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  });
  /* Drive joystick: the base re-centres on wherever the thumb lands in the left zone. */
  const stickZone = doc.getElementById('stickZone'), stickEl = doc.getElementById('stick'), knobEl = doc.getElementById('knob');
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  function stickMove(e) {
    const zr = stickZone.getBoundingClientRect();
    const h = stickEl.offsetWidth / 2;
    let dx = e.clientX - zr.left - stick.ox, dy = e.clientY - zr.top - stick.oy;
    const R = tune.radius, d = Math.hypot(dx, dy);
    if (d > R) {
      // the base trails the thumb, so reversing a flick never means travelling back across the whole stick
      const pull = (d - R) / d;
      stick.ox = Math.min(Math.max(stick.ox + dx * pull, h), zr.width - h);
      stick.oy = Math.min(Math.max(stick.oy + dy * pull, h), zr.height - h);
      stickEl.style.left = (stick.ox - h) + 'px'; stickEl.style.top = (stick.oy - h) + 'px';
      dx = e.clientX - zr.left - stick.ox; dy = e.clientY - zr.top - stick.oy;
      const d2 = Math.hypot(dx, dy);
      if (d2 > R) { dx *= R / d2; dy *= R / d2; }
    }
    const nx = dx / R, ny = dy / R, m = Math.hypot(nx, ny), dz = tune.dead;
    const k = m <= dz ? 0 : (m - dz) / (1 - dz) / m;   // <=, not <: with no dead zone, a thumb exactly at the centre would be 0 / 0 = NaN, and NaN steering makes the car's position NaN
    stick.x = nx * k; stick.y = ny * k;
    knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }
  function stickRelease() {
    stick.id = null; stick.x = stick.y = 0;
    stickEl.classList.remove('on'); stickEl.style.left = stickEl.style.top = stickEl.style.bottom = ''; knobEl.style.transform = '';
  }
  stickZone.addEventListener('pointerdown', e => {
    if (stick.id !== null) return;
    e.preventDefault(); initAudio();
    const zr = stickZone.getBoundingClientRect(), h = stickEl.offsetWidth / 2;
    stick.id = e.pointerId;
    stick.ox = Math.min(Math.max(e.clientX - zr.left, h), zr.width - h);
    stick.oy = Math.min(Math.max(e.clientY - zr.top, h), zr.height - h);
    stickEl.style.left = (stick.ox - h) + 'px'; stickEl.style.top = (stick.oy - h) + 'px'; stickEl.style.bottom = 'auto';
    stickEl.classList.add('on');
    try { stickZone.setPointerCapture(e.pointerId); } catch (_) {}
    stickMove(e);
  });
  stickZone.addEventListener('pointermove', e => { if (e.pointerId === stick.id) { e.preventDefault(); stickMove(e); } });
  const stickEnd = e => { if (e.pointerId === stick.id) stickRelease(); };
  stickZone.addEventListener('pointerup', stickEnd); stickZone.addEventListener('pointercancel', stickEnd); stickZone.addEventListener('lostpointercapture', stickEnd);
  stickZone.addEventListener('contextmenu', e => e.preventDefault());
  doc.addEventListener('touchmove', e => { if (!(e.target.closest && e.target.closest('.overlay, .tune'))) e.preventDefault(); }, { passive: false });
  if (win.matchMedia && win.matchMedia('(pointer: coarse)').matches) padEl.classList.add('avail');
  win.addEventListener('touchstart', () => padEl.classList.add('avail'), { once: true, passive: true });

  // The keyboard. actions = { overlayOpen(), startRace(), toggleMute(), exitLab() }; S.lab is read live.
  function connect(actions) {
    win.addEventListener('keydown', e => {
      const a = KEYMAP[e.code];
      if (e.code === 'Enter' || (e.code === 'Space' && actions.overlayOpen())) { if (actions.overlayOpen()) { e.preventDefault(); actions.startRace(); return; } }
      if (e.code === 'KeyM') { actions.toggleMute(); return; }
      if (e.code === 'Escape' && S.lab) { actions.exitLab(); return; }
      if (a) { e.preventDefault(); keys.add(a); initAudio(); }
    });
    win.addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) keys.delete(a); });
    win.addEventListener('blur', () => { keys.clear(); touch.clear(); stickRelease(); });
  }

  const has = a => keys.has(a) || touch.has(a);
  function readInput(dt) {
    const kb = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
    // stick steering: response curve, lock cap and speed damping (all tunable), keys stay binary
    const ax = Math.min(1, Math.abs(stick.x));
    let sx = Math.sign(stick.x) * Math.min(tune.maxLock, tune.gain * Math.pow(ax, tune.curve));
    if (sx) sx *= 1 - tune.speedDamp * clamp(Math.hypot(S.player.vx, S.player.vy) / 372, 0, 1);
    const target = kb || sx;
    const rate = kb ? (target === 0 ? 14 : 9) : tune.rate;   // a thumb is already a smooth input, so the stick needs less smoothing than a key press
    input.steer += (target - input.steer) * Math.min(1, dt * rate);
    if (Math.abs(input.steer) < 0.01) input.steer = 0;
    // left thumb down = foot down, always. Braking/reversing is the separate BRAKE button.
    input.thr = has('gas') || (stick.id !== null && !has('brake')) ? 1 : 0;
    input.brk = has('brake') ? 1 : 0;
    input.fire = has('fire') ? 1 : 0;
    S.tune.assistLane = tune.assistLane; S.tune.assistSpeed = tune.assistSpeed;
  }

  return { readInput, stickRelease, connect };
}
