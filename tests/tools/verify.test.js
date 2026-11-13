import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serve } from '../helpers/server.js';
import { ROOT } from '../helpers/sim.js';

const SCRIPT = path.join(ROOT, 'tools', 'verify-live.sh');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mm-verify-'));
// Asynchronous on purpose: the "live site" below is a server inside this same process, so a blocking spawn would deadlock it.
const verify = (url, dir) => new Promise(resolve => {
  const p = spawn('bash', [SCRIPT, url + '/', dir, '2', '0']); let stdout = '', stderr = '';
  p.stdout.on('data', d => { stdout += d; }); p.stderr.on('data', d => { stderr += d; });
  p.on('close', status => resolve({ status, stdout, stderr }));
});
const write = (dir, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); } };

let live, liveDir;   // "the live site": a local server over a folder
before(async () => { liveDir = tmp(); live = await serve(liveDir); });
after(async () => { await live.close(); });
const FILES = { 'index.html': '<html>v1</html>', 'build.txt': 'abc\n', 'fonts/a.woff2': 'font-bytes', 'src/x.js': 'export {}' };

test('passes when every staged file is served identically', async () => {
  const staged = tmp(); write(staged, FILES); write(liveDir, FILES);
  const r = await verify(live.url, staged);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Every one of the 4 published files is live/);
});

test('fails when a file is missing on the live site', async () => {
  const staged = tmp(); write(staged, FILES);
  fs.rmSync(liveDir, { recursive: true, force: true }); fs.mkdirSync(liveDir); write(liveDir, { ...FILES }); fs.rmSync(path.join(liveDir, 'fonts'), { recursive: true });
  const r = await verify(live.url, staged);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /fonts\/a\.woff2/);
});

test('fails when a file differs (an old build is still being served)', async () => {
  const staged = tmp(); write(staged, FILES);
  fs.rmSync(liveDir, { recursive: true, force: true }); fs.mkdirSync(liveDir); write(liveDir, { ...FILES, 'index.html': '<html>OLD</html>' });
  const r = await verify(live.url, staged);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /index\.html/);
});

test('fails clearly when the staged folder does not exist', async () => {
  assert.notEqual((await verify(live.url, path.join(tmp(), 'nope'))).status, 0);
});
