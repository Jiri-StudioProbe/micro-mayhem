import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';
import { fmtTime } from '../../src/ui/format.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const T = '2026-11-12T18:02:00.000Z', V = 'classic/veteran/manual', R = 'classic/rookie/assist';
const best = (time, lap) => ({ time, timeRace: time === null ? null : 'r', bestLap: lap, bestLapRace: lap === null ? null : 'r' });
const ch = (id, name, level = 'veteran', bests = {}) => ({ id, name, level, createdAt: T, updatedAt: T, races: [], bests });
const household = (characters, current = characters[0].id) => ({ version: 3, household: { id: 'house-1', createdAt: T }, settings: { presets: {}, character: current }, characters, updatedAt: T });
// Ada and Bo tie on race time? No: Ada and Cy tie (83.41); Bo is fastest; Di has a lap but no finished race; Ed has nothing.
const FAMILY = () => household([ch('a', 'Ada', 'veteran', { [V]: best(83.41, 27.12), [R]: best(88.2, 29.9) }), ch('b', 'Bo', 'veteran', { [V]: best(80.2, 26.94) }),
  ch('c', 'Cy', 'veteran', { [V]: best(83.41, 26.5) }), ch('d', 'Di', 'rookie', { [V]: best(null, 25.8) }), ch('e', 'Ed')], 'b');

async function open(profile, { device = DESKTOP, query = '?debug' } = {}) {
  const t = await newPage(browser, { ...device, locale: 'en-GB', timezoneId: 'UTC' });
  if (profile) await t.page.addInitScript(p => { if (!localStorage.getItem('mm:profile')) localStorage.setItem('mm:profile', JSON.stringify(p)); }, profile);
  await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector('#start', { state: 'visible' }); await t.page.waitForFunction(() => window.__mm);
  return t;
}
const screen = page => page.evaluate(() => ['menu', 'end', 'history', 'backup', 'detail', 'players', 'player', 'family'].filter(id => !document.getElementById(id).hidden));
const rows = page => page.$$eval('#fmRows .frow', e => e.map(x => [...x.children].map(c => c.textContent).concat([x.className.replace('frow', '').trim()])));
const chips = page => page.$$eval('#fmBoards .snd', e => e.map(x => [x.textContent, x.getAttribute('aria-pressed')]));
const note = page => page.$eval('#fmNone', e => (e.hidden ? null : e.textContent));
const END = { finish: page => page.evaluate(() => { __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }) };

test('a household of one has no family board: its buttons are not there, and the start screen has no text where they would be', async () => {
  const { page, close } = await open(household([ch('a', 'Ada', 'veteran', { [V]: best(80, 26) })]));
  assert.equal(await page.isVisible('#familyBtn'), false); assert.equal(await page.textContent('#familyBtn'), '');
  await page.click('#whoBtn'); assert.equal(await page.isVisible('#plFamily'), false); assert.equal(await page.textContent('#plFamily'), '');
  await close();
});

test('the board opens on the board the player races on, ranked by race time: ties share a rank, the player is marked, the leader is first, and who has not raced there is named', async () => {
  const { page, errors, close } = await open(FAMILY());
  assert.equal(await page.textContent('#familyBtn'), 'FAMILY BOARD');
  await page.click('#familyBtn'); assert.deepEqual(await screen(page), ['family']);
  assert.deepEqual(await chips(page), [['ROOKIE · ASSIST', 'false'], ['VETERAN · NO ASSIST', 'true']], 'Bo is a Veteran without assist');
  assert.deepEqual(await rows(page), [['1', 'Bo', '1:20.20', '0:26.94', 'me first'], ['2', 'Ada', '1:23.41', '0:27.12', ''], ['2', 'Cy', '1:23.41', '0:26.50', ''], ['—', 'Di', '—', '0:25.80', '']]);
  assert.equal(await note(page), 'Not raced here yet: Ed');
  assert.equal(await page.getAttribute('#fmSortTime', 'aria-pressed'), 'true'); assert.equal(await page.getAttribute('#fmHeadTime', 'class'), 'lab on');
  const look = await page.evaluate(() => { const css = (sel, p) => getComputedStyle(document.querySelector(sel))[p]; return { meMarked: css('#fmRows .frow.me', 'boxShadow') !== 'none', firstColour: css('#fmRows .frow.first .fn', 'color'), otherColour: css('#fmRows .frow:nth-child(2) .fn', 'color') }; });
  assert.equal(look.meMarked, true, 'the player\'s own row is marked on screen'); assert.notEqual(look.firstColour, look.otherColour, 'and the leader is picked out');
  assert.deepEqual(errors, []); await close();
});

