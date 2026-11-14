import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '../helpers/server.js';
import { launch, newPage, DESKTOP } from '../helpers/browser.js';
import { finishRecord } from '../helpers/records.js';
import { updateBests, MAX_RACES } from '../../src/records.js';
import { encodeBackup, decodeBackup } from '../../src/backup.js';
import { cleanProfileDoc } from '../../src/profile.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const mk = (prefix, n, off = 0, settings = { level: 'veteran', presets: {} }) => {
  const races = Array.from({ length: n }, (_, i) => { const r = finishRecord(prefix + i, 80 + ((i + off) % 9), [27, 26.5, 27]); r.id = prefix + i; r.ts = new Date(Date.UTC(2026, 10, 1, 12) + (i + off) * 3600e3).toISOString(); return r; });
  const bests = {}; for (const r of races) updateBests(bests, r);
  return { version: 2, settings, races, bests, updatedAt: '2026-11-12T18:02:00.000Z' };
};
async function open(profile, { device = DESKTOP, query = '?debug' } = {}) {
  const t = await newPage(browser, { ...device, locale: 'en-GB', timezoneId: 'UTC', acceptDownloads: true });
  if (profile) await t.page.addInitScript(p => { if (!localStorage.getItem('mm:profile')) localStorage.setItem('mm:profile', JSON.stringify(p)); }, profile);
  await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector('#start', { state: 'visible' }); await t.page.waitForFunction(() => window.__mm);
  return t;
}
const toBackup = async page => { await page.click('#recordsBtn'); await page.click('#histBackup'); await page.waitForFunction(() => document.getElementById('bkCode').value.startsWith('MMP1')); };
const screen = page => page.evaluate(() => ['menu', 'end', 'history', 'backup', 'detail'].filter(id => !document.getElementById(id).hidden));
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('mm:profile')));
const status = page => page.textContent('#bkStatus');
// Pastes a code and checks it; returns after the answer is on screen.
const check = async (page, code) => { await page.fill('#bkInput', code); await page.click('#bkCheck'); await page.waitForFunction(() => document.getElementById('bkStatus').textContent !== ''); };
// Clicks something that ends in a page reload, and waits until the page has started again.
const reloading = async (page, sel) => { await page.evaluate(() => { window.__still = 1; }); await page.click(sel); await page.waitForFunction(() => window.__still === undefined, null, { timeout: 15000 }); await page.waitForSelector('#start', { state: 'visible' }); await page.waitForFunction(() => window.__mm); };

test('the records screen has a BACKUP button that opens a screen with a code of your profile, and BACK and Escape return', async () => {
  const { page, errors, close } = await open(mk('a', 12));
  await page.click('#recordsBtn'); assert.equal(await page.isVisible('#histBackup'), true);
  await page.click('#histBackup'); await page.waitForFunction(() => document.getElementById('bkCode').value.startsWith('MMP1')); assert.deepEqual(await screen(page), ['backup']);
  const code = await page.inputValue('#bkCode');
  assert.match(code, /^MMP1:z:[0-9a-f]{8}:[A-Za-z0-9_-]+$/); assert.match(await page.textContent('#bkInfo'), /^12 races and your settings, as a code of \d+ KB/);
  const d = await decodeBackup(code); assert.equal(d.ok, true); assert.equal(cleanProfileDoc(d.doc).races.length, 12);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bkBack');
  await page.click('#bkBack'); assert.deepEqual(await screen(page), ['history']);
  await page.click('#histBackup'); await page.keyboard.press('Escape'); assert.deepEqual(await screen(page), ['history']);
  await page.goBack(); assert.deepEqual(await screen(page), ['menu'], 'and the browser Back button too');
  assert.deepEqual(errors, []); await close();
});

