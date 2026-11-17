import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';
import { finishRecord } from '../helpers/records.js';
import { bestsFromRaces } from '../../src/records.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const T = '2026-11-12T18:02:00.000Z';
const ch = (id, name, level = 'veteran', n = 0) => {
  const races = Array.from({ length: n }, (_, i) => { const r = finishRecord(`${id}-${i}`, 80 + i, [27, 26.5, 27], { level }); r.id = `${id}-${i}`; r.ts = new Date(Date.UTC(2026, 10, 1, 12) + i * 3600e3).toISOString(); return r; });
  return { id, name, level, createdAt: T, updatedAt: T, races, bests: bestsFromRaces(races) };
};
const household = (characters, current = characters[0].id) => ({ version: 3, household: { id: 'house-1', createdAt: T }, settings: { presets: {}, character: current }, characters, updatedAt: T });
const TRIO = () => household([ch('a', 'Ada', 'veteran', 2), ch('b', 'Bo', 'rookie', 1), ch('c', 'Cy', 'veteran', 3)], 'b');

async function open(profile, { device = DESKTOP, query = '?debug' } = {}) {
  const t = await newPage(browser, { ...device, locale: 'en-GB', timezoneId: 'UTC' });
  if (profile) await t.page.addInitScript(p => { if (!localStorage.getItem('mm:profile')) localStorage.setItem('mm:profile', JSON.stringify(p)); }, profile);
  await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector('#start', { state: 'visible' }); await t.page.waitForFunction(() => window.__mm);
  return t;
}
const screen = page => page.evaluate(() => ['menu', 'end', 'history', 'backup', 'detail', 'players', 'player'].filter(id => !document.getElementById(id).hidden));
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('mm:profile')));
const me = p => p.characters.find(c => c.id === p.settings.character);
const who = page => page.textContent('#whoBtn');
const rows = page => page.$$eval('#plList .pick', e => e.map(x => [x.dataset.id, x.querySelector('.hh').textContent, x.querySelector('.hw').textContent, x.querySelector('.hs').textContent]));
const toList = async page => { await page.click('#whoBtn'); await page.waitForSelector('#plList .pick'); };
const END = { finish: page => page.evaluate(() => { __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }) };

test('a new device asks for a name; renaming Player makes it you, and the start screen says so', async () => {
  const { page, errors, close } = await open(null);
  assert.equal(await who(page), 'WHO ARE YOU? SET YOUR NAME');
  await toList(page); assert.deepEqual(await screen(page), ['players']);
  const only = await rows(page); assert.equal(only.length, 1); assert.deepEqual(only[0].slice(1), ['Player', 'PLAYING', 'VETERAN · 0 RACES']);
  await page.click('#plList .snd'); assert.deepEqual(await screen(page), ['player']);
  assert.equal(await page.inputValue('#pdName'), 'Player'); assert.equal(await page.isDisabled('#pdDelete'), true, 'the only player cannot be deleted');
  assert.match(await page.textContent('#pdNote'), /last player cannot be deleted/);
  await page.fill('#pdName', '  Ada  '); await page.keyboard.press('Enter');
  assert.deepEqual(await screen(page), ['players']); assert.equal((await rows(page))[0][1], 'Ada');
  await page.click('#plBack'); assert.deepEqual(await screen(page), ['menu']); assert.equal(await who(page), 'PLAYING AS ADA · CHANGE');
  assert.deepEqual((await stored(page)).characters.map(c => c.name), ['Ada']);
  assert.deepEqual(errors, []); await close();
});

test('a new player: added, made the one who plays, and still there after a reload', async () => {
  const { page, errors, close } = await open(household([ch('a', 'Ada', 'veteran', 2)]));
  await toList(page); await page.click('#plNew'); assert.deepEqual(await screen(page), ['player']);
  assert.equal(await page.inputValue('#pdName'), ''); assert.equal(await page.isVisible('#pdDelete'), false, 'there is nothing to delete yet');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pdName', 'the name box is ready to type in');
  await page.keyboard.type('Bo'); await page.click('#pdSave');
  assert.deepEqual(await screen(page), ['menu']); assert.equal(await who(page), 'PLAYING AS BO · CHANGE');
  const p = await stored(page); assert.equal(p.characters.length, 2); assert.equal(me(p).name, 'Bo'); assert.deepEqual([me(p).level, me(p).races.length], ['veteran', 0]);
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' }); assert.equal(await who(page), 'PLAYING AS BO · CHANGE');
  assert.deepEqual(errors, []); await close();
});