test('ranking by best lap reorders the same bests; another board shows only who raced on it', async () => {
  const { page, close } = await open(FAMILY());
  await page.click('#familyBtn'); await page.click('#fmSortLap');
  assert.deepEqual((await rows(page)).map(r => [r[0], r[1]]), [['1', 'Di'], ['2', 'Cy'], ['3', 'Bo'], ['4', 'Ada']]);
  assert.equal(await page.getAttribute('#fmSortLap', 'aria-pressed'), 'true'); assert.equal(await page.getAttribute('#fmHeadLap', 'class'), 'lab on'); assert.equal(await page.getAttribute('#fmHeadTime', 'class'), 'lab');
  await page.click('#fmBoards .snd >> nth=0');
  assert.deepEqual(await chips(page), [['ROOKIE · ASSIST', 'true'], ['VETERAN · NO ASSIST', 'false']]);
  assert.deepEqual(await rows(page), [['1', 'Ada', '1:28.20', '0:29.90', 'first']]); assert.equal(await note(page), 'Not raced here yet: Bo, Cy, Di, Ed');
  await page.click('#fmSortTime'); assert.equal((await rows(page)).length, 1);
  await close();
});

test('the screen opens again on the player\'s own board, not on the one that was last looked at', async () => {
  const { page, close } = await open(FAMILY());
  await page.click('#familyBtn'); await page.click('#fmBoards .snd >> nth=0'); await page.click('#fmBack');
  await page.click('#familyBtn'); assert.deepEqual(await chips(page), [['ROOKIE · ASSIST', 'false'], ['VETERAN · NO ASSIST', 'true']]);
  await close();
});

test('it opens from "Who\'s playing?" too, and BACK, Escape and the browser Back return to where it was opened', async () => {
  const { page, errors, close } = await open(FAMILY());
  await page.click('#whoBtn'); assert.equal(await page.isVisible('#plFamily'), true);
  await page.click('#plFamily'); assert.deepEqual(await screen(page), ['family']);
  await page.click('#fmBack'); assert.deepEqual(await screen(page), ['players']);
  await page.click('#plFamily'); await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['players']);
  await page.click('#plFamily'); await page.goBack(); assert.deepEqual(await screen(page), ['players']);
  await page.click('#plBack'); await page.click('#familyBtn'); await page.goBack(); assert.deepEqual(await screen(page), ['menu']);
  assert.deepEqual(errors, []); await close();
});

test('the keyboard works: a board chip is a button (Enter picks it), and nothing starts a race', async () => {
  const { page, close } = await open(FAMILY());
  await page.click('#familyBtn'); await page.focus('#fmBoards .snd >> nth=0'); await page.keyboard.press('Enter');
  assert.equal((await chips(page))[0][1], 'true'); assert.deepEqual(await screen(page), ['family']); assert.equal(await page.evaluate(() => __mm.S.attract), true);
  await close();
});

test('nobody has raced: the board says so instead of showing an empty table', async () => {
  const { page, close } = await open(household([ch('a', 'Ada'), ch('b', 'Bo')]));
  await page.click('#familyBtn');
  assert.equal(await page.isVisible('#fmEmpty'), true); assert.equal(await page.isVisible('#fmControls'), false); assert.match(await page.textContent('#fmEmpty'), /Nobody has set a time yet/);
  await close();
});

