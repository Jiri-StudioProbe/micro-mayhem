import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

// `name` seeds a profile whose one character has that name (the results show it beside the headline).
const open = async (opts = DESKTOP, query = '?debug', name = null) => {
  const t = await newPage(browser, opts);
  if (name) await t.page.addInitScript(n => { const T = '2026-11-12T18:02:00.000Z'; if (!localStorage.getItem('mm:profile')) localStorage.setItem('mm:profile', JSON.stringify({ version: 3, household: { id: 'h', createdAt: T }, settings: { presets: {} }, characters: [{ id: 'a', name: n, level: 'veteran', createdAt: T, updatedAt: T, races: [], bests: {} }] })); }, name);
  await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector('#start', { state: 'visible' }); return t; };
const begin = async page => { await page.click('#start'); await waitRace(page); };
const again = async page => { await page.click('#again'); await waitRace(page); };
const shown = page => page.waitForSelector('#end', { state: 'visible', timeout: 10000 });
// Ends the race at the line with chosen lap times (the sim's own bookkeeping, set directly: the test is about the screen).
const finish = (page, time, laps) => page.evaluate(([time, laps]) => { const S = __mm.S; S.laps.length = 0; S.laps.push(...laps); S.raceT = time - __mm.Sim.STEP; S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }, [time, laps]);
const block = page => page.evaluate(() => {
  const t = id => document.getElementById(id).textContent;
  return { hidden: document.getElementById('bests').hidden, note: t('bsNote'), time: [t('bsTimeRace'), t('bsTimeBest'), t('bsTimeTag'), document.getElementById('bsTimeTag').className, document.getElementById('bsTimeRace').parentElement.hidden],
    lap: [t('bsLapRace'), t('bsLapBest'), t('bsLapTag'), document.getElementById('bsLapTag').className, document.getElementById('bsLapRace').parentElement.hidden] };
});

test('the results screen shows this race against your best, with NEW BEST, how much slower you were, and your best kept', async () => {
  const { page, errors, close } = await open();
  await begin(page); await finish(page, 83.416, [28.1, 27.3, 27.9]); await shown(page);
  let b = await block(page);
  assert.deepEqual([b.hidden, b.note], [false, 'VETERAN · NO ASSIST']);
  for (const sel of ['#bests', '.bhead', '#bsTimeRace', '#bsLapRace', '#bsTimeTag', '#bsLapTag']) assert.equal(await page.isVisible(sel), true, sel + ' is on screen');
  assert.deepEqual(b.time, ['1:23.42', '1:23.42', 'NEW BEST', 'tag new', false]); assert.deepEqual(b.lap, ['0:27.30', '0:27.30', 'NEW BEST', 'tag new', false]);
  await again(page); await finish(page, 85.2, [28.6, 28.1, 27.4]); await shown(page);
  b = await block(page);
  assert.deepEqual(b.time, ['1:25.20', '1:23.42', '+1.78 s', 'tag slower', false]); assert.deepEqual(b.lap, ['0:27.40', '0:27.30', '+0.10 s', 'tag slower', false]);
  await again(page); await finish(page, 81.9, [27.2, 27.1, 26.2]); await shown(page);
  b = await block(page);
  assert.deepEqual(b.time, ['1:21.90', '1:21.90', 'NEW BEST', 'tag new', false]); assert.deepEqual(b.lap, ['0:26.20', '0:26.20', 'NEW BEST', 'tag new', false]);
  assert.deepEqual(errors, []); await close();
});

test('your bests are remembered between visits: a race after a reload is compared with them', async () => {
  const { page, close } = await open();
  await begin(page); await finish(page, 80, [27, 26.5, 26.5]); await shown(page);
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' });
  await begin(page); await finish(page, 82.5, [27.5, 27, 27]); await shown(page);
  const b = await block(page);
  assert.deepEqual(b.time, ['1:22.50', '1:20.00', '+2.50 s', 'tag slower', false]);
  await close();
});

