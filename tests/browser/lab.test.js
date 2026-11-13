import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, PHONE } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });
const open = async (query = '?lab&debug') => { const t = await newPage(browser, PHONE); await t.page.goto(srv.url + '/index.html' + query); return t; };

// The documented defaults. If you change a default on purpose, change it here and bump PRESET_VERSION.
export const VETERAN = '{"level":"veteran","gain":2.6,"curve":2.55,"maxLock":1,"speedDamp":0.45,"rate":79,"dead":0.14,"radius":48,"assistLane":0.3,"assistSpeed":1.1,"assist":"off"}';
export const ROOKIE = '{"level":"rookie","gain":2.6,"curve":2.55,"maxLock":1,"speedDamp":0.45,"rate":79,"dead":0.14,"radius":48,"assistLane":1.5,"assistSpeed":1.5,"assist":"on"}';

test('?lab opens the empty track with the panel and the Veteran defaults', async () => {
  const { page, errors, close } = await open();
  await page.waitForSelector('#tune', { state: 'visible' });
  const st = await page.evaluate(() => ({ cars: __mm.S.cars.length, crates: __mm.S.crates.length, state: __mm.S.state, lab: __mm.S.lab }));
  assert.deepEqual(st, { cars: 1, crates: 0, state: 'race', lab: true });
  assert.equal(await page.locator('.trow').count(), 9);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fire')).display), 'none', 'no weapons in the lab');
  assert.equal(await page.inputValue('#tuneOut'), VETERAN);
  assert.deepEqual(errors, []);
  await close();
});

test('switching to Rookie in the panel gives the Rookie defaults and turns assist on', async () => {
  const { page, close } = await open();
  await page.tap('#tune [data-level=rookie]');
  assert.equal(await page.inputValue('#tuneOut'), ROOKIE);
  assert.equal(await page.evaluate(() => __mm.S.assist), true);
  assert.equal(await page.inputValue('#t_assistLane'), '1.5');
  await close();
});

test('sliders change the live value, RESET returns to the level defaults', async () => {
  const { page, close } = await open();
  const set = (k, v) => page.evaluate(([k, v]) => { const e = document.getElementById('t_' + k); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await set('gain', 1.2); await set('maxLock', 0.5);
  assert.equal(await page.evaluate(() => __mm.tune.gain), 1.2);
  assert.match(await page.inputValue('#tuneOut'), /"gain":1.2,.*"maxLock":0.5/);
  assert.match(await page.textContent('#tv_gain'), /default 2.6/);
  await set('radius', 90);
  assert.equal(await page.evaluate(() => document.getElementById('stick').style.width), '216px', 'stick graphic follows the travel setting');
  await page.tap('#tuneReset');
  assert.equal(await page.inputValue('#tuneOut'), VETERAN);
  await close();
});

test('a dead zone of 0 plus a touch on the stick does not break the car (steering used to turn NaN and the car vanished)', async () => {
  const { page, ctx, errors, close } = await open();
  await page.evaluate(() => { const e = document.getElementById('t_dead'); e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => __mm.tune.dead), 0);
  await page.tap('#tuneClose');
  const z = await page.locator('#stickZone').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: z.x + z.width / 2, y: z.y + z.height / 2, id: 1 }] });   // down exactly where the stick appears: its centre
  await page.waitForTimeout(400);   // held, so that frames read the stick
  const s = await page.evaluate(() => ({ steer: __mm.input.steer, x: __mm.S.player.x, y: __mm.S.player.y, a: __mm.S.player.a }));
  assert.ok(Object.values(s).every(Number.isFinite), 'steering and the car stay finite: ' + JSON.stringify(s));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(errors, []);
  await close();
});

test('lap timing and wall-touch counter', async () => {
  const { page, close } = await open();
  await page.evaluate(() => { __mm.S.player.prog = -5; }); await page.waitForTimeout(150);
  await page.evaluate(() => { __mm.S.player.prog = 1; }); await page.waitForTimeout(1200);   // crosses the line: timing starts
  await page.evaluate(() => { const P = __mm.S.player; P.prog = (Math.floor(P.prog / __mm.Sim.N) + 1) * __mm.Sim.N + 2; }); await page.waitForTimeout(300);
  assert.match(await page.textContent('#lsLast'), /^\d+\.\d s$/);
  assert.equal(await page.textContent('#lsLast'), await page.textContent('#lsBest'));
  assert.equal(await page.textContent('#lap'), '2');
  await close();
});

test('the lab never ends and cannot be lost', async () => {
  const { page, close } = await open();
  await page.evaluate(() => { __mm.S.player.hp = 1; __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N + 50; });
  await page.waitForTimeout(3500);
  assert.equal(await page.evaluate(() => __mm.S.state), 'race');
  assert.equal(await page.isVisible('#end'), false);
  await close();
});

test('EXIT returns to the menu, and the next normal race is full', async () => {
  const { page, errors, close } = await open();
  await page.tap('#tuneExit');
  assert.equal(await page.isVisible('#menu'), true);
  assert.equal(await page.isVisible('#hud'), false);
  assert.equal(await page.evaluate(() => __mm.S.lab), false);
  await page.tap('#start');
  const st = await page.evaluate(() => ({ cars: __mm.S.cars.length, crates: __mm.S.crates.length, state: __mm.S.state, lab: __mm.S.lab }));
  assert.deepEqual(st, { cars: 6, crates: 33, state: 'countdown', lab: false });
  assert.equal(await page.isVisible('#tune'), false);
  assert.deepEqual(errors, []);
  await close();
});

test('Escape leaves the lab', async () => {
  const { page, close } = await open();
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#menu'), true);
  await close();
});
