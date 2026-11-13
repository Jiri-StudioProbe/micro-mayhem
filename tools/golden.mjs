// Golden frames: proof that a refactor did not change a single pixel of what the game draws.
//
// The page is made fully deterministic (seeded Math.random, a fake clock, frames driven by the script), then the exact pixels of the
// game canvas (#c) and the minimap (#mini) are hashed at chosen frames of many scenarios: attract mode on three screen shapes, a race
// from the countdown, combat and effects of every kind, wrecks, damage flash, screen shake, reduced motion, the steering lab. The state of
// the HUD, the overlays, the buttons and the input values is hashed too (`dom`), with scenarios for the settings buttons, all three
// results screens, touch controls, keyboard controls and the lab panel.
//
//   node tools/golden.mjs capture <outDir> [root]    render every scenario from the code in <root> (default: this working tree)
//   node tools/golden.mjs compare <dirA> <dirB>      list every frame whose pixels differ (exit code 1 if any)
//   tools/golden-compare.sh <commit>                 capture <commit> and the working tree, then compare
//
// It only needs the ?debug hook (window.__mm), so it works on any commit that has it, however the code is organised.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve } from '../tests/helpers/server.js';
import { launch, PHONE, DESKTOP, runFrames } from '../tests/helpers/browser.js';
import { ROOT } from '../tests/helpers/sim.js';

const PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

// Runs before any page script: a seeded Math.random, a fake clock, and a captured requestAnimationFrame.
const DETERMINISM = () => {
  let seed = 123456789;
  Math.random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__t = 1000; window.__cb = null;
  performance.now = () => window.__t;
  window.requestAnimationFrame = cb => { window.__cb = cb; return 1; };
};

// What the HUD, overlays, buttons and the input values look like. (Toasts are left out: they are CSS animations on the real clock.)
const DOM_STATE = () => {
  const ids = ['hud', 'menu', 'end', 'pad', 'tune', 'cd', 'pos', 'lap', 'hp', 'hpn', 'wname', 'wammo', 'wpn', 'labstats', 'lsLast', 'lsBest', 'lsHits',
    'snd', 'assistHud', 'assistMenu', 'assistTune', 'levelBlurb', 'tuneBtn', 'labExit', 'tuneOut', 'stick', 'knob', 'endKick', 'endHead', 'stPlace', 'stKills', 'stTime', 'stTimeLab'];
  const o = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    o[id] = e ? { hidden: e.hidden, cls: e.className, text: (e.textContent || '').trim().slice(0, 300), style: e.getAttribute('style') || '', pressed: e.getAttribute('aria-pressed'), value: e.value === undefined ? null : e.value } : null;
  }
  o.levels = [...document.querySelectorAll('[data-level]')].map(b => b.getAttribute('aria-pressed') + ':' + b.className);
  o.sliders = [...document.querySelectorAll('.trow input')].map(i => i.id + '=' + i.value);
  o.sliderLabels = [...document.querySelectorAll('.trow b')].map(b => b.textContent);
  o.input = window.__mm ? { ...window.__mm.input } : null;
  o.mm = window.__mm ? { level: window.__mm.level, assist: window.__mm.S.assist, lab: window.__mm.S.lab, state: window.__mm.S.state, tune: { ...window.__mm.tune } } : null;
  o.body = document.body.className;
  return JSON.stringify(o);
};

