// Golden frames: proof that a refactor did not change a single pixel of what the game draws.
//
// The page is made fully deterministic (seeded Math.random, a fake clock, frames driven by the script), then the exact pixels of the
// game canvas (#c) and the minimap (#mini) are hashed at chosen frames of many scenarios: attract mode on three screen shapes, a race
// from the countdown, combat and effects of every kind, wrecks, damage flash, screen shake, reduced motion, the steering lab.
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
  { name: 'lab-desktop', device: DESKTOP, url: '?lab&debug', run: async (p, shot) => { await shot(1); await shot(120); } }
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
  const frames = Object.values(manifest).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`captured ${SCENARIOS.length} scenarios, ${frames} frames -> ${outDir}`);
}

function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(a, 'manifest.json'))), B = JSON.parse(fs.readFileSync(path.join(b, 'manifest.json')));
  let total = 0, bad = 0;
  for (const sc of new Set([...Object.keys(A), ...Object.keys(B)])) {
    for (const fr of new Set([...Object.keys(A[sc] || {}), ...Object.keys(B[sc] || {})])) {
      for (const key of ['c', 'mini']) {
        total++;
        const x = A[sc]?.[fr]?.[key], y = B[sc]?.[fr]?.[key];
        if (x !== y) { bad++; console.log(`  DIFFERENT  ${sc} ${fr} ${key === 'c' ? 'canvas' : 'minimap'}${x && y ? '' : ' (missing on one side)'}`); }
      }
    }
  }
  console.log(bad === 0 ? `IDENTICAL: all ${total} images match pixel for pixel` : `${bad} of ${total} images differ`);
  return bad === 0;
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'capture' && x) await capture(path.resolve(x), path.resolve(y || ROOT));
else if (cmd === 'compare' && x && y) process.exit(compare(path.resolve(x), path.resolve(y)) ? 0 : 1);
else { console.error('usage: golden.mjs capture <outDir> [root] | compare <dirA> <dirB>'); process.exit(2); }
