import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, PHONE } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

async function phoneRace() {
  const t = await newPage(browser, PHONE);
  await t.page.goto(srv.url + '/index.html?debug');
  await t.page.tap('#start'); await waitRace(t.page);
  const cdp = await t.ctx.newCDPSession(t.page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const center = async sel => { const b = await t.page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  return { ...t, touch, center };
}
const inp = page => page.evaluate(() => ({ thr: __mm.input.thr, brk: __mm.input.brk, fire: __mm.input.fire, steer: +__mm.input.steer.toFixed(3) }));

test('stick: touching means gas, steering grows with thumb travel and stays inside its limits', async () => {
  const { page, touch, errors, close } = await phoneRace();
  const x0 = 150, y0 = 300;
  await touch('touchStart', [{ x: x0, y: y0, id: 1 }]); await page.waitForTimeout(150);
  let s = await inp(page);
  assert.equal(s.thr, 1, 'touching the stick is gas'); assert.equal(s.steer, 0);
  const steerAt = async px => { await touch('touchMove', [{ x: x0 + px, y: y0, id: 1 }]); await page.waitForTimeout(400); return (await inp(page)).steer; };
  const s3 = await steerAt(3), s10 = await steerAt(10), s20 = await steerAt(20), s30 = await steerAt(30), s44 = await steerAt(44);
  console.log(`  steer at 3/10/20/30/44 px: ${s3} ${s10} ${s20} ${s30} ${s44}`);
  assert.equal(s3, 0, 'inside the dead zone');
  assert.ok(s10 < 0.1, 'small movement steers very gently (fine control curve)');
  assert.ok(s20 > 0.03 && s20 < 0.45);
  assert.ok(s30 > s20 && s30 > 0.25 && s30 < 0.98);
  assert.ok(s44 > s30 && s44 > 0.5 && s44 <= 1);
  await touch('touchMove', [{ x: x0 - 44, y: y0, id: 1 }]); await page.waitForTimeout(400);
  assert.ok((await inp(page)).steer < -0.5, 'left steers left');
  await touch('touchMove', [{ x: x0, y: y0 + 45, id: 1 }]); await page.waitForTimeout(300);
  assert.equal((await inp(page)).thr, 1, 'pulling the stick down does not stop the gas');
  await touch('touchEnd', []); await page.waitForTimeout(300);
  s = await inp(page); assert.equal(s.thr, 0); assert.equal(s.steer, 0);
  assert.deepEqual(errors, []);
  await close();
});

test('stick base follows a thumb that drags past its edge', async () => {
  const { page, touch, close } = await phoneRace();
  const base = () => page.evaluate(() => { const r = document.getElementById('stick').getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
  await touch('touchStart', [{ x: 150, y: 300, id: 1 }]); await page.waitForTimeout(100);
  const before = await base();
  await touch('touchMove', [{ x: 150 + 130, y: 300, id: 1 }]); await page.waitForTimeout(200);
  assert.ok(await base() > before + 40, 'the base trails the thumb');
  await close();
});

test('BRAKE and FIRE buttons, alone and together with the stick', async () => {
  const { page, touch, center, errors, close } = await phoneRace();
  const brake = await center('.brake'), fire = await center('.fire');
  await touch('touchStart', [{ x: 150, y: 300, id: 1 }]); await touch('touchMove', [{ x: 175, y: 300, id: 1 }]); await page.waitForTimeout(200);
  await touch('touchStart', [{ x: 175, y: 300, id: 1 }, { x: fire.x, y: fire.y, id: 2 }]); await page.waitForTimeout(200);
  let s = await inp(page);
  assert.equal(s.fire, 1, 'FIRE works while the stick is held'); assert.equal(s.thr, 1); assert.notEqual(s.steer, 0);
  await touch('touchEnd', [{ x: 175, y: 300, id: 1 }]); await touch('touchStart', [{ x: 175, y: 300, id: 1 }, { x: brake.x, y: brake.y, id: 3 }]); await page.waitForTimeout(200);
  s = await inp(page);
  assert.equal(s.brk, 1, 'BRAKE brakes'); assert.equal(s.thr, 0, 'braking cuts the gas');
  await touch('touchEnd', []); await page.waitForTimeout(200);
  s = await inp(page); assert.deepEqual([s.thr, s.brk, s.fire, s.steer], [0, 0, 0, 0]);
  assert.deepEqual(errors, []);
  await close();
});

test('touch controls are hidden on the start screen and shown during a race', async () => {
  const { page, close } = await newPage(browser, PHONE);
  await page.goto(srv.url + '/index.html?debug');
  assert.equal(await page.isVisible('#pad'), false);
  await page.tap('#start'); await waitRace(page);
  assert.equal(await page.isVisible('#stickZone'), true);
  await close();
});
