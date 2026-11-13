// CPU cost of one game frame, measured by running the real game loop in virtual time (no waiting for the display), so it is much less
// noisy than tools/perf.js. A full 6-car race on a phone-sized screen: sim, events, HUD and every draw call.
// Usage: node tools/perf-cpu.mjs [frames=3000] [repeats=5]
import { serve } from '../tests/helpers/server.js';
import { launch, newPage, runFrames, PHONE } from '../tests/helpers/browser.js';

const FRAMES = Number(process.argv[2]) || 3000, REPEATS = Number(process.argv[3]) || 5;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const srv = await serve(), browser = await launch(), ms = [];
for (let r = 0; r < REPEATS; r++) {
  const { page, close } = await newPage(browser, PHONE, { virtualTime: true });
  await page.goto(srv.url + '/index.html?debug');
  await runFrames(page, 30); await page.tap('#start'); await runFrames(page, 300);   // past the countdown, into a race
  await page.keyboard.down('ArrowUp');
  const t0 = Date.now(); const res = await runFrames(page, FRAMES); const dt = Date.now() - t0;
  if (res.thrown || !res.alive) throw new Error('the loop failed during measurement: ' + JSON.stringify(res));
  ms.push(dt / FRAMES);
  await close();
}
console.log(`${median(ms).toFixed(3)} ms per frame (median of ${REPEATS} runs of ${FRAMES} frames; runs: ${ms.map(x => x.toFixed(3)).join(', ')})`);
await browser.close(); await srv.close();
