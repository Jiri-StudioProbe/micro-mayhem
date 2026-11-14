// The screen router. A "screen" is a full-page overlay (the start menu, the results, the history ...); at most one is shown at a time, and the
// race itself is the state where none is. The router keeps a stack, so a screen opened from another can go back to it.
//   go(id)     make `id` the only screen (a fresh start: the menu, the results)
//   push(id)   open `id` on top of the current screen (the history from the menu, a race's details from the history)
//   back()     close the top screen and show the one under it; returns false when there is nothing to go back to
//   clear()    show no screen (a race is on)
// It owns which screen is hidden and where the focus goes. With `win` (the browser's window) it also uses the browser's history, so that the
// phone's Back button (and the browser's) closes a screen instead of leaving the game: every push is one history entry.
// screens = { id: { el, focus(fresh) -> element to focus when shown, or null } }
export function createRouter({ screens, win = null, onChange = () => {} }) {
  let stack = [];
  const listeners = [];
  const ids = Object.keys(screens);

  // fresh = the screen was just opened (go or push); false = it is shown again because the screen above it was closed (back), when it should
  // not be scrolled to its top: whoever owns the screen restores its position (subscribe), as hiding a screen forgets it.
  function apply(fresh) {
    const cur = stack.length ? stack[stack.length - 1] : null;
    for (const id of ids) screens[id].el.hidden = id !== cur;
    if (cur) {
      if (fresh) screens[cur].el.scrollTop = 0;
      const f = screens[cur].focus && screens[cur].focus(fresh);
      if (f) f.focus({ preventScroll: true });
    }
    onChange(cur);
    for (const fn of listeners) fn(cur, { fresh });
  }
  // Browser history entries above the base one are made by push(); drop `n` of them. (The popstate handler below then finds the browser already
  // where the stack says it should be and does nothing.)
  function dropEntries(n) { if (win && n > 0) win.history.go(-n); }

  if (win) {
    try { win.history.replaceState({ mm: 0 }, ''); } catch (_) { win = null; }   // a document where the history API is blocked just has no Back button support
  }
  // The browser moved to the history entry with depth `target`. The stack is the truth: if the browser went back past screens that are still open,
  // close them; if it went forward to a screen that is not open, undo that (Forward has no meaning here). With no screen open (a race) the depth is 0.
  // Every case where the browser is already where the stack says is a no-op, so the router's own history calls need no bookkeeping.
  if (win) win.addEventListener('popstate', e => {
    const target = e.state && Number.isInteger(e.state.mm) ? e.state.mm : 0, depth = Math.max(stack.length - 1, 0);
    if (target < depth) { stack.length = target + 1; apply(false); }
    else if (target > depth) win.history.back();
  });

  return {
    go(id) { if (!screens[id]) throw new Error('unknown screen ' + id); const extra = stack.length - 1; stack = [id]; dropEntries(extra); apply(true); },
    push(id) {
      if (!screens[id]) throw new Error('unknown screen ' + id);
      if (stack[stack.length - 1] === id) return;
      stack.push(id);
      if (win) win.history.pushState({ mm: stack.length - 1 }, '');
      apply(true);
    },
    back() {
      if (stack.length <= 1) return false;
      stack.pop(); apply(false);
      if (win) win.history.back();
      return true;
    },
    clear() { const extra = stack.length - 1; stack = []; dropEntries(extra); apply(false); },
    subscribe(fn) { listeners.push(fn); },   // fn(currentScreenId | null, { fresh }) after every change
    current: () => (stack.length ? stack[stack.length - 1] : null),
    depth: () => stack.length,
    canGoBack: () => stack.length > 1
  };
}