test('a new player starts on Veteran: the level buttons and the assist follow, whoever played before', async () => {
  const { page, close } = await open(household([ch('a', 'Ada', 'rookie')]));
  assert.equal(await page.evaluate(() => __mm.level), 'rookie'); assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON');
  await toList(page); await page.click('#plNew'); await page.fill('#pdName', 'Dee'); await page.click('#pdSave');
  assert.equal(await page.evaluate(() => __mm.level), 'veteran'); assert.equal(await page.evaluate(() => __mm.S.assist), false);
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: OFF'); assert.equal(await page.locator('.lvl[aria-pressed=true]').getAttribute('data-level'), 'veteran');
  assert.deepEqual((await stored(page)).characters.map(c => [c.name, c.level]), [['Ada', 'rookie'], ['Dee', 'veteran']], 'Ada is still on Rookie');
  await close();
});

test('choosing a player takes up their level and assist, remembers them, and returns to the start screen', async () => {
  const { page, errors, close } = await open(TRIO());
  assert.equal(await who(page), 'PLAYING AS BO · CHANGE'); assert.equal(await page.evaluate(() => __mm.level), 'rookie');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON'); assert.equal(await page.locator('.lvl[aria-pressed=true]').getAttribute('data-level'), 'rookie');
  await toList(page);
  assert.deepEqual(await rows(page), [['a', 'Ada', 'PLAY', 'VETERAN · 2 RACES'], ['b', 'Bo', 'PLAYING', 'ROOKIE · 1 RACE'], ['c', 'Cy', 'PLAY', 'VETERAN · 3 RACES']]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'b', 'the focus is on the player who is on');
  await page.click('#plList .pick[data-id=a]');
  assert.deepEqual(await screen(page), ['menu']); assert.equal(await who(page), 'PLAYING AS ADA · CHANGE');
  assert.equal(await page.evaluate(() => __mm.level), 'veteran'); assert.equal(await page.evaluate(() => __mm.S.assist), false);
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: OFF'); assert.equal(await page.locator('.lvl[aria-pressed=true]').getAttribute('data-level'), 'veteran');
  assert.equal((await stored(page)).settings.character, 'a');
  await toList(page); await page.click('#plList .pick[data-id=b]');
  assert.equal(await page.evaluate(() => __mm.level), 'rookie'); assert.equal(await page.evaluate(() => __mm.S.assist), true);
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' }); assert.equal(await who(page), 'PLAYING AS BO · CHANGE');
  assert.deepEqual(errors, []); await close();
});

test('changing the level changes it for the player who is on, and for nobody else', async () => {
  const { page, close } = await open(TRIO());
  await page.click('.lvl[data-level=veteran]');   // Bo goes from Rookie to Veteran
  const p = await stored(page); assert.deepEqual(p.characters.map(c => [c.id, c.level]), [['a', 'veteran'], ['b', 'veteran'], ['c', 'veteran']]);
  await toList(page); assert.equal((await rows(page))[1][3], 'VETERAN · 1 RACE');
  await close();
});

test('races go into the history of the player who is on, and the results and records say whose', async () => {
  const { page, errors, close } = await open(TRIO());
  await toList(page); await page.click('#plList .pick[data-id=c]');
  await page.click('#start'); await waitRace(page); await END.finish(page); await page.waitForSelector('#again', { state: 'visible', timeout: 10000 });
  assert.match(await page.textContent('#endKick'), /CHEQUERED FLAG · CY$/);
  const p = await stored(page); assert.deepEqual(p.characters.map(c => [c.id, c.races.length]), [['a', 2], ['b', 1], ['c', 4]]);
  await page.click('#endRecords'); assert.equal(await page.textContent('#histKick'), 'Cy’s races'); assert.equal((await page.$$('.hrow')).length, 4);
  await page.click('#histBack'); await page.click('#again'); await waitRace(page);
  assert.deepEqual(errors, []); await close();
});

