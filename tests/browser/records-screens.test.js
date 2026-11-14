import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';
import { goodRecord, finishRecord } from '../helpers/records.js';
import { updateBests } from '../../src/records.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

// A saved profile with the given races (oldest first), as the game would have written it.
const profileOf = races => { const bests = {}; for (const r of races) updateBests(bests, r); return { version: 2, settings: { level: 'veteran', presets: {} }, races, bests }; };
const day = i => new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + i * 3600e3).toISOString();
const sample = n => Array.from({ length: n }, (_, i) => { const r = i % 5 === 3 ? goodRecord({ kind: 'wrecked' }) : finishRecord('r' + i, 80 + (i % 9), [27 + (i % 4), 26.5, 27]); r.id = 'r' + i; r.ts = day(i); return r; });
// Opens the game with a profile already in storage (a fresh context has none otherwise).
async function open(profile, { device = DESKTOP, query = '?debug' } = {}) {
  const t = await newPage(browser, { ...device, locale: 'en-GB', timezoneId: 'UTC' });
  if (profile) await t.page.addInitScript(p => { if (!localStorage.getItem('mm:profile')) localStorage.setItem('mm:profile', JSON.stringify(p)); }, profile);
  await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector(query.includes('lab') ? '#labExit' : '#start', { state: 'visible' });
  return t;
}
const screen = page => page.evaluate(() => ['menu', 'end', 'history', 'detail'].filter(id => !document.getElementById(id).hidden));
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent));

test('the start screen has a RECORDS button; with no races the screen says so, and BACK returns to the start screen', async () => {
  const { page, errors, close } = await open(null);
  assert.equal(await page.isVisible('#recordsBtn'), true);
  await page.click('#recordsBtn');
  assert.deepEqual(await screen(page), ['history']);
  assert.equal(await page.isVisible('#histEmpty'), true); assert.equal(await page.isVisible('#histBoards'), false); assert.equal((await texts(page, '.hrow')).length, 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'histBack', 'the focus is on BACK');
  await page.click('#histBack'); assert.deepEqual(await screen(page), ['menu']);
  assert.deepEqual(errors, []); await close();
});

test('the list shows your races newest first, each with its result, board, best lap and date, and your bests above it', async () => {
  const races = [finishRecord('a', 83.4, [28.1, 27.3, 27.9]), goodRecord({ kind: 'wrecked' }), finishRecord('c', 90.2, [30.5, 29.9, 29.8], { level: 'rookie', assist: true })];
  races[0].ts = day(0); races[1].ts = day(1); races[2].ts = day(2); races[1].id = 'b'; races[2].result.place = 4;
  const { page, close } = await open(profileOf(races));
  await page.click('#recordsBtn');
  const heads = await texts(page, '.hrow .hh'), subs = await texts(page, '.hrow .hs'), whens = await texts(page, '.hrow .hw');
  assert.equal(heads.length, 3); assert.match(heads[0], /^4TH · 1:30\.2$/); assert.match(heads[1], /^WRECKED · /); assert.match(heads[2], /^[123]ST|^[123]ND|^[123]RD|^[0-9]TH/);
  assert.equal(subs[0], 'ROOKIE · ASSIST · BEST LAP 0:29.80'); assert.match(subs[2], /^VETERAN · NO ASSIST · BEST LAP 0:27\.30$/);
  assert.deepEqual(whens, ['1 Nov, 14:00', '1 Nov, 13:00', '1 Nov, 12:00'], 'local date and time (the test pins the time zone and the locale)');
  assert.equal(await page.isVisible('#histBoards'), true, 'the bests box is on screen');
  assert.deepEqual(await texts(page, '.hboard .lab'), ['ROOKIE · ASSIST', 'VETERAN · NO ASSIST']);
  assert.deepEqual(await texts(page, '.hboard b'), ['1:30.20', '0:29.80', '1:23.40', '0:25.67'], 'the best lap includes the wrecked race\'s laps (a real race, with a 25.67 s lap)');
  await close();
});

test('a race opens its details; BACK returns to the list; Escape and the phone\'s Back button do the same', async () => {
  const { page, errors, close } = await open(profileOf(sample(8)));
  await page.click('#recordsBtn'); await page.click('.hrow >> nth=0');
  assert.deepEqual(await screen(page), ['detail']);
  assert.deepEqual(await texts(page, '#detRows dt'), ['Date', 'Level', 'Driving assist', 'Place', 'Race time', 'Best lap', 'Laps', 'Wrecks', 'Wall touches']);
  assert.match(await page.textContent('#detTech'), /^seed \d+ · rules v1 · game 1\.4\.0 · id r7$/);
  assert.match(await page.textContent('#detTitle'), /./);
  await page.click('#detBack'); assert.deepEqual(await screen(page), ['history']);
  await page.click('.hrow >> nth=0'); await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['history']);
  await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['menu']);
  await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['menu'], 'Escape on the start screen does nothing');
  await page.click('#recordsBtn'); await page.click('.hrow >> nth=1');
  const url = page.url(); await page.goBack(); assert.deepEqual(await screen(page), ['history'], 'the browser Back button closes the details');
  await page.goBack(); assert.deepEqual(await screen(page), ['menu'], 'and then the records');
  assert.equal(page.url(), url, 'the page was never left'); assert.deepEqual(errors, []); await close();
});

