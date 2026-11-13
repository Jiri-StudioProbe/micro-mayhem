// The decoration: toy blocks, planks and discs scattered on the felt beside the track. Placement is deterministic (a seeded
// generator), so the same props appear on every device. They are decorative only: nothing collides with them.
// Moved out of src/main.js in M0.6.

export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PROP_COLS = [[230, 80, 70], [250, 200, 60], [70, 130, 230], [245, 245, 240], [255, 140, 40], [120, 200, 120], [200, 110, 220]];

// Returns the list of props for a track. Each is { x, y, pts, h, col, side }: a footprint polygon, a height and two colours.
export function buildProps({ T, N, HALF_W }) {
  const props = [];
    const R = rng(7);
    let tries = 0;
    while (props.length < 170 && tries++ < 4000) {
      const i = Math.floor(R() * N), side = R() < 0.5 ? -1 : 1, off = HALF_W + 40 + R() * 300;
      const x = T.x[i] + T.nx[i] * side * off, y = T.y[i] + T.ny[i] * side * off;
      let ok = true;
      for (let k = 0; k < N; k++) { if (Math.hypot(T.x[k] - x, T.y[k] - y) < HALF_W + 46) { ok = false; break; } }
      if (!ok) continue;
      for (const q of props) if (Math.hypot(q.x - x, q.y - y) < 60) { ok = false; break; }
      if (!ok) continue;
      const kind = R(), a = R() * 6.283, col = PROP_COLS[Math.floor(R() * PROP_COLS.length)];
      let hw, hl, h, pts;
      if (kind < 0.35) { hw = hl = 10 + R() * 8; h = hw * 2; }
      else if (kind < 0.65) { hw = 4; hl = 22 + R() * 14; h = 8; }
      else if (kind < 0.85) { hw = 14 + R() * 12; hl = 12 + R() * 10; h = 8 + R() * 22; }
      else { hw = hl = 15; h = 4; }
      const f = Math.cos(a), s = Math.sin(a), tr = (lx, ly) => [x + f * lx - s * ly, y + s * lx + f * ly];
      pts = kind >= 0.85
        ? [tr(15, 0), tr(10.6, 10.6), tr(0, 15), tr(-10.6, 10.6), tr(-15, 0), tr(-10.6, -10.6), tr(0, -15), tr(10.6, -10.6)]
        : [tr(hl, -hw), tr(hl, hw), tr(-hl, hw), tr(-hl, -hw)];
      props.push({ x, y, pts, h, col, side: [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75] });
    }
  return props;
}