test('a name that is wrong is explained and nothing changes: empty, taken (capitals do not matter), and a rename onto someone else', async () => {
  const { page, close } = await open(TRIO());
  await toList(page); await page.click('#plNew');
  await page.click('#pdSave'); assert.equal(await page.textContent('#pdStatus'), 'Type a name first.'); assert.match(await page.getAttribute('#pdStatus', 'class'), /err/);
  await page.fill('#pdName', '   '); await page.keyboard.press('Enter'); assert.equal(await page.textContent('#pdStatus'), 'Type a name first.');
  await page.fill('#pdName', 'cY'); assert.equal(await page.textContent('#pdStatus'), '', 'typing clears the message');
  await page.click('#pdSave'); assert.equal(await page.textContent('#pdStatus'), 'Someone in your household already has that name.'); assert.deepEqual(await screen(page), ['player']);
  assert.equal((await stored(page)).characters.length, 3);
  await page.click('#pdBack'); await page.click('#plList .snd[data-id=a]');   // Ada -> Bo's name
  await page.fill('#pdName', 'BO'); await page.click('#pdSave'); assert.match(await page.textContent('#pdStatus'), /already has that name/);
  await page.fill('#pdName', 'ADA'); await page.click('#pdSave');   // capitals of one's own name may change
  assert.deepEqual(await screen(page), ['players']); assert.equal((await stored(page)).characters[0].name, 'ADA');
  await close();
});

test('a long name is cut to 16 characters; a name with markup is only ever text, on every screen that shows it', async () => {
  const { page, errors, close } = await open(household([ch('a', 'Ada', 'veteran', 1)]));
  await toList(page); await page.click('#plNew');
  assert.equal(await page.getAttribute('#pdName', 'maxlength'), '16'); assert.deepEqual(await page.$eval('#pdName', e => [e.autocomplete, e.spellcheck]), ['off', false], 'the browser does not offer to remember or check names'); 
  await page.fill('#pdName', '<img src=x onerror=__PWNED=1>'); await page.click('#pdSave');
  assert.equal(await who(page), 'PLAYING AS <IMG SRC=X ONERR · CHANGE'); assert.equal((await stored(page)).characters[1].name, '<img src=x onerr');
  await page.click('#start'); await waitRace(page); await END.finish(page); await page.waitForSelector('#again', { state: 'visible', timeout: 10000 });
  assert.match(await page.textContent('#endKick'), /CHEQUERED FLAG · <IMG SRC=X ONERR$/);
  await page.click('#endRecords'); assert.equal(await page.textContent('#histKick'), '<img src=x onerr\u2019s races');
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' }); await toList(page); await page.waitForTimeout(150);
  assert.deepEqual((await rows(page)).map(r => r[1]), ['Ada', '<img src=x onerr']);
  assert.equal(await page.$$eval('img', e => e.length), 0, 'no element was made from a name'); assert.equal(await page.evaluate(() => window.__PWNED === undefined), true);
  assert.deepEqual(errors, []); await close();
});

test('a household holds 8: the ninth cannot be added, and the screen says why', async () => {
  const { page, close } = await open(household(Array.from({ length: 8 }, (_, i) => ch('p' + i, 'P' + i))));
  await toList(page); assert.equal((await rows(page)).length, 8);
  assert.equal(await page.isDisabled('#plNew'), true); assert.match(await page.textContent('#plNote'), /up to 8 players/);
  assert.ok(Number(await page.$eval('#plNew', e => getComputedStyle(e).opacity)) < 1, 'and the button looks disabled')
  await close();
});

test('deleting a player asks twice, takes their races with them, and the first tap alone changes nothing', async () => {
  const { page, close } = await open(TRIO());
  await toList(page); await page.click('#plList .snd[data-id=c]');
  assert.match(await page.textContent('#pdNote'), /their 3 races/);
  await page.click('#pdDelete'); assert.match(await page.textContent('#pdDelete'), /TAP AGAIN/); assert.equal((await stored(page).catch(() => ({ characters: [1, 2, 3] }))).characters.length, 3);
  await page.click('#pdDelete');
  assert.deepEqual(await screen(page), ['players']); assert.deepEqual((await rows(page)).map(r => r[0]), ['a', 'b']);
  assert.deepEqual((await stored(page)).characters.map(c => c.id), ['a', 'b']);
  await close();
});

test('the delete button disarms itself: a tap after it did is a first tap again', async () => {
  const { page, close } = await open(TRIO());
  await toList(page); await page.click('#plList .snd[data-id=c]');
  await page.click('#pdDelete'); assert.match(await page.textContent('#pdDelete'), /TAP AGAIN/);
  await page.waitForFunction(() => document.getElementById('pdDelete').textContent === 'DELETE PLAYER', null, { timeout: 9000 });
  await page.click('#pdDelete'); assert.match(await page.textContent('#pdDelete'), /TAP AGAIN/); assert.deepEqual(await screen(page), ['player']);
  await page.click('#pdBack'); await page.click('#plList .snd[data-id=c]'); assert.equal(await page.textContent('#pdDelete'), 'DELETE PLAYER', 'leaving the screen disarms it too');
  await close();
});