test('it follows the household: a new player makes the button appear, deleting down to one makes it go, renaming shows on the board', async () => {
  const { page, close } = await open(household([ch('a', 'Ada', 'veteran', { [V]: best(80, 26) })]));
  assert.equal(await page.isVisible('#familyBtn'), false);
  await page.click('#whoBtn'); await page.click('#plNew'); await page.fill('#pdName', 'Bo'); await page.click('#pdSave');
  assert.equal(await page.isVisible('#familyBtn'), true, 'back on the start screen with two players');
  await page.click('#whoBtn'); await page.click('#plList .snd[data-id=a]'); await page.fill('#pdName', 'Zed'); await page.click('#pdSave'); await page.click('#plFamily');
  assert.deepEqual((await rows(page)).map(r => r[1]), ['Zed']); assert.equal(await note(page), 'Not raced here yet: Bo');
  await page.click('#fmBack'); await page.click('#plList .snd[data-id=a]'); await page.click('#pdDelete'); await page.click('#pdDelete');
  assert.equal(await page.isVisible('#plFamily'), false, 'one player left'); await page.click('#plBack'); assert.equal(await page.isVisible('#familyBtn'), false);
  await close();
});

test('a race you finish is on the board: your time, from your own best', async () => {
  const { page, errors, close } = await open(household([ch('a', 'Ada', 'veteran', { [V]: best(99, 30) }), ch('b', 'Bo')], 'b'));
  await page.click('#start'); await waitRace(page); await END.finish(page); await page.waitForSelector('#again', { state: 'visible', timeout: 10000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mm:profile')).characters[1].bests['classic/veteran/manual']);
  assert.equal(typeof stored.time, 'number');
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' }); await page.click('#familyBtn');
  const r = await rows(page); assert.equal(r.length, 2);
  const bo = r.find(x => x[1] === 'Bo'); assert.equal(bo[2], fmtTime(stored.time, 2)); assert.equal(bo[4], 'me' + (stored.time < 99 ? ' first' : ''));
  assert.deepEqual(errors, []); await close();
});

test('names are only ever text on the board, and a name that cannot be a board key is harmless', async () => {
  const { page, errors, close } = await open(household([ch('a', '<img src=x onerror=__PWNED=1>', 'veteran', { [V]: best(80, 26) }), ch('b', 'Bo', 'veteran', { [V]: best(81, 27) })]));
  await page.click('#familyBtn'); await page.waitForTimeout(150);
  assert.deepEqual((await rows(page)).map(r => r[1]), ['<img src=x onerr', 'Bo']);
  assert.equal(await page.$$eval('#family img', e => e.length), 0); assert.equal(await page.evaluate(() => window.__PWNED === undefined), true);
  assert.deepEqual(errors, []); await close();
});

for (const [name, w, h] of [['iPhone SE sideways', 667, 375], ['standard phone sideways', 844, 390], ['phone upright', 390, 844], ['narrow phone', 320, 568], ['desktop', 1000, 700]]) {
  test(`the family board fits and scrolls vertically only, with BACK on screen: ${name} (${w}x${h})`, async () => {
    const people = Array.from({ length: 8 }, (_, i) => ch('p' + i, i % 2 ? 'WWWWWWWWWWWWWWWW' : 'Player ' + i, 'veteran', { [V]: best(80 + i * 0.37, 26 + i * 0.11), ...(i < 3 ? { [R]: best(90 + i, 28) } : {}) }));
    const { page, close } = await open(household(people), { device: { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < 900 } });
    await page.click('#familyBtn');
    const m = await page.evaluate(() => { const e = document.getElementById('family'), back = document.getElementById('fmBack').getBoundingClientRect(); return { noSideways: e.scrollWidth <= e.clientWidth, backOn: back.top >= 0 && back.bottom <= innerHeight, over: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).length }; });
    assert.deepEqual(m, { noSideways: true, backOn: true, over: 0 });
    assert.equal((await rows(page)).length, 8); await close();
  });
}
