// The screen metrics and the camera, shared by the renderer and the main loop as two explicit objects instead of loose variables.
//   view: W, H (CSS pixels), DPR (canvas pixels per CSS pixel), Z (zoom), baseY (screen y of the camera's ground point), resStep
//   cam:  x, y, a (world position and heading), c, s (cos and sin of a), shx, shy (screen shake offset)
// Moved out of src/main.js in M0.6.
import { clamp } from '../util.js';

export const K = 0.0011, TILT = 0.66;      // perspective strength; how far the ground is squashed (lower is flatter)
// Canvas resolution steps. Slow devices step down automatically (the main loop decides when); phones start capped at 1.5x.
export const RES_STEPS = [1, 0.75, 0.55];

export function createView({ canvas, coarse, startCam, getDevicePixelRatio = () => window.devicePixelRatio }) {
  const view = { W: 0, H: 0, DPR: 1, Z: 1, baseY: 0, resStep: 0 };
  const cam = { x: startCam.x, y: startCam.y, a: startCam.a, c: 1, s: 0, shx: 0, shy: 0 };

  function resize() {
    view.DPR = Math.min(coarse ? 1.5 : 2, getDevicePixelRatio() || 1) * RES_STEPS[view.resStep];
    view.W = canvas.clientWidth; view.H = canvas.clientHeight;
    canvas.width = Math.round(view.W * view.DPR); canvas.height = Math.round(view.H * view.DPR);
    // short (landscape phone) screens zoom in a little so the track and cars aren't tiny
    view.Z = clamp(Math.min(view.W / 400, view.H / (500 - 70 * clamp((500 - view.H) / 110, 0, 1))), 0.7, 2.1);
    view.baseY = view.H * 0.77;
  }
  const canStepDown = () => view.resStep < RES_STEPS.length - 1;
  // One step lower canvas resolution (never back up, to avoid flip-flopping). Returns false when already at the lowest.
  function stepDown() { if (!canStepDown()) return false; view.resStep++; resize(); return true; }
  resize();
  return { view, cam, resize, canStepDown, stepDown };
}