// Entities of every kind, placed relative to the player, so the draw code for each one is exercised.
const EFFECTS = () => {
  const S = __mm.S, P = S.player, c = Math.cos(P.a), s = Math.sin(P.a);
  for (const k of [120, 260, 420, 700, -150, -600]) {
    const x = P.x + c * k, y = P.y + s * k;
    S.rings.push({ x, y, r: 20, max: 80, life: 0.35, t: 0.25 });
    S.rockets.push({ x: x + 30, y, a: P.a, sp: 260, life: 2, owner: S.cars[1] });
    S.mines.push({ x: x - 30, y, owner: S.cars[1], arm: k > 300 ? 0 : 0.6, life: 30 });
    S.bullets.push({ x, y: y + 20, vx: c * 700, vy: s * 700, life: 0.6, owner: S.cars[1], dmg: 1 });
  }
  [0, 1, 2, 3].forEach((kind, i) => S.parts.push({ kind, x: P.x + c * (80 + 40 * i), y: P.y + s * (80 + 40 * i), h: 12, vx: 0, vy: 0, vh: 0, life: 0.5, max: 1, size: 9, r: 255, g: 150 + 20 * i, b: 40, grav: 0 }));
  P.weapon = 'rocket'; P.ammo = 3;
  S.shake = 0.7;
  S.events.push({ t: 'hurt', amt: 25 });
};

