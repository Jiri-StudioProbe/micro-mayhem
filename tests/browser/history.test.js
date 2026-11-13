import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, waitRace, DESKTOP } from '../helpers/browser.js';
import { cleanRecord } from '../../src/records.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

const open = async (query = '?debug') => { const t = await newPage(browser, DESKTOP); await t.page.goto(srv.url + '/index.html' + query); await t.page.waitForSelector(query.includes('lab') ? '#labExit' : '#start', { state: 'visible' }); return t; };
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('mm:profile') || 'null'));
const begin = async page => { await page.click('#start'); await waitRace(page); };
// Ends the race the three ways the game can end it.
const END = {
  last: page => page.evaluate(() => { for (const c of __mm.S.cars) if (c !== __mm.S.player) c.alive = false; }),
  finish: page => page.evaluate(() => { __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }),
  wrecked: page => page.evaluate(() => { __mm.S.player.alive = false; __mm.S.player.hp = 0; })
};
const endRace = async (page, kind) => { await END[kind](page); await page.waitForSelector('#again', { state: 'visible', timeout: 10000 }); };

for (const kind of ['finish', 'last', 'wrecked']) {
  test(`a race that ends ${kind === 'last' ? 'with the last car standing' : kind === 'finish' ? 'at the line' : 'wrecked'} is saved to the history with everything needed to describe it`, async () => {
    const { page, errors, close } = await open();
    await begin(page);
    const live = await page.evaluate(() => ({ seed: __mm.S.seed, simVersion: __mm.Sim.SIM_VERSION }));
    await endRace(page, kind);
    const p = await stored(page);
    assert.equal(p.version, 2); assert.equal(p.races.length, 1);
    const rec = p.races[0];
    assert.notEqual(cleanRecord(rec), null, 'a valid record: ' + JSON.stringify(rec));
    assert.deepEqual(cleanRecord(rec), rec, 'already canonical');
    assert.equal(rec.result.kind, kind); assert.equal(rec.level, 'veteran'); assert.equal(rec.track, 'classic'); assert.equal(rec.appVersion, '1.4.0');
    assert.equal(rec.config.seed, live.seed); assert.equal(rec.simVersion, live.simVersion); assert.equal(rec.config.assist, false); assert.equal(rec.result.assistChanged, false);
    assert.ok(Math.abs(Date.parse(rec.ts) - Date.now()) < 60000, 'stamped with the time it ended');
    assert.equal(await page.textContent('#stTime') !== '', true);
    const key = 'classic/veteran/manual';
    if (kind === 'finish') assert.equal(p.bests[key].time, rec.result.time); else assert.ok(!p.bests[key] || p.bests[key].time === null);
    assert.deepEqual(errors, []); await close();
  });
}

test('each race is a new record with its own id and seed, and the history survives a reload', async () => {
  const { page, close } = await open();
  await begin(page); await endRace(page, 'last'); await page.click('#again'); await waitRace(page); await endRace(page, 'wrecked');
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' });
  await begin(page); await endRace(page, 'finish');
  const p = await stored(page);
  assert.deepEqual(p.races.map(r => r.result.kind), ['last', 'wrecked', 'finish']);
  assert.equal(new Set(p.races.map(r => r.id)).size, 3); assert.equal(new Set(p.races.map(r => r.config.seed)).size, 3);
  assert.ok(p.races.every((r, i) => i === 0 || Date.parse(r.ts) >= Date.parse(p.races[i - 1].ts)), 'oldest first');
  await close();
});

test('the record is tagged with the level and the assist setting of the race, and bests are kept for that combination', async () => {
  const { page, close } = await open();
  await page.click('.lvl[data-level=rookie]'); await begin(page); await endRace(page, 'finish');
  const p = await stored(page), rec = p.races[0];
  assert.deepEqual([rec.level, rec.config.assist, rec.config.tune], ['rookie', true, { assistLane: 1.5, assistSpeed: 1.5 }]);
  assert.deepEqual(Object.keys(p.bests), ['classic/rookie/assist']);
  await close();
});

test('switching assist during the race is recorded, and such a race sets no best', async () => {
  const { page, close } = await open();
  await begin(page);
  await page.click('#assistHud'); await page.waitForTimeout(200);   // the HUD button
  await endRace(page, 'finish');
  const p = await stored(page);
  assert.equal(p.races[0].result.assistChanged, true); assert.equal(p.races[0].config.assist, false, 'the config says how the race started');
  assert.deepEqual(p.bests, {});
  await close();
});

test('the Steering Lab and the demo behind the menu are never saved', async () => {
  const { page, close } = await open('?lab&debug');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { __mm.S.player.alive = false; });   // nothing can end a lab; this must not be saved either
  await page.keyboard.press('Escape');
  await page.evaluate(() => { __mm.S.cars.slice(1).forEach(c => { c.alive = false; }); });   // the demo's cars die: it restarts, perhaps with a result
  await page.waitForTimeout(1500);
  const p = await stored(page);
  assert.ok(!p || p.races.length === 0);
  await close();
});

test('a stored history with damaged records loads: the good races stay, nothing throws', async () => {
  const { page, close } = await open();
  await begin(page); await endRace(page, 'last');
  const good = (await stored(page)).races[0];
  const doc = { version: 2, settings: { level: 'veteran', presets: {} }, races: [{ ...good, id: 'bad', result: { kind: 'x' } }, 7, null, good, { ...good, id: 'second' }], bests: 'nonsense' };
  await page.evaluate(d => localStorage.setItem('mm:profile', JSON.stringify(d)), doc);
  await page.reload(); await page.waitForSelector('#start', { state: 'visible' });
  await begin(page); await endRace(page, 'wrecked');
  const p = await stored(page);
  assert.deepEqual(p.races.map(r => r.id).slice(0, 2), [good.id, 'second']); assert.equal(p.races.length, 3);
  assert.equal(await page.evaluate(() => __mm.diag.total), 0);
  assert.equal(typeof p.bests, 'object'); assert.ok(!Array.isArray(p.bests));
  await close();
});

test('if the browser will not store anything, the race and its results screen are unaffected', async () => {
  const { page, errors, close } = await open();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await begin(page); await endRace(page, 'last');
  assert.ok(await page.isVisible('#end')); assert.equal(await page.evaluate(() => __mm.diag.total), 0);
  assert.deepEqual(errors, []); await close();
});

test('a record that cannot be made is logged as a bug and the results screen still appears', async () => {
  const { page, close } = await open();
  await begin(page);
  await page.evaluate(() => { __mm.S.player.kills = -3; });   // makes the record invalid
  await endRace(page, 'last');
  assert.equal(await page.evaluate(() => __mm.diag.last.source), 'records');
  assert.match(await page.evaluate(() => __mm.diag.last.message), /not valid/);
  assert.ok(await page.isVisible('#end'));
  const p = await stored(page); assert.ok(!p || p.races.length === 0, 'nothing invalid reaches the history');
  await close();
});
