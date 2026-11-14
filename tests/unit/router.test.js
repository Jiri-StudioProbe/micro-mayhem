import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/ui/router.js';

const el = () => ({ hidden: true, scrollTop: 7, focused: 0, focusArgs: null });
const make = (opts = {}) => {
  const screens = { menu: { el: el() }, end: { el: el(), focus: () => screens.end.target }, history: { el: el() }, detail: { el: el(), focus: () => null } };
  screens.end.target = { focus(a) { screens.end.el.focused++; screens.end.el.focusArgs = a; } };
  const changes = [];
  const router = createRouter({ screens, onChange: c => changes.push(c), ...opts });
  const shown = () => Object.keys(screens).filter(k => !screens[k].el.hidden);
  return { screens, router, changes, shown };
};

// A tiny browser history: entries with states, an index, and popstate events delivered synchronously.
function fakeWindow() {
  const entries = [{ state: null }], w = { index: 0, listeners: [], entries };
  const fire = () => w.listeners.forEach(f => f({ state: entries[w.index].state }));
  w.addEventListener = (t, f) => { if (t === 'popstate') w.listeners.push(f); };
  w.history = {
    replaceState: s => { entries[w.index].state = s; },
    pushState: s => { entries.length = w.index + 1; entries.push({ state: s }); w.index++; },
    back: () => { if (w.index > 0) { w.index--; fire(); } else w.left = true; }, forward: () => { if (w.index < entries.length - 1) { w.index++; fire(); } },
    go: n => { const t = Math.max(0, Math.min(entries.length - 1, w.index + n)); if (t !== w.index) { w.index = t; fire(); } }
  };
  w.user = { back: () => w.history.back(), forward: () => w.history.forward() };
  return w;
}

test('go shows one screen and hides the rest; clear shows none', () => {
  const { router, shown, changes } = make();
  assert.deepEqual(shown(), []); assert.equal(router.current(), null);
  router.go('menu'); assert.deepEqual(shown(), ['menu']); assert.equal(router.current(), 'menu'); assert.equal(router.depth(), 1);
  router.go('end'); assert.deepEqual(shown(), ['end']);
  router.clear(); assert.deepEqual(shown(), []); assert.equal(router.current(), null); assert.equal(router.depth(), 0);
  assert.deepEqual(changes, ['menu', 'end', null]);
});

test('push opens a screen on top of another and back returns to it; back from the first screen does nothing', () => {
  const { router, shown } = make();
  router.go('menu'); router.push('history'); router.push('detail');
  assert.deepEqual([shown(), router.depth(), router.canGoBack()], [['detail'], 3, true]);
  assert.equal(router.back(), true); assert.deepEqual(shown(), ['history']);
  assert.equal(router.back(), true); assert.deepEqual(shown(), ['menu']);
  assert.equal(router.back(), false); assert.deepEqual(shown(), ['menu']); assert.equal(router.canGoBack(), false);
});

test('go from a deep stack starts afresh; pushing the screen that is already on top changes nothing', () => {
  const { router, shown, changes } = make();
  router.go('menu'); router.push('history'); router.push('history'); assert.equal(router.depth(), 2);
  router.go('end'); assert.deepEqual([shown(), router.depth()], [['end'], 1]);
  const n = changes.length; router.push('end'); assert.equal(changes.length, n);
});

test('an unknown screen is a bug and throws', () => {
  const { router } = make();
  assert.throws(() => router.go('nope'), /unknown screen/); assert.throws(() => router.push('nope'), /unknown screen/);
});

test('a screen opened anew scrolls to its top and takes the focus its screen asks for, without scrolling the page', () => {
  const { router, screens } = make();
  router.go('end');
  assert.equal(screens.end.el.scrollTop, 0); assert.equal(screens.end.el.focused, 1); assert.deepEqual(screens.end.el.focusArgs, { preventScroll: true });
  router.go('menu'); assert.equal(screens.menu.el.focused, 0, 'a screen with no focus target gets none');
  router.push('detail'); router.back();   // a screen with a focus function that returns null is fine
});

test('without a browser window nothing touches history', () => {
  const { router } = make({ win: null }); router.go('menu'); router.push('history'); router.back(); router.clear();
});

test('with a window: each push is a history entry, so the browser Back button closes the screen instead of leaving the game', () => {
  const w = fakeWindow(), { router, shown } = make({ win: w });
  router.go('menu'); router.push('history'); router.push('detail');
  assert.equal(w.entries.length, 3); assert.equal(w.index, 2);
  w.user.back(); assert.deepEqual(shown(), ['history']); assert.equal(router.depth(), 2);
  w.user.back(); assert.deepEqual(shown(), ['menu']);
  w.user.back(); assert.deepEqual(shown(), ['menu'], 'at the base the browser leaves the page; the router has nothing to close'); assert.equal(w.index, 0);
});

