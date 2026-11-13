// The fixed-step clock. Real time arrives in uneven frames (a 60 Hz screen, a 120 Hz one, a phone that hiccups); the simulation must
// advance in identical steps so that a race depends only on its seed and inputs. advance(dt) says how many whole steps are due and how far
// the next one is under way (alpha in [0, 1)), which the renderer uses to draw the in-between moment.
// "Fix Your Timestep": the leftover time is never discarded, except beyond maxLag (a tab that was in the background): that is dropped, not caught up.
export function createStepper({ STEP, maxLag = 0.25, eps = 1e-6 }) {
  let acc = 0;
  return {
    advance(dt, onStep) {
      acc = Math.min(acc + Math.max(dt, 0), maxLag);
      let steps = 0;
      // The step's time is taken before it runs, so a step that throws is lost, not retried with everything that has piled up since.
      // eps: 16.7 ms frames and a 1/60 s step must not wobble between 0 and 2 steps.
      while (acc >= STEP - eps) { acc -= STEP; steps++; onStep(); }
      if (acc < 0) acc = 0;
      return { steps, alpha: acc / STEP };
    },
    reset() { acc = 0; }
  };
}