test('a race that does not finish shows no time, but its best lap is compared; with nothing to compare there is a hint', async () => {
  const { page, close } = await open();
  await begin(page); await finish(page, 80, [27, 26, 26.5]); await shown(page);
  await again(page);
  await page.evaluate(() => { __mm.S.laps.push(26.5); __mm.S.player.alive = false; __mm.S.player.hp = 0; }); await shown(page);
  let b = await block(page);
  assert.deepEqual(b.time.slice(0, 3), ['—', '1:20.00', '']); assert.deepEqual(b.lap, ['0:26.50', '0:26.00', '+0.50 s', 'tag slower', false]);
  assert.equal(await page.isVisible('#bsTimeTag'), false, 'no empty badge next to a missing time');
  await close();
  const t2 = await open();   // a fresh profile: wrecked before finishing a lap
  await begin(t2.page); await t2.page.evaluate(() => { __mm.S.player.alive = false; __mm.S.player.hp = 0; }); await shown(t2.page);
  b = await block(t2.page);
  assert.equal(b.hidden, false); assert.match(b.note, /FINISH A LAP TO SET YOUR FIRST BEST/);
  assert.deepEqual([b.time[4], b.lap[4]], [true, true], 'no empty rows');
  for (const sel of ['.bhead', '#bsTimeRace', '#bsLapRace']) assert.equal(await t2.page.isVisible(sel), false, sel + ' is really not on screen');
  assert.equal(await t2.page.isVisible('#bsNote'), true);
  await t2.close();
});

test('bests are kept per level and per assist setting, and the screen names the board', async () => {
  const { page, close } = await open();
  await begin(page); await finish(page, 80, [27, 26, 26]); await shown(page);
  await page.evaluate(() => document.getElementById('end').hidden = true);   // back to a menu without starting a race
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' });
  await page.click('.lvl[data-level=rookie]'); await begin(page); await finish(page, 90, [30, 30, 30]); await shown(page);
  const b = await block(page);
  assert.equal(b.note, 'ROOKIE · ASSIST'); assert.equal(b.time[3], 'tag new', 'a slower time than the Veteran one is still a first best on the Rookie board');
  await close();
});

test('a race where assist was switched says it sets no record, and shows no rows', async () => {
  const { page, close } = await open();
  await begin(page); await page.click('#assistHud'); await page.waitForTimeout(200); await finish(page, 70, [24, 23, 23]); await shown(page);
  const b = await block(page);
  assert.equal(b.hidden, false); assert.match(b.note, /ASSIST WAS SWITCHED/); assert.deepEqual([b.time[4], b.lap[4]], [true, true]);
  for (const sel of ['.bhead', '#bsTimeRace', '#bsLapRace']) assert.equal(await page.isVisible(sel), false, sel + ' is really not on screen');
  await again(page); await finish(page, 90, [30, 30, 30]); await shown(page);
  assert.equal((await block(page)).time[3], 'tag new', 'and it did not set the best that the next race is compared with');
  await close();
});

test('if the race could not be recorded the records block is not shown, and the rest of the results screen is', async () => {
  const { page, close } = await open();
  await begin(page); await page.evaluate(() => { __mm.S.player.kills = -3; }); await finish(page, 80, [27, 26, 26]); await shown(page);
  assert.equal((await block(page)).hidden, true); assert.equal(await page.isVisible('#bests'), false); assert.ok(await page.isVisible('#stTime'));
  await close();
});

// The results card must never push the button off a short landscape phone again.
for (const [name, w, h] of [['iPhone SE sideways', 667, 375], ['small Android sideways', 740, 360], ['standard phone sideways', 844, 390], ['large phone sideways', 932, 430], ['short window', 1000, 480],
  ['laptop', 1366, 600], ['desktop', 1000, 700], ['tablet', 1180, 820], ['phone upright', 390, 844], ['narrow phone upright', 320, 568]]) {
  test(`the results screen fits without scrolling: ${name} (${w}x${h})`, async () => {
    const { page, close } = await open({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < 900 }, '?debug', 'WWWWWWWWWWWWWWWW');   // the widest name there can be
    await begin(page); await finish(page, 80.5, [27.3, 27.1, 26.2]); await shown(page); await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const e = document.getElementById('end'), box = id => document.getElementById(id).getBoundingClientRect(), bests = box('bests');
      return { fitsV: e.scrollHeight <= e.clientHeight, fitsH: e.scrollWidth <= e.clientWidth, buttonBottom: box('again').bottom, headTop: box('endKick').top, bestsRight: bests.right, bestsLeft: bests.left, vw: innerWidth, vh: innerHeight };
    });
    assert.ok(m.fitsV, `the card is taller than the screen: ${JSON.stringify(m)}`); assert.ok(m.fitsH, 'sideways overflow');
    assert.ok(m.buttonBottom <= m.vh && m.headTop >= 0, JSON.stringify(m)); assert.ok(m.bestsLeft >= 0 && m.bestsRight <= m.vw, 'the records block is inside the screen');
    await close();
  });
}
