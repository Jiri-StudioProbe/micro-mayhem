// Main-thread JavaScript cost of one game frame (sim + events + HUD + draw calls), on a phone-sized screen.
// Measured by timing the game's own requestAnimationFrame callback, so it works however the code is organised.
// Usage: node tools/perf.js [repeats]    Compare before/after any refactor; expect about +-10% noise between runs.
import { serve } from '../tests/helpers/server.js';
import { launch, PHONE } from '../tests/helpers/browser.js';

const REPEATS = Number(process.argv[2]) || 3;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const srv = await serve(), browser = await launch();
for (const dpr of [1, 2]) {
  const msList = [], fpsList = [];
  for (let r = 0; r < REPEATS; r++) {
    const ctx = await browser.newContext({ ...PHONE, deviceScaleFactor: dpr });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, x => x.abort());
    await ctx.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window); window.__perf = { n: 0, ms: 0 };
      window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); try { cb(t); } finally { window.__perf.ms += performance.now() - a; window.__perf.n++; } });
    });
    const page = await ctx.newPage();
    await page.goto(srv.url + '/index.html?debug');
    await page.tap('#start'); await page.waitForFunction(() => __mm.S.state === 'race');   // full race: 6 cars, crates, particles
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 1 }] });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__perf = { n: 0, ms: 0 }; window.__t0 = performance.now(); });
    await page.waitForTimeout(5000);
    const { n, ms, secs } = await page.evaluate(() => ({ ...window.__perf, secs: (performance.now() - window.__t0) / 1000 }));
    msList.push(ms / n); fpsList.push(n / secs);
    await ctx.close();
  }
  console.log(`DPR ${dpr}: ${median(msList).toFixed(2)} ms of JavaScript per frame, ${median(fpsList).toFixed(0)} fps  (runs: ${msList.map(x => x.toFixed(2)).join(', ')})`);
}
await browser.close(); await srv.close();
