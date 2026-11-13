import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../helpers/server.js';
import { launch, newPage, DESKTOP, PHONE } from '../helpers/browser.js';
import { ROOT } from '../helpers/sim.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

// The files are byte-identical to what Google Fonts served (checked when they were adopted). Pinning their hashes catches an
// accidental edit or a corrupt copy.
const FILES = {
  'bungee-latin-400-normal.woff2': '126eec706b7931682dbcf6c6efc274132c603f181fbf912678e6cfeb341e721b',
  'barlow-condensed-latin-500-normal.woff2': '460f141ec8f6c9a1516bfd2bd9fe71656246d7a9d04a0955faf53158d8970c4c',
  'barlow-condensed-latin-600-normal.woff2': '215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66',
  'barlow-condensed-latin-700-normal.woff2': '3787a5a419171630e6890cfa47c4da067474d005cd0ff8dc11ec090fdc3ee2b8'
};

test('the font files are the ones we expect, and the licences travel with them', () => {
  for (const [name, expected] of Object.entries(FILES)) {
    const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'fonts', name))).digest('hex');
    assert.equal(sum, expected, `${name} changed`);
  }
  const lic = fs.readFileSync(path.join(ROOT, 'fonts', 'LICENSES.txt'), 'utf8');
  assert.match(lic, /SIL OPEN FONT LICENSE/i);
  assert.match(lic, /Bungee Project Authors/);
  assert.match(lic, /Barlow Project Authors/);
});

for (const [label, device] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`fonts load from this site, once each, with nothing fetched from a third party (${label})`, async () => {
    const { page, errors, close } = await newPage(browser, device);
    const fontResponses = [], warnings = [];
    page.on('response', r => { if (/\.woff2?(\?|$)/.test(r.url())) fontResponses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] }); });
    page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(srv.url + '/index.html?debug');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    assert.ok(fontResponses.length >= 3, `expected the menu to use at least 3 font files, saw ${fontResponses.length}`);
    for (const r of fontResponses) {
      assert.ok(r.url.startsWith(srv.url + '/fonts/'), `font from elsewhere: ${r.url}`);
      assert.equal(r.status, 200, r.url); assert.match(r.type, /font\/woff2/, r.url);
    }
    const urls = fontResponses.map(r => r.url);
    assert.equal(new Set(urls).size, urls.length, 'each font file is downloaded once (a preload with the wrong crossorigin setting downloads twice)');
    assert.deepEqual(warnings.filter(w => /preload/i.test(w)), [], 'no unused or mismatched preload warnings');

    const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/["']/g, '') + ' ' + f.weight));
    assert.ok(loaded.includes('Bungee 400'), `loaded: ${loaded}`);
    assert.ok(loaded.includes('Barlow Condensed 600'), `loaded: ${loaded}`);
    assert.ok(await page.evaluate(() => document.fonts.check('40px Bungee') && document.fonts.check('600 20px "Barlow Condensed"')));
    assert.deepEqual(errors, [], 'no errors and no external requests');
    await close();
  });
}

test('the page really renders in the hosted fonts, not a fallback', async () => {
  const { page, close } = await newPage(browser, DESKTOP);
  await page.goto(srv.url + '/index.html');
  await page.evaluate(() => document.fonts.ready);
  const w = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d'), text = 'MICRO MAYHEM 0123456789';
    const width = font => { c.font = font; return c.measureText(text).width; };
    return { bungee: width('400 40px Bungee, Impact'), impact: width('400 40px Impact'), barlow: width('600 40px "Barlow Condensed", "Arial Narrow"'), narrow: width('600 40px "Arial Narrow"') };
  });
  assert.notEqual(Math.round(w.bungee), Math.round(w.impact), 'Bungee must not be the Impact fallback');
  assert.notEqual(Math.round(w.barlow), Math.round(w.narrow), 'Barlow Condensed must not be the Arial Narrow fallback');
  const css = await page.evaluate(() => [getComputedStyle(document.querySelector('h1')).fontFamily, getComputedStyle(document.body).fontFamily]);
  assert.match(css[0], /^"?Bungee/); assert.match(css[1], /^"?Barlow Condensed/);
  await close();
});

test('the page makes no request to any other site (it works with no outside network)', async () => {
  const { page, errors, close } = await newPage(browser, DESKTOP);
  const origins = new Set();
  page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) origins.add(u.origin); });
  await page.goto(srv.url + '/index.html');
  await page.keyboard.press('Enter'); await page.waitForTimeout(4500);   // start screen, countdown and a race in progress
  assert.deepEqual([...origins], [srv.url]);
  assert.deepEqual(errors, []);
  await close();
});