test('returning from a race\'s details restores the scroll position and the focus', async () => {
  const { page, close } = await open(profileOf(sample(30)), { device: { viewport: { width: 700, height: 420 } } });
  await page.click('#recordsBtn');
  await page.evaluate(() => { document.getElementById('history').scrollTop = 600; });
  const y0 = await page.evaluate(() => document.getElementById('history').scrollTop);
  assert.ok(y0 > 300, 'the list scrolls (' + y0 + ')');
  const target = await page.evaluate(() => { const rows = [...document.querySelectorAll('.hrow')]; const r = rows.find(e => e.getBoundingClientRect().top > 100); r.click(); return r.dataset.id; });
  assert.deepEqual(await screen(page), ['detail']);
  await page.click('#detBack');
  assert.equal(await page.evaluate(() => document.getElementById('history').scrollTop), y0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), target, 'the focus is back on the race that was open');
  await close();
});

test('a long history shows 40 races and SHOW MORE adds 40 at a time until all are there', async () => {
  const { page, close } = await open(profileOf(sample(100)));
  await page.click('#recordsBtn');
  const n = () => page.$$eval('.hrow', e => e.length);
  assert.equal(await n(), 40); assert.equal(await page.isVisible('#histMore'), true);
  await page.click('#histMore'); assert.equal(await n(), 80);
  await page.click('#histMore'); assert.equal(await n(), 100); assert.equal(await page.isVisible('#histMore'), false);
  assert.equal(await page.$eval('.hrow', e => e.dataset.id), 'r99', 'newest first');
  await close();
});

test('the keyboard: Enter on a records screen does not start a race, Space presses the focused button, Tab reaches the list', async () => {
  const { page, close } = await open(profileOf(sample(5)));
  await page.keyboard.press('Tab');   // from the start screen: focus moves on in the page as usual
  await page.click('#recordsBtn');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'histBackup', 'Tab goes from BACK to BACKUP');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className.split(' ')[0]), 'hrow', 'and on to the first race');
  await page.keyboard.press('Space'); assert.deepEqual(await screen(page), ['detail'], 'Space pressed the focused race');
  assert.equal(await page.evaluate(() => __mm.input.fire), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'detBack', 'the details open with the focus on BACK');
  await page.keyboard.press('Enter'); assert.deepEqual(await screen(page), ['history'], 'Enter pressed BACK');
  await close();
});

test('Enter on a records screen with no button focused still does not start a race', async () => {
  const { page, close } = await open(profileOf(sample(3)));
  await page.click('#recordsBtn'); await page.evaluate(() => document.activeElement.blur());
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await page.waitForTimeout(150);
  assert.deepEqual(await screen(page), ['history']); assert.equal(await page.evaluate(() => __mm.S.attract), true, 'no race was started');
  await page.click('.hrow >> nth=0'); await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('Enter');
  assert.deepEqual(await screen(page), ['detail']); assert.equal(await page.evaluate(() => __mm.S.attract), true);
  await close();
});

test('Enter on the records screen\'s BACK button goes back and never starts a race', async () => {
  const { page, close } = await open(profileOf(sample(3)));
  await page.click('#recordsBtn'); assert.equal(await page.evaluate(() => document.activeElement.id), 'histBack');
  await page.keyboard.press('Enter');
  assert.deepEqual(await screen(page), ['menu']); assert.equal(await page.evaluate(() => __mm.S.attract), true, 'still the demo behind the menu: no race was started');
  await close();
});

test('on the start screen, Enter on a focused button presses that button instead of starting a race', async () => {
  const { page, close } = await open(null);
  await page.focus('#recordsBtn'); await page.keyboard.press('Enter');
  assert.deepEqual(await screen(page), ['history']); assert.equal(await page.evaluate(() => __mm.S.attract), true);
  await page.click('#histBack'); await page.focus('.lvl[data-level=rookie]'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => __mm.level), 'rookie', 'Enter pressed the ROOKIE button'); assert.deepEqual(await screen(page), ['menu']);
  await page.keyboard.press('Tab'); await page.focus('#start'); await page.keyboard.press('Enter'); await waitRace(page);
  assert.deepEqual(await screen(page), [], 'Enter on START starts the race');
  await close();
});

