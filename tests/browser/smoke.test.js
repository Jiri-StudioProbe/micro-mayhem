import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });
const open = async (query = '?debug') => { const t = await newPage(browser, DESKTOP); await t.page.goto(srv.url + '/index.html' + query); return t; };

test('start screen loads cleanly with Veteran selected and assist off', async () => {
  const { page, errors, close } = await open();
  await page.waitForSelector('#start', { state: 'visible' });
  assert.equal(await page.title(), 'Micro Mayhem');
  assert.equal(await page.locator('.lvl').count(), 2);
  assert.equal(await page.locator('.lvl[aria-pressed=true]').getAttribute('data-level'), 'veteran');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: OFF');
  assert.ok((await page.textContent('#levelBlurb')).length > 10);
  await page.waitForTimeout(1500);   // attract mode runs behind the menu
  assert.deepEqual(errors, []);
  await close();
});

test('keyboard race: countdown, start, drive, steer, fire', async () => {
  const { page, errors, close } = await open();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => __mm.S.state), 'countdown');
  assert.equal(await page.evaluate(() => __mm.S.cars.length), 6);
  await waitRace(page);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => __mm.input.thr), 1);
  assert.ok(await page.evaluate(() => Math.hypot(__mm.S.player.vx, __mm.S.player.vy)) > 60, 'car accelerates');
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => __mm.input.steer) < -0.5, 'left steers left');
  await page.keyboard.up('ArrowLeft'); await page.keyboard.down('Space'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __mm.input.fire), 1);
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowUp'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __mm.input.thr), 0);
  assert.equal(await page.isVisible('#hud'), true);
  assert.deepEqual(errors, []);
  await close();
});

// Each end-of-race path, forced by editing the state the same way the sim would reach it.
const ENDS = [
  ['finish', 'YOU WIN', () => { __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }],
  ['last car standing', 'LAST CAR STANDING', () => { for (const c of __mm.S.cars) if (c !== __mm.S.player) { c.alive = false; c.wreck = 0; } }],
  ['wrecked', 'WRECKED', () => { __mm.S.player.alive = false; __mm.S.player.hp = 0; }]
];
for (const [name, head, force] of ENDS) {
  test(`end of race: ${name} shows the results screen, and Race again restarts`, async () => {
    const { page, errors, close } = await open();
    await page.keyboard.press('Enter'); await waitRace(page);
    await page.evaluate(force);
    await page.waitForSelector('#end', { state: 'visible', timeout: 8000 });
    assert.equal(await page.textContent('#endHead'), head);
    assert.ok((await page.textContent('#stTime')).length > 0);
    assert.equal(await page.isVisible('#hud'), false);
    await page.click('#again');
    assert.equal(await page.isVisible('#end'), false);
    assert.equal(await page.evaluate(() => __mm.S.state), 'countdown');
    assert.equal(await page.evaluate(() => __mm.S.cars.length), 6);
    assert.deepEqual(errors, []);
    await close();
  });
}

test('assist and sound toggles', async () => {
  const { page, errors, close } = await open();
  await page.keyboard.press('Enter'); await waitRace(page);
  assert.equal(await page.textContent('#assistHud'), 'ASSIST OFF');
  await page.click('#assistHud');
  assert.equal(await page.textContent('#assistHud'), 'ASSIST ON');
  assert.equal(await page.evaluate(() => __mm.S.assist), true);
  await page.keyboard.press('KeyM');
  assert.equal(await page.textContent('#snd'), 'SOUND OFF');
  assert.deepEqual(errors, []);
  await close();
});