test('a code made in one browser restores in another: ADD TO THIS DEVICE merges, keeps this device\'s settings, and the game starts again with the result', async () => {
  const a = await open(mk('a', 15, 0, { level: 'rookie', presets: { rookie: { pv: 1, tune: { gain: 1.5 }, assist: null } } }));
  await toBackup(a.page); const code = await a.page.inputValue('#bkCode'); await a.close();
  const b = await open(mk('b', 10, 10, { level: 'veteran', presets: {} }));   // 5 of its races are on the other device's dates, but with other ids
  await toBackup(b.page); await check(b.page, code);
  assert.equal(await b.page.isVisible('#bkPreview'), true);
  assert.match(await b.page.textContent('#bkPreviewText'), /^15 races, 15 new to this device\. 1 board of bests/);
  assert.match(await b.page.textContent('#bkReplaceNote'), /The 10 races here that are not in the code would be lost/);
  assert.equal((await stored(b.page)).races.length, 10, 'checking changes nothing');
  await reloading(b.page, '#bkMerge');
  const p = await stored(b.page);
  assert.equal(p.races.length, 25); assert.equal(new Set(p.races.map(r => r.id)).size, 25);
  assert.ok(p.races.every((r, i) => i === 0 || Date.parse(r.ts) >= Date.parse(p.races[i - 1].ts)), 'in date order');
  assert.equal(p.settings.level, 'veteran', 'this device\'s settings stay'); assert.equal(p.settings.presets.rookie, undefined, 'and the other device\'s tuning does not come along');
  assert.equal(await b.page.evaluate(() => __mm.level), 'veteran');
  await b.page.click('#recordsBtn'); assert.equal((await b.page.$$('.hrow')).length, 25);
  assert.deepEqual(await b.page.$$eval('.hrow', e => e.slice(0, 3).map(x => x.dataset.id)), ['b9', 'b8', 'b7'], 'newest first, from both devices');
  await b.close();
});

test('REPLACE EVERYTHING needs a second tap, then makes this device a copy of the code: its races, bests and settings', async () => {
  const a = await open(mk('a', 8, 0, { level: 'rookie', presets: { rookie: { pv: 1, tune: { gain: 1.5 }, assist: null } } }));
  await toBackup(a.page); const code = await a.page.inputValue('#bkCode'); await a.close();
  const b = await open(mk('b', 6));
  await toBackup(b.page); await check(b.page, code);
  await b.page.click('#bkReplace');
  assert.match(await b.page.textContent('#bkReplace'), /TAP AGAIN/); assert.match(await status(b.page), /cannot be undone/);
  assert.equal((await stored(b.page)).races.length, 6, 'one tap changed nothing');
  await reloading(b.page, '#bkReplace');
  const p = await stored(b.page);
  assert.deepEqual(p.races.map(r => r.id), Array.from({ length: 8 }, (_, i) => 'a' + i)); assert.equal(p.settings.level, 'rookie'); assert.equal(p.settings.presets.rookie.tune.gain, 1.5);
  assert.equal(await b.page.evaluate(() => __mm.level), 'rookie'); assert.deepEqual(Object.keys(p.bests), ['classic/veteran/manual']);
  await b.close();
});

test('the second tap must come soon: the REPLACE button disarms itself', async () => {
  const { page, close } = await open(mk('a', 3));
  const code = await encodeBackup(cleanProfileDoc(mk('z', 4))); await toBackup(page); await check(page, code);
  await page.click('#bkReplace'); assert.match(await page.textContent('#bkReplace'), /TAP AGAIN/);
  await page.waitForFunction(() => document.getElementById('bkReplace').textContent === 'REPLACE EVERYTHING', null, { timeout: 9000 });
  await page.click('#bkReplace'); assert.match(await page.textContent('#bkReplace'), /TAP AGAIN/, 'a tap after it disarmed is a first tap again');
  assert.equal((await stored(page)).races.length, 3); await close();
});

test('a wrong code is explained, nothing can be applied, and editing a checked code takes its preview away', async () => {
  const { page, errors, close } = await open(mk('a', 5));
  const good = await encodeBackup(cleanProfileDoc(mk('z', 4)));
  await toBackup(page);
  for (const [text, re] of [['hello', /not a Micro Mayhem backup code/], ['', /Paste a backup code first/], [good.slice(0, -20), /damaged or cut short/], [good.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), /damaged/], ['MMP1:r:' + '0'.repeat(8) + ':e30', /does not hold a profile|damaged/]]) {
    await check(page, text); assert.match(await status(page), re, text.slice(0, 30)); assert.equal(await page.isVisible('#bkPreview'), false); assert.match(await page.getAttribute('#bkStatus', 'class'), /err/);
  }
  await check(page, good); assert.equal(await page.isVisible('#bkPreview'), true); assert.match(await page.getAttribute('#bkStatus', 'class'), /ok/);
  await page.fill('#bkInput', good + 'x'); assert.equal(await page.isVisible('#bkPreview'), false, 'a preview belongs to the code that was checked');
  assert.equal((await stored(page)).races.length, 5); assert.deepEqual(errors, []); await close();
});

