// A small in-memory log of things that went wrong, so a problem on a player's device can be seen and reported (the ?debug overlay
// shows it; M3 will send it somewhere). Nothing here may ever throw: it is called from error handlers.

export function createDiag({ max = 20, now = () => Date.now() } = {}) {
  const entries = [];
  let total = 0;
  const text = e => {
    try { return String(e && typeof e === 'object' && 'message' in e ? e.message : e); } catch (_) { return 'unprintable error'; }
  };
  const stack = e => { try { return e && e.stack ? String(e.stack) : ''; } catch (_) { return ''; } };
  return {
    record(source, error) {
      total++;
      entries.push({ at: now(), source: String(source), message: text(error).slice(0, 300), stack: stack(error).slice(0, 800) });
      if (entries.length > max) entries.shift();
    },
    get total() { return total; },
    get last() { return entries[entries.length - 1] || null; },
    entries: () => entries.slice(),
    clear() { entries.length = 0; total = 0; }
  };
}

// Records uncaught errors and unhandled promise rejections from the given window (or any event target).
export function watchWindow(diag, target) {
  target.addEventListener('error', e => diag.record('window', e.error || e.message));
  target.addEventListener('unhandledrejection', e => diag.record('promise', e.reason));
}
