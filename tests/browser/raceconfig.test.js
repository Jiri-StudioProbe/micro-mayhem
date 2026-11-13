import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const open = async (query = '?debug') => { const t = await newPage(browser, DESKTOP); await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector(query.includes('lab') ? '#labExit' : '#start', { state: 'visible' }); return t; };
const cfg = page => page.evaluate(() => ({ config: JSON.parse(JSON.stringify(__mm.S.config)), problems: __mm.Sim.configProblems(__mm.S.config), simVersion: __mm.S.simVersion, seed: __mm.S.seed, assist: __mm.S.assist, tune: { ...__mm.S.tune } }));

test('every race carries its config: the player\'s level, assist and tuning, a seed, and the version of the rules', async () => {
  const { page, errors, close } = await open();
  await page.keyboard.press('Enter'); await waitRace(page);
  const a = await cfg(page);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.config, { mode: 'race', seed: a.seed, assist: false, tune: { assistLane: 0.3, assistSpeed: 1.1 } }, 'Veteran: assist off, the Veteran assist values');
  assert.equal(a.simVersion, await page.evaluate(() => __mm.Sim.SIM_VERSION));
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0);
  assert.deepEqual([a.assist, a.tune.assistLane, a.tune.assistSpeed], [false, 0.3, 1.1], 'and the sim is running with them');
  await close(); assert.deepEqual(errors, []);
});

test('Rookie: assist on and the Rookie values; and a new race has a new seed', async () => {
  const { page, close } = await open();
  await page.click('.lvl[data-level=rookie]'); await page.click('#start'); await waitRace(page);
  const a = await cfg(page);
  assert.deepEqual(a.config, { mode: 'race', seed: a.seed, assist: true, tune: { assistLane: 1.5, assistSpeed: 1.5 } });
  assert.deepEqual([a.assist, a.tune.assistLane], [true, 1.5]);
  await page.evaluate(() => { for (const c of __mm.S.cars) if (c !== __mm.S.player) { c.alive = false; } });   // last car standing: the results screen
  await page.waitForSelector('#again', { state: 'visible', timeout: 8000 });
  await page.click('#again'); await waitRace(page);
  const b = await cfg(page);
  assert.notEqual(b.seed, a.seed, 'the next race has its own seed');
  assert.deepEqual(b.config.tune, a.config.tune); assert.equal(b.config.assist, true);
  await close();
});

test('the assist button on the start screen decides the next race\'s config', async () => {
  const { page, close } = await open('?debug&level=veteran');
  await page.click('#assistMenu'); await page.click('#start'); await waitRace(page);
  assert.equal((await cfg(page)).config.assist, true, 'Veteran with assist switched on');
  await close();
});

test('the lab and the demo behind the menu have their own configs, and leaving the lab restores the menu\'s settings', async () => {
  const { page, close } = await open('?lab&debug&level=rookie');
  let c = await cfg(page); assert.equal(c.config.mode, 'lab'); assert.deepEqual(c.problems, []); assert.equal(c.config.assist, true);
  await page.keyboard.press('Escape');
  c = await cfg(page); assert.equal(c.config.mode, 'attract'); assert.deepEqual([c.config.assist, c.assist, c.config.tune.assistLane], [true, true, 1.5], 'Rookie settings survive leaving the lab');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON');
  await page.click('#start'); await waitRace(page);
  c = await cfg(page); assert.equal(c.config.mode, 'race'); assert.equal(c.config.assist, true);
  await close();
});

test('the demo restarting behind the menu does not change the assist setting (the menu button keeps telling the truth)', async () => {
  const { page, close } = await open('?debug&level=rookie');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON');
  const seed0 = (await cfg(page)).seed;
  await page.evaluate(() => { const S = __mm.S; S.cars.slice(1).forEach(c => { c.alive = false; }); });   // fewer than three cars alive: the demo restarts
  await page.waitForFunction(s => __mm.S.seed !== s, seed0, { timeout: 5000 });
  const c = await cfg(page);
  assert.equal(c.config.mode, 'attract'); assert.equal(c.assist, true, 'the restarted demo has the player\'s assist setting');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON');
  assert.deepEqual(c.config.tune, { assistLane: 1.5, assistSpeed: 1.5 });
  await close();
});