test('a code is accepted with line breaks and spaces in it, as it arrives after a trip through a chat app', async () => {
  const { page, close } = await open(mk('a', 3));
  const good = await encodeBackup(cleanProfileDoc(mk('z', 4)));
  await toBackup(page); await check(page, '  ' + good.replace(/(.{50})/g, '$1\n  ') + '\n');
  assert.equal(await page.isVisible('#bkPreview'), true); assert.match(await page.textContent('#bkPreviewText'), /^4 races, 4 new/);
  await close();
});

test('your own code adds nothing and changes nothing', async () => {
  const { page, close } = await open(mk('a', 9));
  await toBackup(page); const code = await page.inputValue('#bkCode'); await check(page, code);
  assert.match(await page.textContent('#bkPreviewText'), /^9 races, none new to this device\./);
  const before = (await stored(page)).races.map(r => r.id);
  await reloading(page, '#bkMerge'); assert.deepEqual((await stored(page)).races.map(r => r.id), before); await close();
});

test('SAVE AS FILE downloads the code, and LOAD A FILE reads one back and checks it', async () => {
  const a = await open(mk('a', 7));
  await toBackup(a.page);
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#bkSave')]);
  assert.match(dl.suggestedFilename(), /^micro-mayhem-backup-\d{4}-\d{2}-\d{2}\.txt$/);
  const text = fs.readFileSync(await dl.path(), 'utf8'); assert.equal(text, (await a.page.inputValue('#bkCode')) + '\n');
  const file = path.join(os.tmpdir(), 'mm-backup-test-' + process.pid + '.txt'); fs.writeFileSync(file, text); await a.close();   // (a download is deleted with its browser context)
  const b = await open(mk('b', 3)); await toBackup(b.page);
  await b.page.setInputFiles('#bkFile', file); await b.page.waitForFunction(() => document.getElementById('bkPreview').hidden === false);
  assert.match(await b.page.textContent('#bkPreviewText'), /^7 races, 7 new to this device\./); assert.match((await b.page.inputValue('#bkInput')), /^MMP1:/);
  await b.page.setInputFiles('#bkFile', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('not a code') }); await b.page.waitForFunction(() => /not a Micro Mayhem/.test(document.getElementById('bkStatus').textContent));
  assert.equal(await b.page.isVisible('#bkPreview'), false);
  await b.close();
});

