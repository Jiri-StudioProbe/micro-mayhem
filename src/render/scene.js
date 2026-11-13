// The scene: everything drawn on the main canvas each frame, back to front (felt, track, walls, props, cars, crates, mines, rockets,
// shockwaves, bullets, particles, fog, damage flash). Moved out of src/main.js in M0.6.
// The drawing functions use the screen metrics as plain local variables, refreshed once at the top of render(); a frame is
// synchronous, so they cannot change mid-frame.
import { K, TILT } from './view.js';
import { FELT, ROAD, ROAD2, WALL_TOP, WALL_SIDE, rgb } from './draw.js';

// S is the simulation state; fx holds the screen effects the shell controls (fx.hurtFlash, 0 to 1); `draw` is from createDraw.
export function createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion }) {
  const { proj, poly, prism } = draw;
  const RM = reducedMotion;
  let W = 0, H = 0, DPR = 1, Z = 1, baseY = 0;
  let frameNo = 0;
  const stamp = new Int32Array(N), PL = new Array(N), PR = new Array(N), KL = new Array(N), KR = new Array(N);
  function ensure(i) {
    if (stamp[i] === frameNo) return; stamp[i] = frameNo;
    const x = T.x[i], y = T.y[i], nx = T.nx[i], ny = T.ny[i];
    PL[i] = proj(x - nx * HALF_W, y - ny * HALF_W, 0); PR[i] = proj(x + nx * HALF_W, y + ny * HALF_W, 0);
    KL[i] = proj(x - nx * (HALF_W - 14), y - ny * (HALF_W - 14), 0); KR[i] = proj(x + nx * (HALF_W - 14), y + ny * (HALF_W - 14), 0);
  }
  const vis = [], objs = [];
  function drawWallSeg(i) {
    const j = (i + 1) % N;
    for (let sg = -1; sg <= 1; sg += 2) {
      const A = [T.x[i] + T.nx[i] * sg * HALF_W, T.y[i] + T.ny[i] * sg * HALF_W], B = [T.x[j] + T.nx[j] * sg * HALF_W, T.y[j] + T.ny[j] * sg * HALF_W];
      const C = [T.x[j] + T.nx[j] * sg * (HALF_W + 9), T.y[j] + T.ny[j] * sg * (HALF_W + 9)], D = [T.x[i] + T.nx[i] * sg * (HALF_W + 9), T.y[i] + T.ny[i] * sg * (HALF_W + 9)];
      prism([A, B, C, D], 0, 13, WALL_TOP, WALL_SIDE);
    }
  }
  function drawCar(c) {
    const f = Math.cos(c.a), s = Math.sin(c.a);
    const tr = (lx, ly) => [c.x + f * lx - s * ly, c.y + s * lx + f * ly];
    const dead = !c.alive;
    let body = dead ? [48, 44, 44] : c.color;
    if (c.flash > 0) { const m = c.flash / 0.14; body = [body[0] + (255 - body[0]) * m, body[1] + (255 - body[1]) * m, body[2] + (255 - body[2]) * m]; }
    // shadow
    const sh = [tr(16, -9), tr(16, 9), tr(-16, 9), tr(-16, -9)].map(p => proj(p[0], p[1], 0));
    const so = sh[0][2] * Z;
    ctx.beginPath(); sh.forEach((p, i) => i ? ctx.lineTo(p[0] + 4 * so, p[1] + 3 * so) : ctx.moveTo(p[0] + 4 * so, p[1] + 3 * so)); ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();
    // wheels
    for (const w of [[9, -8.5], [9, 8.5], [-9, -8.5], [-9, 8.5]]) prism([tr(w[0] - 3.4, w[1] - 1.7), tr(w[0] + 3.4, w[1] - 1.7), tr(w[0] + 3.4, w[1] + 1.7), tr(w[0] - 3.4, w[1] + 1.7)], 0, 5.5, [26, 26, 30], [16, 16, 20]);
    // chassis, cabin, spoiler
    prism([tr(15, -4), tr(11, -8), tr(-13, -8), tr(-15, -6), tr(-15, 6), tr(-13, 8), tr(11, 8), tr(15, 4)], 2, 7, body, body);
    if (!dead) {
      const st = [tr(14.5, -1.4), tr(14.5, 1.4), tr(-14, 1.4), tr(-14, -1.4)].map(p => proj(p[0], p[1], 7.05));
      poly(st, 'rgba(255,255,255,.85)');
    }
    prism([tr(5, -5), tr(5, 5), tr(-7, 5.6), tr(-7, -5.6)], 7, 12, dead ? [30, 28, 28] : [86, 112, 150], dead ? [24, 22, 22] : [34, 44, 64]);
    prism([tr(-14.5, -8.5), tr(-11.5, -8.5), tr(-11.5, 8.5), tr(-14.5, 8.5)], 7, 10.5, body, body);
    if (!dead) {
      for (const ly of [-5.5, 5.5]) { const hp = proj(tr(15.5, ly)[0], tr(15.5, ly)[1], 5); ctx.fillStyle = '#fff6c8'; const r = 1.9 * hp[2] * Z; ctx.fillRect(hp[0] - r, hp[1] - r, r * 2, r * 2); }
      for (const ly of [-6, 6]) { const tp = tr(-15.5, ly), hp = proj(tp[0], tp[1], 5); ctx.fillStyle = '#ff2d20'; const r = 1.5 * hp[2] * Z; ctx.fillRect(hp[0] - r, hp[1] - r, r * 2, r * 2); }
    }
    if (!dead && c.isPlayer) {
      const m = proj(c.x, c.y, 30 + Math.sin(S.t * 6) * 1.5), q = 5.5 * m[2] * Z;
      ctx.beginPath(); ctx.moveTo(m[0] - q, m[1] - q * 1.1); ctx.lineTo(m[0] + q, m[1] - q * 1.1); ctx.lineTo(m[0], m[1] + q * 0.5); ctx.closePath();
      ctx.fillStyle = '#ffd640'; ctx.fill(); ctx.strokeStyle = '#0c1816'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (!dead && !c.isPlayer) {
      const b = proj(c.x, c.y, 27), w = 32 * b[2] * Z, h = 4 * b[2] * Z + 1;
      ctx.fillStyle = 'rgba(8,16,14,.75)'; ctx.fillRect(b[0] - w / 2 - 1, b[1] - h - 1, w + 2, h + 2);
      ctx.fillStyle = c.hp > 55 ? '#5ec8f2' : c.hp > 28 ? '#ffd640' : '#ff5a36'; ctx.fillRect(b[0] - w / 2, b[1] - h, w * c.hp / 100, h);
    }
  }
  function drawCrate(cr) {
    const bob = Math.sin(S.t * 3 + cr.idx) * 2.5, a = S.t * 1.4 + cr.idx, f = Math.cos(a), s = Math.sin(a), r = 8.5;
    const g = proj(cr.x, cr.y, 0);
    ctx.beginPath(); ctx.ellipse(g[0], g[1], Math.max(0, 17 * g[2] * Z), Math.max(0, 17 * g[2] * Z * TILT), 0, 0, 6.283);
    ctx.strokeStyle = 'rgba(255,214,64,.55)'; ctx.lineWidth = 2; ctx.stroke();
    prism([[cr.x + f * r - s * r, cr.y + s * r + f * r], [cr.x - f * r - s * r, cr.y - s * r + f * r], [cr.x - f * r + s * r, cr.y - s * r - f * r], [cr.x + f * r + s * r, cr.y + s * r - f * r]], 6 + bob, 19 + bob, [255, 214, 64], [214, 160, 30]);
    const t = proj(cr.x, cr.y, 19 + bob); ctx.fillStyle = '#3a2a00'; ctx.font = '700 ' + Math.max(8, 13 * t[2] * Z) + 'px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', t[0], t[1]);
  }
  function drawMine(m) {
    const g = proj(m.x, m.y, 2), rr = Math.max(0, 10 * g[2] * Z);
    ctx.beginPath(); ctx.ellipse(g[0], g[1], rr, rr * TILT, 0, 0, 6.283); ctx.fillStyle = '#23262c'; ctx.fill(); ctx.strokeStyle = '#6a707c'; ctx.lineWidth = 2; ctx.stroke();
    const on = m.arm <= 0 ? (Math.sin(S.t * 8) > 0) : (Math.sin(S.t * 24) > 0);
    ctx.beginPath(); ctx.arc(g[0], g[1] - 2 * g[2] * Z, Math.max(0, 2.6 * g[2] * Z), 0, 6.283); ctx.fillStyle = on ? '#ff3b2a' : '#5a1a14'; ctx.fill();
  }
  function drawRocket(r) {
    const f = Math.cos(r.a), s = Math.sin(r.a), tr = (lx, ly) => [r.x + f * lx - s * ly, r.y + s * lx + f * ly];
    prism([tr(8, -2.2), tr(8, 2.2), tr(-8, 2.2), tr(-8, -2.2)], 5, 9.5, [255, 140, 40], [220, 90, 30]);
    const g = proj(r.x, r.y, 8); ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(0, 9 * g[2] * Z), 0, 6.283); ctx.fillStyle = 'rgba(255,170,60,.3)'; ctx.fill();
  }

  function render(dt) {
    frameNo++;
  ({ W, H, DPR, Z, baseY } = view);   // this frame's copy of the screen metrics
    const sh = RM ? 0 : S.shake * S.shake;
    cam.shx = (Math.random() - 0.5) * 22 * sh; cam.shy = (Math.random() - 0.5) * 22 * sh;
    cam.c = Math.cos(cam.a); cam.s = Math.sin(cam.a);
    ctx.setTransform(DPR, 0, 0, DPR, cam.shx * DPR, cam.shy * DPR);
    ctx.fillStyle = FELT; ctx.fillRect(-30, -30, W + 60, H + 60);

    // stitch dots on the felt
    const G = 90, r = 1000, gx0 = Math.floor((cam.x - r) / G), gx1 = Math.ceil((cam.x + r) / G), gy0 = Math.floor((cam.y - r) / G), gy1 = Math.ceil((cam.y + r) / G);
    ctx.fillStyle = 'rgba(130,200,170,.2)';
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const dx = gx * G - cam.x, dy = gy * G - cam.y, fwd = dx * cam.c + dy * cam.s;
      if (fwd < -260 || fwd > 1000) continue;
      const lat = -dx * cam.s + dy * cam.c; if (Math.abs(lat) > 800) continue;
      const p = 1 / (1 + fwd * K), z = 2.4 * p * Z;
      ctx.fillRect(W * 0.5 + lat * p * Z - z / 2, baseY - fwd * TILT * p * Z - z / 2, z, z);
    }

    // visible track segments
    vis.length = 0;
    for (let i = 0; i < N; i++) {
      const dx = T.x[i] - cam.x, dy = T.y[i] - cam.y, fwd = dx * cam.c + dy * cam.s;
      if (fwd < -300 || fwd > 1050) continue;
      if (Math.abs(-dx * cam.s + dy * cam.c) > 1150) continue;
      vis.push(i);
    }
    for (const i of vis) { ensure(i); ensure((i + 1) % N); }
    for (const i of vis) { const j = (i + 1) % N; poly([PL[i], PR[i], PR[j], PL[j]], rgb(ROAD, 1), true); }
    for (const i of vis) if ((i >> 2) & 1) { const j = (i + 1) % N; poly([PL[i], PR[i], PR[j], PL[j]], rgb(ROAD2, 1), true); }
    for (const i of vis) {
      const j = (i + 1) % N, red = (i >> 1) & 1, col = red ? 'rgb(222,70,60)' : 'rgb(238,232,216)';
      poly([KL[i], PL[i], PL[j], KL[j]], col, true); poly([KR[i], PR[i], PR[j], KR[j]], col, true);
    }
    ctx.fillStyle = 'rgba(238,232,216,.8)';
    for (const i of vis) if ((i & 3) < 2) {
      const j = (i + 1) % N;
      poly([proj(T.x[i] - T.nx[i] * 1.8, T.y[i] - T.ny[i] * 1.8, 0), proj(T.x[i] + T.nx[i] * 1.8, T.y[i] + T.ny[i] * 1.8, 0), proj(T.x[j] + T.nx[j] * 1.8, T.y[j] + T.ny[j] * 1.8, 0), proj(T.x[j] - T.nx[j] * 1.8, T.y[j] - T.ny[j] * 1.8, 0)], 'rgba(238,232,216,.8)');
    }
    for (let row = 0; row < 2; row++) {
      const i = row, j = row + 1;
      const dx = T.x[i] - cam.x, dy = T.y[i] - cam.y, fwd = dx * cam.c + dy * cam.s;
      if (fwd < -300 || fwd > 1050) continue;
      const cells = 12, w = (HALF_W - 14) * 2 / cells;
      for (let c = 0; c < cells; c++) {
        const a = -(HALF_W - 14) + c * w, b = a + w;
        poly([proj(T.x[i] + T.nx[i] * a, T.y[i] + T.ny[i] * a, 0), proj(T.x[i] + T.nx[i] * b, T.y[i] + T.ny[i] * b, 0), proj(T.x[j] + T.nx[j] * b, T.y[j] + T.ny[j] * b, 0), proj(T.x[j] + T.nx[j] * a, T.y[j] + T.ny[j] * a, 0)], ((c + row) & 1) ? 'rgb(28,32,38)' : 'rgb(244,242,234)', true);
      }
    }

    // sorted objects
    objs.length = 0;
    const dep = (x, y) => (x - cam.x) * cam.c + (y - cam.y) * cam.s;
    for (const i of vis) objs.push({ d: dep((T.x[i] + T.x[(i + 1) % N]) / 2, (T.y[i] + T.y[(i + 1) % N]) / 2), t: 0, o: i });
    for (const p of props) { const d = dep(p.x, p.y); if (d > -240 && d < 1050 && Math.abs(-(p.x - cam.x) * cam.s + (p.y - cam.y) * cam.c) < 1100) objs.push({ d, t: 1, o: p }); }
    for (const c of S.cars) if (c.alive || c.wreck > 0) { const d = dep(c.x, c.y); if (d > -260 && d < 1050) objs.push({ d, t: 2, o: c }); }
    for (const cr of S.crates) if (cr.cd <= 0) { const d = dep(cr.x, cr.y); if (d > -260 && d < 1050) objs.push({ d, t: 3, o: cr }); }
    for (const m of S.mines) { const d = dep(m.x, m.y); if (d > -260 && d < 1050) objs.push({ d: d + 6, t: 4, o: m }); }
    for (const rk of S.rockets) { const d = dep(rk.x, rk.y); if (d > -260 && d < 1050) objs.push({ d, t: 5, o: rk }); }
    objs.sort((a, b) => b.d - a.d);
    for (const ob of objs) {
      switch (ob.t) {
        case 0: drawWallSeg(ob.o); break;
        case 1: prism(ob.o.pts, 0, ob.o.h, ob.o.col, ob.o.side); break;
        case 2: drawCar(ob.o); break;
        case 3: drawCrate(ob.o); break;
        case 4: drawMine(ob.o); break;
        case 5: drawRocket(ob.o); break;
      }
    }

    // shockwaves
    for (const rg of S.rings) {
      const g = proj(rg.x, rg.y, 2);
      if (g[3] < -260 || g[3] > 1050) continue;   // behind/far from the camera the perspective scale goes negative
      const rr = Math.max(0, rg.r * g[2] * Z);
      ctx.beginPath(); ctx.ellipse(g[0], g[1], rr, rr * TILT, 0, 0, 6.283);
      ctx.strokeStyle = 'rgba(255,230,180,' + (0.7 * rg.t / rg.life) + ')'; ctx.lineWidth = 4 * (rg.t / rg.life) + 1; ctx.stroke();
    }
    // bullets
    ctx.lineCap = 'round';
    for (const b of S.bullets) {
      const a = proj(b.x, b.y, 8), c = proj(b.x - b.vx * 0.022, b.y - b.vy * 0.022, 8);
      ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = Math.max(1.5, 2.6 * a[2] * Z);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
    // particles
    for (const p of S.parts) {
      const g = proj(p.x, p.y, p.h); if (g[3] < -280 || g[3] > 1050) continue;
      const t = p.life / p.max;
      let sz = p.size * g[2] * Z;
      if (p.kind === 1) { sz *= 1.4 - t * 0.6; ctx.globalAlpha = 0.5 * t; }
      else if (p.kind === 2) { sz *= 0.35 + t * 0.8; ctx.globalAlpha = Math.min(0.8, t * 1.2); ctx.globalCompositeOperation = 'lighter'; }
      else ctx.globalAlpha = Math.min(1, t * 2);
      ctx.fillStyle = 'rgb(' + (p.r | 0) + ',' + (p.g | 0) + ',' + (p.b | 0) + ')';
      if (p.kind === 1 || p.kind === 2) { ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(0, sz), 0, 6.283); ctx.fill(); }
      else ctx.fillRect(g[0] - sz / 2, g[1] - sz / 2, sz, sz);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    // distance fade
    const gr = ctx.createLinearGradient(0, 0, 0, H * 0.42);
    gr.addColorStop(0, 'rgba(22,52,45,1)'); gr.addColorStop(0.45, 'rgba(22,52,45,.55)'); gr.addColorStop(1, 'rgba(22,52,45,0)');
    ctx.fillStyle = gr; ctx.fillRect(-30, -30, W + 60, H * 0.42 + 30);

    // damage flash
    if (fx.hurtFlash > 0.01) {
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      v.addColorStop(0, 'rgba(255,60,40,0)'); v.addColorStop(1, 'rgba(255,60,40,' + (fx.hurtFlash * 0.5) + ')');
      ctx.fillStyle = v; ctx.fillRect(-30, -30, W + 60, H + 60);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return { render };
}
