// The ?debug overlay: fps, frame time, canvas resolution, sim speed (should read 1.00x), the version and the error count.
// Called from the main loop outside its try/catch, so it still updates when a frame fails (which is when it matters).
// Moved verbatim out of src/main.js in M0.7.
export function createDebugOverlay({ S, view, canvas, diag, doc, VERSION, build }) {
  const dbg = doc.body.appendChild(Object.assign(doc.createElement('div'), { id: 'dbg' }));
  let dbgT = 0, dbgS = 0, dbgN = 0;
  return function update(now, ft) {
    dbgN++;
    if (now - dbgT > 500) {
      const sim = dbgT ? (S.t - dbgS) / ((now - dbgT) / 1000) : 1;
      dbg.textContent = 'fps ' + (dbgN / ((now - dbgT) / 1000)).toFixed(0) + '  frame ' + ft.toFixed(1) + 'ms\nres ' + view.DPR.toFixed(2) + 'x (' + canvas.width + 'x' + canvas.height + ')\nsim speed ' + sim.toFixed(2) + 'x  assist ' + (S.assist ? 'on' : 'off') + '\nv' + VERSION + ' build ' + build() + '  errors ' + diag.total + (diag.last ? ': ' + diag.last.message.slice(0, 60) : '');
      dbgT = now; dbgS = S.t; dbgN = 0;
    }
  };
}
