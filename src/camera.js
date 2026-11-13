// The camera rig: which car the camera follows, and how it eases towards it each frame.
// Moved verbatim out of src/main.js in M0.7.
export function createCameraRig({ S, cam, ranking, angDiff }) {
  let focus = S.player;
  // Snap to the player (the start of a race).
  function reset() { cam.x = S.player.x; cam.y = S.player.y; cam.a = S.player.a; focus = S.player; }
  function follow(dt) {
    let target = S.player;
    if (S.attract || (!S.player.alive && S.state === 'over')) { const r = ranking(S); target = r.find(c => c.alive) || r[0]; }
    if (target !== focus) { focus = target; cam.x = target.x; cam.y = target.y; cam.a = target.a; }
    const kp = 1 - Math.exp(-16 * dt), ka = 1 - Math.exp(-5 * dt);
    cam.x += (target.x + target.vx * 0.075 - cam.x) * kp; cam.y += (target.y + target.vy * 0.075 - cam.y) * kp;
    cam.a += angDiff(cam.a, target.a) * ka;
  }
  return { reset, follow };
}
