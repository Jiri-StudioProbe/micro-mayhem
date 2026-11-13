// Render interpolation. The simulation moves in fixed steps; the screen refreshes at its own rate. To draw what is between two steps,
// snapshot() records where everything was before each step, apply(alpha) moves every moving thing to the point alpha of the way from
// there to where it is now, and restore() puts the real state back, so the simulation never sees an interpolated value.
// Things that appeared during the last step have no earlier position and are drawn where they are.
export function createInterp({ S, angDiff }) {
  const swapped = [];   // [object, kind] pairs of what apply() moved: kind 0 = x, y;  1 = x, y, angle;  2 = x, y, height
  function snapshotList(list, kind) {
    for (const o of list) { o.px = o.x; o.py = o.y; if (kind === 1) o.pa = o.a; else if (kind === 2) o.ph = o.h; }
  }
  function applyList(list, kind, alpha) {
    for (const o of list) {
      if (o.px === undefined) continue;
      o.tx = o.x; o.ty = o.y;
      o.x = o.px + (o.x - o.px) * alpha; o.y = o.py + (o.y - o.py) * alpha;
      if (kind === 1) { o.ta = o.a; o.a = o.pa + angDiff(o.pa, o.a) * alpha; }
      else if (kind === 2) { o.th = o.h; o.h = o.ph + (o.h - o.ph) * alpha; }
      swapped.push(o, kind);
    }
  }
  return {
    snapshot() { snapshotList(S.cars, 1); snapshotList(S.bullets, 0); snapshotList(S.rockets, 1); snapshotList(S.parts, 2); },
    apply(alpha) { applyList(S.cars, 1, alpha); applyList(S.bullets, 0, alpha); applyList(S.rockets, 1, alpha); applyList(S.parts, 2, alpha); },
    restore() {
      for (let i = 0; i < swapped.length; i += 2) {
        const o = swapped[i], kind = swapped[i + 1];
        o.x = o.tx; o.y = o.ty;
        if (kind === 1) o.a = o.ta; else if (kind === 2) o.h = o.th;
      }
      swapped.length = 0;
    }
  };
}