const SCENARIOS = [
  { name: 'attract-desktop', device: DESKTOP, url: '?debug', run: async (p, shot) => { await shot(1); await shot(120); await shot(600); } },
  { name: 'attract-phone-landscape', device: PHONE, url: '?debug', run: async (p, shot) => { await shot(5); await shot(300); } },
  { name: 'attract-portrait', device: PORTRAIT, url: '?debug', run: async (p, shot) => { await shot(5); await shot(300); } },
  { name: 'race-countdown-and-start', device: DESKTOP, url: '?debug', run: async (p, shot) => {
    await runFrames(p, 20); await p.click('#start'); await shot(100);        // countdown
    await shot(110); await p.keyboard.down('ArrowUp'); await shot(60);        // GO, then driving
    await p.keyboard.down('ArrowLeft'); await shot(90); await p.keyboard.up('ArrowLeft'); await shot(120);
  } },
  { name: 'combat-and-effects', device: DESKTOP, url: '?debug', run: async (p, shot) => {
    await runFrames(p, 20); await p.click('#start'); await runFrames(p, 260);
    await p.evaluate(EFFECTS); await shot(1); await shot(6); await shot(20); await shot(60);
  } },
  { name: 'combat-phone', device: PHONE, url: '?debug', run: async (p, shot) => {
    await runFrames(p, 20); await p.click('#start'); await runFrames(p, 260);
    await p.evaluate(EFFECTS); await shot(1); await shot(15); await shot(80);
  } },
  { name: 'wrecks-and-damage', device: DESKTOP, url: '?debug', run: async (p, shot) => {
    await runFrames(p, 20); await p.click('#start'); await runFrames(p, 260);
    await p.evaluate(() => { for (const c of __mm.S.cars.slice(1, 4)) { c.alive = false; c.wreck = 7; c.hp = 0; } __mm.S.player.hp = 20; });
    await shot(2); await shot(40); await shot(200);
  } },
  { name: 'reduced-motion-no-shake', device: { ...DESKTOP, reducedMotion: 'reduce' }, url: '?debug', run: async (p, shot) => {
    await runFrames(p, 20); await p.click('#start'); await runFrames(p, 260);
    await p.evaluate(EFFECTS); await shot(1); await shot(10);
  } },
  { name: 'lab-phone', device: PHONE, url: '?lab&debug', run: async (p, shot) => { await shot(1); await shot(60); } },
  { name: 'lab-desktop', device: DESKTOP, url: '?lab&debug', run: async (p, shot) => { await shot(1); await shot(120); } },

  // ---- the user interface ----
  { name: 'ui-menu-settings-and-mute', device: PHONE, url: '?debug', run: async (p, shot) => {
    await shot(3);
    await p.tap('.lvl[data-level=rookie]'); await shot(2);
    await p.tap('#assistMenu'); await shot(2);
    await p.tap('.lvl[data-level=veteran]'); await shot(2);
    await p.tap('#assistMenu'); await shot(2);
    await p.tap('#start'); await shot(60); await p.tap('#snd'); await shot(2); await p.tap('#assistHud'); await shot(2); await p.tap('#snd'); await shot(2);
  } },
  { name: 'ui-keyboard', device: DESKTOP, url: '?debug', run: async (p, shot) => {
    await shot(3); await p.keyboard.press('KeyM'); await shot(2); await p.keyboard.press('KeyM');
    await p.keyboard.press('Enter'); await shot(230);
    await p.keyboard.down('ArrowUp'); await p.keyboard.down('KeyA'); await shot(40); await p.keyboard.down('Space'); await shot(20);
    await p.keyboard.up('KeyA'); await p.keyboard.down('ArrowDown'); await shot(20); await p.keyboard.up('ArrowDown'); await p.keyboard.up('Space'); await p.keyboard.up('ArrowUp'); await shot(20);
    await p.evaluate(() => { __mm.S.player.weapon = 'mg'; __mm.S.player.ammo = 20; }); await shot(5);
  } },
  { name: 'ui-touch-controls', device: PHONE, url: '?debug', run: async (p, shot) => {
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await runFrames(p, 10); await p.tap('#start'); await runFrames(p, 250);
    await touch('touchStart', [{ x: 150, y: 300, id: 1 }]); await shot(30);
    await touch('touchMove', [{ x: 150 + 14, y: 300, id: 1 }]); await shot(20);
    await touch('touchMove', [{ x: 150 + 30, y: 300, id: 1 }]); await shot(30);
    await touch('touchMove', [{ x: 150 + 120, y: 300 + 40, id: 1 }]); await shot(30);
    await touch('touchMove', [{ x: 150 - 20, y: 300, id: 1 }]); await shot(30);
    const fire = await p.locator('.fire').boundingBox(), brake = await p.locator('.brake').boundingBox();
    await touch('touchStart', [{ x: 150 - 20, y: 300, id: 1 }, { x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 2 }]); await shot(10);
    await touch('touchEnd', [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 2 }]);
    await touch('touchStart', [{ x: 150 - 20, y: 300, id: 1 }, { x: brake.x + brake.width / 2, y: brake.y + brake.height / 2, id: 3 }]); await shot(15);
    await touch('touchEnd', []); await shot(15);
  } },
  { name: 'ui-lab-panel', device: PHONE, url: '?lab&debug', run: async (p, shot) => {
    const set = (k, v) => p.evaluate(([k, v]) => { const e = document.getElementById('t_' + k); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
    await shot(5); await set('gain', 1.2); await set('radius', 80); await set('maxLock', 0.6); await shot(3);
    await p.tap('#tune [data-level=rookie]'); await shot(3); await p.tap('#assistTune'); await shot(3);
    await p.tap('#tuneReset'); await shot(3); await p.tap('#tuneClose'); await shot(3); await p.tap('#tuneBtn'); await shot(3);
    await p.evaluate(() => { __mm.S.player.prog = -5; }); await shot(5); await p.evaluate(() => { __mm.S.player.prog = 1; }); await shot(60);
    await p.evaluate(() => { const P = __mm.S.player; P.prog = (Math.floor(P.prog / __mm.Sim.N) + 1) * __mm.Sim.N + 2; }); await shot(10);
    await p.evaluate(() => { const P = __mm.S.player; P.prog = (Math.floor(P.prog / __mm.Sim.N) - 1) * __mm.Sim.N + 2; }); await shot(10);
    await p.tap('#tuneExit'); await shot(5);
  } },
  // The damage flash fades in half a second; a race that starts while it is still showing must start clean.
  { name: 'ui-start-clears-hurt-flash', device: DESKTOP, url: '?debug', run: async (p, shot) => {
    await shot(20); await p.evaluate(() => { __mm.S.events.push({ t: 'hurt', amt: 40 }); }); await shot(1);
    await p.click('#start'); await shot(1); await shot(3);
  } },
  { name: 'ui-lab-exit-by-escape', device: DESKTOP, url: '?lab&debug', run: async (p, shot) => { await shot(30); await p.keyboard.press('Escape'); await shot(5); await p.keyboard.press('Enter'); await shot(5); } },
  ...[['finish', () => { __mm.S.player.prog = __mm.Sim.LAPS * __mm.Sim.N; }],
      ['last', () => { for (const c of __mm.S.cars) if (c !== __mm.S.player) { c.alive = false; c.wreck = 0; } }],
      ['wrecked', () => { __mm.S.player.alive = false; __mm.S.player.hp = 0; }]].map(([kind, force]) => ({
    name: 'ui-end-' + kind, device: DESKTOP, url: '?debug', run: async (p, shot) => {
      await runFrames(p, 20); await p.click('#start'); await runFrames(p, 260);
      await p.evaluate(force); await shot(kind === 'wrecked' ? 130 : 5);   // a wreck ends the race 1.8 s of game time later
      await p.waitForTimeout(1600);            // the results screen appears after a delay on the real clock
      await shot(1); await p.click('#again'); await shot(3);
    } }))
];

async function capture(outDir, root) {
  const srv = await serve(root), browser = await launch(), manifest = {};
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext(sc.device);
    await ctx.addInitScript(DETERMINISM);
    const errors = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(srv.url + '/index.html' + sc.url);
    await page.waitForFunction(() => window.__mm && window.__cb);
    let n = 0, frames = 0;
    const shot = async advance => {
      const r = await runFrames(page, advance); frames += advance;
      if (r.thrown || !r.alive) throw new Error(`${sc.name}: the game loop failed (${JSON.stringify(r)})`);
      const urls = await page.evaluate(() => [document.getElementById('c').toDataURL('image/png'), document.getElementById('mini').toDataURL('image/png')]);
      const rec = {};
      const domJson = await page.evaluate(DOM_STATE);
      rec.dom = crypto.createHash('sha256').update(domJson).digest('hex');
      { const dir = path.join(outDir, sc.name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${String(n + 1).padStart(2, '0')}-frame${frames}-dom.json`), domJson); }
      for (const [key, url] of [['c', urls[0]], ['mini', urls[1]]]) {
        const png = Buffer.from(url.split(',')[1], 'base64');
        rec[key] = crypto.createHash('sha256').update(png).digest('hex');
        const dir = path.join(outDir, sc.name); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${String(++n).padStart(2, '0')}-frame${frames}-${key}.png`), png);
      }
      (manifest[sc.name] = manifest[sc.name] || {})[`frame${frames}`] = rec;
    };
    await sc.run(page, shot);
    if (errors.length) throw new Error(`${sc.name}: page errors: ${errors.join(' | ')}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await browser.close(); await srv.close();
  const frames = Object.values(manifest).reduce((a, s) => a + Object.keys(s).length, 0);   // frames recorded (each with canvas, minimap and DOM state)
  console.log(`captured ${SCENARIOS.length} scenarios, ${frames} frames -> ${outDir}`);
}

function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(a, 'manifest.json'))), B = JSON.parse(fs.readFileSync(path.join(b, 'manifest.json')));
  let total = 0, bad = 0;
  for (const sc of new Set([...Object.keys(A), ...Object.keys(B)])) {
    for (const fr of new Set([...Object.keys(A[sc] || {}), ...Object.keys(B[sc] || {})])) {
      for (const key of ['c', 'mini', 'dom']) {
        total++;
        const x = A[sc]?.[fr]?.[key], y = B[sc]?.[fr]?.[key];
        if (x !== y) { bad++; console.log(`  DIFFERENT  ${sc} ${fr} ${key === 'c' ? 'canvas' : key === 'mini' ? 'minimap' : 'HUD/overlays/buttons/input'}${x && y ? '' : ' (missing on one side)'}`); }
      }
    }
  }
  console.log(bad === 0 ? `IDENTICAL: all ${total} recorded states match (canvas and minimap pixel for pixel, HUD/overlay/button/input state exactly)` : `${bad} of ${total} images differ`);
  return bad === 0;
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'capture' && x) await capture(path.resolve(x), path.resolve(y || ROOT));
else if (cmd === 'compare' && x && y) process.exit(compare(path.resolve(x), path.resolve(y)) ? 0 : 1);
else { console.error('usage: golden.mjs capture <outDir> [root] | compare <dirA> <dirB>'); process.exit(2); }
