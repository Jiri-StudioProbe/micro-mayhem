// Browser helpers: launch, fresh contexts (fresh localStorage), error capture, virtual time.
import { chromium } from 'playwright';

export const launch = () => chromium.launch();

export const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
export const DESKTOP = { viewport: { width: 1000, height: 700 } };

// Every test gets a fresh context, so no saved profile leaks between tests.
// Errors that matter: uncaught exceptions, console.error, and any request to a third party. The game must work with no outside
// network at all (it hosts its own fonts), so every non-local request is blocked and recorded as an error.
export async function newPage(browser, opts = DESKTOP, { virtualTime = false } = {}) {
  const ctx = await browser.newContext(opts);
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { errors.push('external request: ' + r.request().url()); r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  if (virtualTime) {
    // The game's requestAnimationFrame callback is captured so a test can drive frames with a fake clock, far faster than real time.
    await page.addInitScript(() => { window.__cb = null; window.requestAnimationFrame = cb => { window.__cb = cb; return 1; }; });
  }
  return { ctx, page, errors, close: () => ctx.close() };
}

// Runs `frames` frames of ~60 fps virtual time. Returns how many ran, whether the loop is still armed, and any exception.
export function runFrames(page, frames, { keys = false } = {}) {
  return page.evaluate(async ([n, keys]) => {
    const out = { ran: 0, alive: true, thrown: null };
    window.__t = window.__t || 1000;
    const press = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    for (let f = 0; f < n; f++) {
      const cb = window.__cb;
      if (!cb) { out.alive = false; break; }
      window.__cb = null;
      try { cb(window.__t += 16.7); } catch (e) { out.thrown = String(e && e.message || e); break; }
      out.ran++;
      if (keys && f % 20 === 0) for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space']) press(k, Math.random() < 0.6);
      if (f % 3000 === 2999) await new Promise(r => setTimeout(r, 0));
    }
    out.alive = out.alive && !!window.__cb;
    return out;
  }, [frames, keys]);
}

export const waitRace = page => page.waitForFunction(() => window.__mm && window.__mm.S.state === 'race', null, { timeout: 15000 });
