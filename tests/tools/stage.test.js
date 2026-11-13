import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../helpers/sim.js';

const SCRIPT = path.join(ROOT, 'tools', 'stage-site.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mm-stage-'));
const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const SHA = '0123456789abcdef0123456789abcdef01234567';

test('staging ships only what players need, stamped with the commit', () => {
  const out = path.join(tmp(), 'site');
  const r = run([out, SHA]);
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(out);
  assert.ok(files.includes('index.html') && files.includes('build.txt'));
  for (const never of ['package.json', 'package-lock.json', 'node_modules', 'tests', 'tools', 'docs', 'CLAUDE.md', '.git', '.github']) {
    assert.ok(!files.includes(never), `${never} must not be published`);
  }
  assert.ok(files.includes('fonts'), 'fonts are hosted with the game');
  const fonts = fs.readdirSync(path.join(out, 'fonts'));
  for (const f of ['bungee-latin-400-normal.woff2', 'barlow-condensed-latin-500-normal.woff2', 'barlow-condensed-latin-600-normal.woff2', 'barlow-condensed-latin-700-normal.woff2', 'LICENSES.txt']) {
    assert.ok(fonts.includes(f), `${f} must ship (the licence must travel with the fonts)`);
  }
  assert.equal(fs.readFileSync(path.join(out, 'build.txt'), 'utf8').trim(), SHA);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta name="build" content="0123456">'), 'stamped with the short sha');
  assert.ok(!html.includes('content="dev"'));
});

test('without a commit the build stays "dev"', () => {
  const out = path.join(tmp(), 'site');
  assert.equal(run([out]).status, 0);
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('<meta name="build" content="dev">'));
});

test('a page that cannot be stamped fails the build (so the deploy stops)', () => {
  const root = tmp(); fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head></html>');
  const r = run([path.join(tmp(), 'site'), SHA], { STAGE_ROOT: root });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot stamp/);
});

test('a malformed commit id is rejected', () => {
  assert.notEqual(run([path.join(tmp(), 'site'), 'not-a-sha; rm -rf /']).status, 0);
});