test('deleting the player who is on makes the first one play, at their level; the last player cannot be deleted', async () => {
  const { page, close } = await open(TRIO());   // Bo (Rookie) is on
  await toList(page); await page.click('#plList .snd[data-id=b]'); await page.click('#pdDelete'); await page.click('#pdDelete');
  assert.deepEqual((await rows(page)).map(r => [r[0], r[2]]), [['a', 'PLAYING'], ['c', 'PLAY']]);
  await page.click('#plBack'); assert.equal(await who(page), 'PLAYING AS ADA · CHANGE'); assert.equal(await page.evaluate(() => __mm.level), 'veteran'); assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: OFF');
  assert.equal((await stored(page)).settings.character, 'a');
  await toList(page); await page.click('#plList .snd[data-id=c]'); await page.click('#pdDelete'); await page.click('#pdDelete');
  await page.click('#plList .snd[data-id=a]'); assert.equal(await page.isDisabled('#pdDelete'), true); assert.equal((await stored(page)).characters.length, 1);
  await close();
});

test('keyboard and the Back button: Enter picks, typing in the name box is typing, Escape and Back close a screen, nothing starts a race', async () => {
  const { page, errors, close } = await open(TRIO());
  await toList(page); await page.keyboard.press('Enter');   // the player who is on has the focus
  assert.deepEqual(await screen(page), ['menu']); assert.equal(await page.evaluate(() => __mm.S.attract), true, 'Enter picked a player, it did not start a race');
  await toList(page); await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['menu']);
  await toList(page); await page.click('#plNew'); await page.keyboard.type('mm M wasd'); assert.equal(await page.textContent('#snd'), 'SOUND ON'); assert.equal(await page.evaluate(() => __mm.S.attract), true);
  assert.equal(await page.inputValue('#pdName'), 'mm M wasd'); await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['players']);
  await page.goBack(); assert.deepEqual(await screen(page), ['menu'], 'the browser Back button closes the screen');
  await toList(page); await page.click('#plNew'); await page.keyboard.type('Dee'); await page.keyboard.press('Enter');
  assert.equal(await who(page), 'PLAYING AS DEE · CHANGE'); assert.deepEqual(await screen(page), ['menu']);
  assert.deepEqual(errors, []); await close();
});

for (const [name, w, h] of [['iPhone SE sideways', 667, 375], ['standard phone sideways', 844, 390], ['phone upright', 390, 844], ['narrow phone', 320, 568], ['desktop', 1000, 700]]) {
  test(`the players screens fit and scroll vertically only, with BACK on screen: ${name} (${w}x${h})`, async () => {
    const { page, close } = await open(household(Array.from({ length: 8 }, (_, i) => ch('p' + i, i === 3 ? 'Sixteen Letters!!' : 'Player ' + i, i % 2 ? 'rookie' : 'veteran', i))), { device: { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < 900 } });
    const measure = id => page.evaluate(i => { const e = document.getElementById(i), back = e.querySelector('.topbar button').getBoundingClientRect(); return { noSideways: e.scrollWidth <= e.clientWidth, backOn: back.top >= 0 && back.bottom <= innerHeight, over: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).length }; }, id);
    await toList(page); assert.deepEqual(await measure('players'), { noSideways: true, backOn: true, over: 0 }, 'list');
    await page.evaluate(() => document.getElementById('players').scrollTo(0, 99999)); assert.equal(await page.isVisible('#plNew'), true);
    await page.click('#plList .snd[data-id=p3]'); assert.deepEqual(await measure('player'), { noSideways: true, backOn: true, over: 0 }, 'one player');
    await page.evaluate(() => document.getElementById('player').scrollTo(0, 99999));
    assert.equal(await page.isVisible('#pdSave'), true); assert.equal(await page.isVisible('#pdDelete'), true);
    await close();
  });
}

test('the start screen with a long name still fits: the button wraps instead of overflowing', async () => {
  const { page, close } = await open(household([ch('a', 'WWWWWWWWWWWWWWWW')]), { device: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true } });
  const m = await page.evaluate(() => { const e = document.getElementById('menu'), b = document.getElementById('whoBtn').getBoundingClientRect(); return { noSideways: e.scrollWidth <= e.clientWidth, inside: b.right <= innerWidth && b.left >= 0 }; });
  assert.deepEqual(m, { noSideways: true, inside: true }); await close();
});
