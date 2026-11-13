import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, PHONE } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const url = q => `${srv.url}/index.html${q || ''}`;
const fresh = async (q = '?debug') => { const t = await newPage(browser, PHONE); await t.page.goto(url(q)); return t; };
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('mm:profile')));
const setSlider = (page, k, v) => page.evaluate(([k, v]) => { const e = document.getElementById('t_' + k); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
const out = page => page.inputValue('#tuneOut').then(JSON.parse);

test('a fresh install has no profile written until something is changed', async () => {
  const { page, close } = await fresh();
  assert.equal(await page.evaluate(() => localStorage.getItem('mm:profile')), null);
  await close();
});

test('stale keys from before the profile existed neither mask the defaults nor survive', async () => {
  const t = await newPage(browser, PHONE);
  await t.page.goto(url('?debug'));
  await t.page.evaluate(() => { localStorage.setItem('mm-tune', JSON.stringify({ gain: 1.5, curve: 1.4, speedDamp: 0.8 })); localStorage.setItem('mm-assist', '1'); });
  await t.page.goto(url('?lab&debug')); await t.page.waitForSelector('#tune');
  const o = await out(t.page);
  assert.equal(o.gain, 2.6); assert.equal(o.curve, 2.55); assert.equal(o.assist, 'off');
  assert.deepEqual(await t.page.evaluate(() => [localStorage.getItem('mm-tune'), localStorage.getItem('mm-assist')]), [null, null]);
  await t.close();
});

test('only changed values are saved, per level, and levels do not affect each other', async () => {
  const { page, close } = await fresh('?lab&debug');
  await page.tap('#tune [data-level=rookie]');
  await setSlider(page, 'gain', 1.9);
  await page.tap('#assistTune');   // rookie default is assist on; turning it off is a deliberate change
  let s = (await stored(page)).settings;
  assert.equal(s.level, 'rookie');
  assert.deepEqual(s.presets.rookie, { pv: 1, tune: { gain: 1.9 }, assist: false });
  await page.tap('#tune [data-level=veteran]');
  assert.equal((await out(page)).gain, 2.6, 'veteran is untouched by rookie tweaks');
  await page.tap('#tune [data-level=rookie]');
  assert.equal((await out(page)).gain, 1.9);
  await page.tap('#assistTune');   // back to the default: the override disappears
  assert.equal((await stored(page)).settings.presets.rookie.assist, null);
  await close();
});

test('level and tweaks survive a reload; RESET clears them', async () => {
  const { page, close } = await fresh('?debug');
  await page.tap('.lvl[data-level=rookie]');
  await page.tap('#labBtn'); await setSlider(page, 'dead', 0.2);
  await page.goto(url('?debug'));
  assert.equal(await page.locator('.lvl[aria-pressed=true]').getAttribute('data-level'), 'rookie');
  assert.equal(await page.textContent('#assistMenu'), 'DRIVING ASSIST: ON');
  await page.tap('#labBtn');
  assert.equal((await out(page)).dead, 0.2);
  await page.tap('#tuneReset');
  assert.equal((await out(page)).dead, 0.14);
  assert.deepEqual((await stored(page)).settings.presets.rookie, { pv: 1, tune: {}, assist: null });
  await close();
});

test('saved tweaks from an older defaults version are discarded', async () => {
  const { page, close } = await fresh('?debug');
  await page.evaluate(() => localStorage.setItem('mm:profile', JSON.stringify({ version: 1, settings: { level: 'veteran', presets: { veteran: { pv: 0, tune: { gain: 0.5 }, assist: true } } } })));
  await page.goto(url('?lab&debug')); await page.waitForSelector('#tune');
  const o = await out(page);
  assert.equal(o.gain, 2.6); assert.equal(o.assist, 'off');
  await close();
});

test('a corrupt or hostile profile never stops the game loading', async () => {
  for (const bad of ['{not json', 'null', '"text"', '[1,2]', '{"version":1,"settings":"x"}', '{"version":1,"settings":{"level":"nope","presets":{"veteran":{"pv":1,"tune":{"gain":"abc","curve":1e99},"assist":"yes"}}}}']) {
    const t = await newPage(browser, PHONE);
    await t.page.goto(url('?debug'));
    await t.page.evaluate(b => localStorage.setItem('mm:profile', b), bad);
    await t.page.goto(url('?lab&debug')); await t.page.waitForSelector('#tune');
    const o = await out(t.page);
    assert.ok(['rookie', 'veteran'].includes(o.level), `bad profile ${bad}`);
    assert.ok(Number.isFinite(o.gain) && o.gain >= 0.5 && o.gain <= 4, `gain ${o.gain} for ${bad}`);
    assert.deepEqual(t.errors, [], bad);
    await t.close();
  }
});

test('?level= picks a level for one visit without saving it', async () => {
  const { page, close } = await fresh('?lab&level=rookie&debug');
  await page.waitForSelector('#tune');
  assert.equal((await out(page)).level, 'rookie');
  assert.equal(await page.evaluate(() => localStorage.getItem('mm:profile')), null);
  await close();
});
