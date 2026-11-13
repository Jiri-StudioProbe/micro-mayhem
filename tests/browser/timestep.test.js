import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../helpers/server.js';
import { launch, newPage, runFrames, DESKTOP } from '../helpers/browser.js';

let srv, browser;
before(async () => { srv = await serve(); browser = await launch(); });
after(async () => { await browser.close(); await srv.close(); });

// Runs a race in virtual time with frames of the given lengths (ms), and reports how much game time passed against how much clock time.
async function race(durations, { frames = 600 } = {}) {
  const { page, errors, close } = await newPage(browser, DESKTOP, { virtualTime: true });
  await page.goto(srv.url + '/index.html?debug');
  await runFrames(page, 30); await page.click('#start'); await runFrames(page, 300);   // past the countdown
  await page.keyboard.down('ArrowUp');
  await runFrames(page, 60);
  const r = await page.evaluate(([durations, frames]) => {
    const S = __mm.S, hash = () => { const u = document.getElementById('c').toDataURL(); let h = 5381; for (let i = 0; i < u.length; i += 61) h = ((h << 5) + h + u.charCodeAt(i)) | 0; return h; };
    const t0 = S.t, c0 = window.__t, hashes = [], realX = [];
    for (let f = 0; f < frames; f++) {
      const cb = window.__cb; window.__cb = null;
      cb(window.__t += durations[f % durations.length]);
      if (f < 40) { hashes.push(hash()); realX.push(S.player.x); }
    }
    return { sim: S.t - t0, clock: (window.__t - c0) / 1000, hashes, realX, state: S.state };
  }, [durations, frames]);
  await page.keyboard.up('ArrowUp');
  return { ...r, errors, close };
}

for (const [label, durations] of [['30 Hz', [1000 / 30]], ['60 Hz', [1000 / 60]], ['120 Hz', [1000 / 120]], ['144 Hz', [1000 / 144]], ['240 Hz', [1000 / 240]],
  ['uneven frames (4 to 40 ms)', [4, 40, 9, 22, 16, 31, 6, 12, 25, 17]]]) {
  test(`game time keeps pace with the clock, at ${label}`, async () => {
    const r = await race(durations, { frames: label.startsWith('uneven') ? 1000 : 600 });
    assert.equal(r.state, 'race');
    assert.ok(Math.abs(r.sim - r.clock) < 2 / 60 + 0.002, `${r.sim.toFixed(3)} s of game time in ${r.clock.toFixed(3)} s of clock (${label})`);
    assert.deepEqual(r.errors, []);
    await r.close();
  });
}

test('at 144 Hz the car and the picture move on every frame, although the simulation steps only 60 times a second', async () => {
  const r = await race([1000 / 144]);
  const distinct = n => new Set(n).size;
  assert.ok(distinct(r.realX) < 25, `the simulation moved the car in only ${distinct(r.realX)} of 40 frames (it steps about 17 times in 40 frames at 144 Hz)`);
  let changed = 0; for (let i = 1; i < r.hashes.length; i++) if (r.hashes[i] !== r.hashes[i - 1]) changed++;
  assert.ok(changed >= 38, `the picture changed in ${changed} of 39 frame pairs: interpolation fills in the frames between steps`);
  await r.close();
});

test('after drawing, the simulation state is the real one, not an interpolated one: the car is exactly where the last step left it', async () => {
  const { page, errors, close } = await newPage(browser, DESKTOP, { virtualTime: true });
  await page.goto(srv.url + '/index.html?debug');
  await runFrames(page, 30); await page.click('#start'); await runFrames(page, 300); await page.keyboard.down('ArrowUp'); await runFrames(page, 60);
  const out = await page.evaluate(() => {
    const S = __mm.S, P = S.player, results = [];
    for (let f = 0; f < 60; f++) {
      const x0 = P.x, y0 = P.y, t0 = S.t, cb = window.__cb; window.__cb = null; cb(window.__t += 1000 / 144);
      const stepped = S.t !== t0;
      results.push({ stepped, moved: P.x !== x0 || P.y !== y0 });
    }
    return results;
  });
  assert.ok(out.every(r => r.stepped === r.moved), 'the car\'s state changes exactly when the simulation steps, never in between');
  assert.deepEqual(errors, []);
  await close();
});
