import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, runFrames } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const FRAMES = Number(process.env.SOAK_FRAMES || 9000);   // 9000 frames = 2.5 minutes of game time
const small = { viewport: { width: 480, height: 320 } };

// Virtual time runs the real game loop (sim, events, HUD and every draw path) far faster than real time.
test(`soak: ${FRAMES} frames of attract mode and racing with random inputs, no exceptions`, async () => {
  const { page, errors, close } = await newPage(browser, small, { virtualTime: true });
  await page.goto(srv.url + '/index.html?debug');
  const first = await runFrames(page, 1500);   // attract mode behind the menu
  assert.deepEqual([first.alive, first.thrown], [true, null]);
  await page.click('#start');
  let ran = first.ran, races = 1;
  while (ran < FRAMES) {
    const r = await runFrames(page, 600, { keys: true });
    assert.equal(r.thrown, null); assert.equal(r.alive, true, 'the main loop must stay armed');
    ran += r.ran;
    if (await page.isVisible('#end')) { await page.click('#again'); races++; }
  }
  console.log(`  ${ran} frames, ${races} races started`);
  assert.deepEqual(errors, []);
  await close();
});

// Regression: a rocket or explosion far behind the camera used to throw in render() (negative canvas radius) and stop the loop for good.
test('regression: far-away explosions, rockets and mines never freeze the game', async () => {
  const { page, errors, close } = await newPage(browser, small, { virtualTime: true });
  await page.goto(srv.url + '/index.html?debug');
  await runFrames(page, 60); await page.click('#start'); await runFrames(page, 300);   // past the countdown
  await page.evaluate(() => {
    const S = __mm.S, P = S.player, c = Math.cos(P.a), s = Math.sin(P.a);
    for (const k of [400, 900, 1500, 3000, -300, -1200]) {   // behind, level with and ahead of the camera
      S.rings.push({ x: P.x - c * k, y: P.y - s * k, r: 20, max: 80, life: 0.35, t: 0.35 });
      S.rockets.push({ x: P.x - c * k, y: P.y - s * k, a: P.a, sp: 300, life: 2, owner: S.cars[1] });
      S.mines.push({ x: P.x - c * k, y: P.y - s * k, owner: S.cars[1], arm: 0.9, life: 30 });
      S.bullets.push({ x: P.x - c * k, y: P.y - s * k, vx: 0, vy: 0, life: 1, owner: S.cars[1], dmg: 1 });
    }
  });
  const r = await runFrames(page, 240);
  assert.equal(r.thrown, null); assert.equal(r.alive, true, 'the main loop must stay armed');
  assert.deepEqual(errors, [], 'nothing may be logged as an error');
  await close();
});
