import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

test('?debug shows the version, the build and an empty error count; a normal session logs nothing', async () => {
  const { page, errors, close } = await newPage(browser, DESKTOP);
  await page.goto(srv.url + '/index.html?debug');
  await page.keyboard.press('Enter'); await waitRace(page); await page.waitForTimeout(1200);
  const text = await page.textContent('#dbg');
  assert.match(text, /v1\.4\.0 build dev {2}errors 0/);
  assert.equal(await page.evaluate(() => __mm.diag.total), 0);
  assert.equal(await page.evaluate(() => __mm.VERSION), '1.4.0');
  assert.deepEqual(errors, []);
  await close();
});

test('a failing frame is logged, shown under ?debug, and the game keeps running', async () => {
  const { page, errors, close } = await newPage(browser, DESKTOP);
  await page.goto(srv.url + '/index.html?debug');
  await page.keyboard.press('Enter'); await waitRace(page);
  await page.evaluate(() => { window.__saved = __mm.S.bullets; __mm.S.bullets = null; });   // the next sim step throws
  await page.waitForFunction(() => __mm.diag.total > 2);
  const last = await page.evaluate(() => __mm.diag.last);
  assert.equal(last.source, 'frame'); assert.match(last.message, /null|length|undefined/i);
  await page.waitForTimeout(600);   // the overlay refreshes twice a second
  assert.match(await page.textContent('#dbg'), /errors \d+: /);
  assert.ok(errors.some(e => e.startsWith('console.error')), 'the error is still reported to the console');
  // repair the state: the loop must still be alive and the race must carry on
  await page.evaluate(() => { __mm.S.bullets = window.__saved; });
  const t0 = await page.evaluate(() => __mm.S.t); await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => __mm.S.t) > t0 + 0.2, 'the main loop survived the failing frames');
  await close();
});

test('an uncaught error elsewhere in the page is recorded too', async () => {
  const { page, close } = await newPage(browser, DESKTOP);
  await page.goto(srv.url + '/index.html?debug');
  await page.evaluate(() => { setTimeout(() => { throw new Error('boom from a timer'); }, 0); });
  await page.waitForFunction(() => __mm.diag.total > 0);
  const e = await page.evaluate(() => __mm.diag.last);
  assert.equal(e.source, 'window'); assert.equal(e.message, 'boom from a timer');
  await close();
});