test('after a race, RECORDS on the results screen opens the list with that race at the top, and BACK returns to the results', async () => {
  const { page, close } = await open(profileOf(sample(4)));
  await page.click('#start'); await waitRace(page);
  await page.evaluate(() => { for (const c of __mm.S.cars) if (c !== __mm.S.player) c.alive = false; });
  await page.waitForSelector('#end', { state: 'visible', timeout: 10000 });
  await page.click('#endRecords'); assert.deepEqual(await screen(page), ['history']);
  const heads = await texts(page, '.hrow .hh'); assert.equal(heads.length, 5); assert.match(heads[0], /^LAST CAR STANDING/);
  await page.click('#histBack'); assert.deepEqual(await screen(page), ['end']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'again', 'the focus returns to RACE AGAIN');
  await page.keyboard.press('Enter'); await waitRace(page); assert.deepEqual(await screen(page), [], 'and Enter starts the next race');
  await close();
});

test('opening and closing the records leaves the browser history clean: a stray Forward does nothing, during a race too', async () => {
  const { page, errors, close } = await open(profileOf(sample(3)));
  await page.click('#recordsBtn'); await page.click('.hrow >> nth=0'); await page.click('#detBack'); await page.click('#histBack');
  assert.equal(await page.evaluate(() => history.state && history.state.mm), 0, 'back at the base entry');
  await page.goForward(); await page.waitForTimeout(150);
  assert.deepEqual(await screen(page), ['menu'], 'Forward does not reopen the records');
  await page.click('#start'); await waitRace(page);
  await page.goForward().catch(() => {}); await page.waitForTimeout(150);
  assert.deepEqual(await screen(page), [], 'no screen opens during a race');
  assert.deepEqual(errors, []); await close();
});

test('everything shown comes from storage as text, never as markup', async () => {
  // The level is shown upper-cased, so the handler name is too: it would set window.__PWNED if the text were ever turned into an element.
  const bad = finishRecord('<img src=x onerror="__pwned=1">', 80, [27, 26, 26], { level: '<img src=x onerror=__PWNED=1>' });
  bad.appVersion = '<script>__pwned=2</script>'; bad.ts = day(0);
  const { page, errors, close } = await open(profileOf([bad]));
  await page.click('#recordsBtn'); await page.click('.hrow');
  await page.waitForTimeout(200);   // an image with a bad address would fire its handler within this
  assert.deepEqual(await page.evaluate(() => [window.__pwned, window.__PWNED]), [undefined, undefined]);
  assert.equal(await page.$$eval('#history img, #detail img, #history script, #detail script', e => e.length), 0, 'no element was made from the text');
  assert.equal(await page.$$eval('#history .hs *, #detail dd *', e => e.length), 0, 'the rows contain text only');
  assert.match(await page.textContent('#detTech'), /<script>/, 'the text is shown as it is');
  assert.match(await page.$eval('#detRows dd:nth-of-type(2)', e => e.textContent), /<IMG SRC=X ONERROR=__PWNED=1>/, 'the hostile level is just text');
  assert.deepEqual(errors, []); await close();
});

test('BACK stays on screen while a long list is scrolled', async () => {
  const { page, close } = await open(profileOf(sample(60)), { device: { viewport: { width: 700, height: 420 } } });
  await page.click('#recordsBtn'); await page.evaluate(() => { document.getElementById('history').scrollTop = 1500; });
  const top = await page.evaluate(() => document.getElementById('histBack').getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 60, 'BACK is at the top of the screen, not scrolled away (' + top + ')');
  await close();
});

test('a profile with damaged records still shows the good ones', async () => {
  const good = sample(3), p = profileOf(good); p.races.splice(1, 0, { id: 'bad', result: 5 }, null, 'x'); p.bests = 'nonsense';
  const { page, errors, close } = await open(p);
  await page.click('#recordsBtn'); assert.equal((await texts(page, '.hrow')).length, 3);
  assert.deepEqual(errors, []); await close();
});

for (const [name, w, h] of [['iPhone SE sideways', 667, 375], ['standard phone sideways', 844, 390], ['phone upright', 390, 844], ['narrow phone', 320, 568], ['desktop', 1000, 700]]) {
  test(`the records screens fit the screen and scroll vertically only: ${name} (${w}x${h})`, async () => {
    const { page, close } = await open(profileOf(sample(60)), { device: { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < 900 } });
    await page.click('#recordsBtn'); await page.waitForTimeout(100);
    for (const id of ['history', 'detail']) {
      if (id === 'detail') await page.click('.hrow >> nth=0');
      const m = await page.evaluate(id => { const e = document.getElementById(id), back = document.getElementById(id === 'history' ? 'histBack' : 'detBack').getBoundingClientRect();
        return { noSideways: e.scrollWidth <= e.clientWidth, backInside: back.left >= 0 && back.right <= innerWidth && back.top >= 0, overflowing: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).length }; }, id);
      assert.deepEqual(m, { noSideways: true, backInside: true, overflowing: 0 }, id + ' ' + JSON.stringify(m));
    }
    await close();
  });
}