test('with a window: the on-screen back button and the browser Back stay in step', () => {
  const w = fakeWindow(), { router, shown } = make({ win: w });
  router.go('menu'); router.push('history'); router.push('detail');
  assert.equal(router.back(), true); assert.deepEqual(shown(), ['history']); assert.equal(w.index, 1, 'the history entry went with it');
  w.user.back(); assert.deepEqual(shown(), ['menu']); assert.equal(w.index, 0); assert.ok(!w.left);
  router.push('history'); assert.equal(w.index, 1); assert.deepEqual(shown(), ['history']);
  assert.equal(router.back(), true); assert.deepEqual([shown(), w.index, w.entries.length], [['menu'], 0, 2]);
});

test('with a window: the browser Forward button does nothing', () => {
  const w = fakeWindow(), { router, shown } = make({ win: w });
  router.go('menu'); router.push('history');
  w.user.back(); assert.deepEqual(shown(), ['menu']);
  w.user.forward(); assert.deepEqual(shown(), ['menu'], 'forward is undone'); assert.equal(w.index, 0);
});

test('with a window: starting a race (clear) from a deep screen leaves no stray history entries to back into', () => {
  const w = fakeWindow(), { router, shown } = make({ win: w });
  router.go('menu'); router.push('history'); router.push('detail');
  router.clear(); assert.deepEqual(shown(), []); assert.equal(w.index, 0); assert.ok(!w.left, 'starting a race did not make the browser leave the page');
  w.user.back(); assert.deepEqual(shown(), [], 'Back during a race does not reopen a screen');
  router.go('menu'); router.push('history'); router.go('end'); assert.equal(w.index, 0); assert.deepEqual(shown(), ['end']);
});

test('with a window: a page that starts with leftover history state begins from a clean base', () => {
  const w = fakeWindow(); w.entries[0].state = { mm: 3 };
  const { router, shown } = make({ win: w }); router.go('menu');
  assert.deepEqual(w.entries[0].state, { mm: 0 });
  router.push('history'); w.user.back(); assert.deepEqual(shown(), ['menu']);
});

test('a document that forbids the history API still has a working router', () => {
  const w = fakeWindow(); w.history.replaceState = () => { throw new Error('SecurityError'); };
  const { router, shown } = make({ win: w });
  router.go('menu'); router.push('history'); assert.equal(w.entries.length, 1, 'no entries were made'); router.back(); assert.deepEqual(shown(), ['menu']);
});

test('going back does not scroll the screen below to its top, and tells it that it is shown again rather than anew', () => {
  const { router, screens } = make(); const seen = []; const foc = [];
  screens.history.focus = fresh => { foc.push(fresh); return null; };
  router.subscribe((cur, meta) => seen.push([cur, meta.fresh]));
  router.go('menu'); router.push('history'); screens.history.el.scrollTop = 123; router.push('detail');
  router.back();
  assert.deepEqual(seen.at(-1), ['history', false]); assert.equal(screens.history.el.scrollTop, 123, 'left where it was'); assert.deepEqual(foc, [true, false]);
  router.push('detail'); assert.deepEqual(seen.at(-1), ['detail', true]);
});

test('the browser history never gets out of step, however Back and Forward are mixed with the screen\'s own back button', () => {
  const w = fakeWindow(), { router, shown } = make({ win: w });
  router.go('menu'); router.push('history'); router.push('detail');
  w.user.back(); w.user.forward(); w.user.forward(); assert.deepEqual([shown(), w.index], [['history'], 1]);
  router.back(); w.user.forward(); assert.deepEqual([shown(), w.index], [['menu'], 0]);
  router.push('history'); router.push('detail'); router.clear(); w.user.forward(); w.user.forward(); assert.deepEqual([shown(), w.index], [[], 0]); assert.ok(!w.left);
  router.go('menu'); router.push('history'); w.user.back(); assert.deepEqual(shown(), ['menu']); router.push('history'); assert.deepEqual([shown(), w.index], [['history'], 1]);
  w.user.back(); w.user.back(); w.user.back(); assert.deepEqual([shown(), w.index], [['menu'], 0], 'nothing was left swallowing a later Back'); assert.ok(w.left, 'the last Back, at the base, is the browser\'s own: it leaves');
});
