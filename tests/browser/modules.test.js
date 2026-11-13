import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, DESKTOP, PHONE } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

for (const [label, device] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`the game loads as ES modules: each module once, from this site, as JavaScript (${label})`, async () => {
    const { page, errors, close } = await newPage(browser, device);
    const mods = [], warnings = [];
    page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/src/')) mods.push({ path: new URL(r.url()).pathname, status: r.status(), type: r.headers()['content-type'] }); });
    page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(srv.url + '/index.html?debug');
    await page.waitForSelector('#start', { state: 'visible' });
    await page.waitForTimeout(500);

    assert.ok(mods.some(m => m.path === '/src/sim/sim.js'), 'the simulation module is requested');
    for (const m of mods) { assert.equal(m.status, 200, m.path); assert.match(m.type, /javascript/, m.path); }
    const paths = mods.map(m => m.path);
    assert.equal(new Set(paths).size, paths.length, `each module is downloaded once (modulepreload plus import must share one request): ${paths}`);
    assert.deepEqual(warnings.filter(w => /preload/i.test(w)), []);
    assert.equal(await page.evaluate(() => typeof __mm.Sim.step), 'function', 'the shell got the simulation through its import');
    assert.deepEqual(errors, []);
    await close();
  });
}

test('the simulation module needs nothing from the page: it runs in plain Node (no DOM, window or storage)', async () => {
  // Importing it here, in a process with no browser globals, is the proof; the assertions make sure it is really the game's sim.
  const { Sim } = await import('../helpers/sim.js');
  assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined'); assert.equal(typeof localStorage, 'undefined');
  const S = Sim.create(); Sim.reset(S, 'race');
  assert.equal(S.cars.length, 6);
});
