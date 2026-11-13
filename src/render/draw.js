// Drawing helpers shared by the scene and the minimap: colours, the world-to-screen projection, polygons and extruded prisms.
// Moved out of src/main.js in M0.6; the screen metrics and the camera now come from the explicit `view` and `cam` objects.
import { clamp } from '../util.js';
import { K, TILT } from './view.js';

export const FELT = '#16342d';
export const ROAD = [66, 72, 87], ROAD2 = [58, 64, 79];
export const WALL_TOP = [238, 242, 247], WALL_SIDE = [190, 202, 218];
export const rgb = (c, f) => 'rgb(' + ((c[0] * f) | 0) + ',' + ((c[1] * f) | 0) + ',' + ((c[2] * f) | 0) + ')';

// Binds the helpers to a canvas context, the screen metrics (view) and the camera (cam). The helpers read view and cam on every call.
export function createDraw({ ctx, view, cam }) {
  function proj(wx, wy, h) {
    const dx = wx - cam.x, dy = wy - cam.y;
    const fwd = dx * cam.c + dy * cam.s, lat = -dx * cam.s + dy * cam.c;
    const p = 1 / (1 + fwd * K);
    return [view.W * 0.5 + lat * p * view.Z, view.baseY - (fwd * TILT + h) * p * view.Z, p, fwd];
  }
  function poly(pts, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function prism(pts, h0, h1, topCol, sideCol) {
    const n = pts.length; let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= n; cy /= n;
    const base = new Array(n), top = new Array(n);
    for (let i = 0; i < n; i++) { base[i] = proj(pts[i][0], pts[i][1], h0); top[i] = proj(pts[i][0], pts[i][1], h1); }
    const faces = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = pts[i], b = pts[j];
      let nx = b[1] - a[1], ny = a[0] - b[0];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (nx * (cam.x - mx) + ny * (cam.y - my) <= 0) continue;
      const fN = nx * cam.c + ny * cam.s, lN = -nx * cam.s + ny * cam.c;
      faces.push({ i, j, d: base[i][3] + base[j][3], f: clamp(0.8 - 0.22 * lN + 0.1 * fN, 0.5, 1.05) });
    }
    faces.sort((p, q) => q.d - p.d);
    for (const f of faces) poly([base[f.i], base[f.j], top[f.j], top[f.i]], rgb(sideCol, f.f), true);
    poly(top, rgb(topCol, 1), true);
  }
  return { proj, poly, prism };
}