test('if the browser will not keep the restored data, the screen says so and nothing changes', async () => {
  const { page, close } = await open(mk('a', 3));
  const code = await encodeBackup(cleanProfileDoc(mk('z', 4))); await toBackup(page); await check(page, code);
  await page.evaluate(() => { window.__still = 1; Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await page.click('#bkMerge'); await page.waitForTimeout(400);
  assert.match(await status(page), /not letting the game keep data/); assert.equal(await page.evaluate(() => window.__still), 1, 'the page did not reload');
  assert.equal((await stored(page)).races.length, 3); assert.equal(await page.evaluate(() => __mm.S.config.mode), 'attract'); await close();
});

test('typing in the code boxes is typing: M does not mute, Enter does not start a race', async () => {
  const { page, close } = await open(mk('a', 3));
  await toBackup(page); await page.click('#bkInput'); await page.keyboard.type('mm Mm\nwasd '); await page.keyboard.press('Enter');
  assert.equal(await page.textContent('#snd'), 'SOUND ON'); assert.equal(await page.evaluate(() => __mm.S.attract), true, 'no race started');
  assert.equal(await page.inputValue('#bkInput'), 'mm Mm\nwasd \n'); assert.deepEqual(await screen(page), ['backup']);
  await close();
});

test('leaving the screen forgets what was pasted', async () => {
  const { page, close } = await open(mk('a', 3));
  const code = await encodeBackup(cleanProfileDoc(mk('z', 4))); await toBackup(page); await check(page, code);
  await page.click('#bkBack');
  assert.equal(await page.evaluate(() => { document.getElementById('histBackup').click(); return document.getElementById('bkCode').value; }), '', 'the old code is gone the moment the screen opens, while the new one is made');
  await page.waitForFunction(() => document.getElementById('bkCode').value.startsWith('MMP1'));
  assert.equal(await page.inputValue('#bkInput'), ''); assert.equal(await page.isVisible('#bkPreview'), false); assert.equal(await status(page), '');
  await close();
});

test('a code with damaged records and hostile text restores what is good, and the rest only ever shows as text', async () => {
  const bad = mk('h', 3, 0, { level: '<img src=x onerror=__PWNED=2>', presets: {} }); bad.races[1].level = '<img src=x onerror=__PWNED=1>'; bad.races[0].result = 5;
  const doc = JSON.parse(JSON.stringify(bad)); doc.races.push(null, 'x');
  const text = JSON.stringify(doc).replace(/^\{/, '{"__proto__":{"polluted":1},');
  const raw = new TextEncoder().encode(text);
  const { crc32 } = await import('../../src/backup.js');
  const code = `MMP1:r:${crc32(raw)}:${Buffer.from(raw).toString('base64url')}`;
  const { page, errors, close } = await open(mk('a', 2));
  await toBackup(page); await check(page, code);
  assert.match(await page.textContent('#bkPreviewText'), /^2 races, 2 new to this device\./); assert.match(await page.textContent('#bkPreviewText'), /3 damaged records were left out/);
  assert.match(await page.textContent('#bkPreviewText'), /Level in the code: <IMG SRC=X ONERROR=__PWNED=2>\./, 'the level from the code is shown as text');
  assert.equal(await page.$$eval('#bkPreview *', e => e.filter(x => x.tagName === 'IMG').length), 0);
  await page.waitForTimeout(150); assert.deepEqual(await page.evaluate(() => [window.__PWNED === undefined]), [true]);
  await reloading(page, '#bkMerge');
  await page.click('#recordsBtn'); await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => [window.__PWNED === undefined, ({}).polluted === undefined]), [true, true], 'no script ran and no prototype was changed');
  assert.equal(await page.$$eval('#history img', e => e.length), 0); assert.equal((await page.$$('.hrow')).length, 4);
  assert.deepEqual(errors, []); await close();
});

test('a full history of 500 races backs up and restores in reasonable time', async () => {
  const a = await open(mk('a', MAX_RACES));
  const t0 = Date.now(); await toBackup(a.page); const code = await a.page.inputValue('#bkCode'); assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms to make the code`);
  assert.match(await a.page.textContent('#bkInfo'), /^500 races/); await a.close();
  const b = await open(null); await toBackup(b.page);
  const t1 = Date.now(); await check(b.page, code); assert.ok(Date.now() - t1 < 4000, `${Date.now() - t1} ms to check it`);
  assert.match(await b.page.textContent('#bkPreviewText'), /^500 races, 500 new/); await reloading(b.page, '#bkMerge'); assert.equal((await stored(b.page)).races.length, 500); await b.close();
});

for (const [name, w, h] of [['iPhone SE sideways', 667, 375], ['standard phone sideways', 844, 390], ['phone upright', 390, 844], ['narrow phone', 320, 568], ['desktop', 1000, 700]]) {
  test(`the backup screen fits and scrolls vertically only, with BACK on screen: ${name} (${w}x${h})`, async () => {
    const { page, close } = await open(mk('a', 20), { device: { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < 900 } });
    await toBackup(page); await check(page, await encodeBackup(cleanProfileDoc(mk('z', 6)))); await page.evaluate(() => document.getElementById('backup').scrollTo(0, 99999));
    const m = await page.evaluate(() => { const e = document.getElementById('backup'), back = document.getElementById('bkBack').getBoundingClientRect(); return { noSideways: e.scrollWidth <= e.clientWidth, backOn: back.top >= 0 && back.bottom <= innerHeight, over: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).length }; });
    assert.deepEqual(m, { noSideways: true, backOn: true, over: 0 }, JSON.stringify(m));
    assert.equal(await page.isVisible('#bkMerge'), true); await close();
  });
}

test('the top bar has a background, so scrolled content does not run under the BACK button (records list, backup, details)', async () => {
  const { page, close } = await open(mk('a', 30));
  const bg = sel => page.$eval(sel, e => { const t = e.closest('.topbar'), c = getComputedStyle(t); return c.backgroundImage !== 'none' || (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent'); });
  await page.click('#recordsBtn'); assert.equal(await bg('#histBack'), true);
  await page.click('.hrow >> nth=0'); assert.equal(await bg('#detBack'), true); await page.click('#detBack');
  await page.click('#histBackup'); assert.equal(await bg('#bkBack'), true);
  await close();
});
