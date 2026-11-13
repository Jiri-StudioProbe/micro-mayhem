// The track map in the corner of the HUD: the track outline is drawn once into an offscreen canvas, the cars are drawn on top each frame.
// Moved out of src/main.js in M0.6.
import { rgb } from './draw.js';

export function createMinimap({ canvas, S, T, N, doc = document }) {
  const mctx = canvas.getContext('2d'), MS = 200;
  const trackImg = doc.createElement('canvas'); trackImg.width = trackImg.height = MS;
  let mScale = 1, mOx = 0, mOy = 0;
  (function () {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); y0 = Math.min(y0, T.y[i]); y1 = Math.max(y1, T.y[i]); }
    const pad = 20; mScale = Math.min((MS - pad * 2) / (x1 - x0), (MS - pad * 2) / (y1 - y0));
    mOx = (MS - (x1 - x0) * mScale) / 2 - x0 * mScale; mOy = (MS - (y1 - y0) * mScale) / 2 - y0 * mScale;
    const g = trackImg.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= N; i++) { const k = i % N; const X = T.x[k] * mScale + mOx, Y = T.y[k] * mScale + mOy; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.closePath(); };
    path(); g.strokeStyle = 'rgba(239,233,216,.5)'; g.lineWidth = 11; g.stroke();
    path(); g.strokeStyle = '#1d2b28'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#efe9d8'; const sx = T.x[0] * mScale + mOx, sy = T.y[0] * mScale + mOy;
    g.save(); g.translate(sx, sy); g.rotate(T.ang[0]); g.fillRect(-1.5, -8, 3, 16); g.restore();
  })();
  function drawMini() {
    mctx.clearRect(0, 0, MS, MS); mctx.drawImage(trackImg, 0, 0);
    for (const c of S.cars) {
      const X = c.x * mScale + mOx, Y = c.y * mScale + mOy;
      if (!c.alive) { mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = 2; mctx.beginPath(); mctx.moveTo(X - 4, Y - 4); mctx.lineTo(X + 4, Y + 4); mctx.moveTo(X + 4, Y - 4); mctx.lineTo(X - 4, Y + 4); mctx.stroke(); continue; }
      mctx.beginPath(); mctx.arc(X, Y, c.isPlayer ? 8 : 5.5, 0, 6.283);
      mctx.fillStyle = rgb(c.color, 1); mctx.fill();
      if (c.isPlayer) { mctx.lineWidth = 3; mctx.strokeStyle = '#fff'; mctx.stroke(); }
    }
  }
  return { draw: drawMini };
}
