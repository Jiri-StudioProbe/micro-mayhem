import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, readBuild } from '../../src/version.js';
import { ROOT } from '../helpers/sim.js';

test('the version is a release number that matches package.json', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version.replace(/-.*$/, ''), VERSION, 'bump src/version.js and package.json together');
});

const docWith = content => ({ querySelector: sel => (sel === 'meta[name="build"]' ? { getAttribute: () => content } : null) });

test('the build is read from the page, and is "dev" when it is not stamped', () => {
  assert.equal(readBuild(docWith('2da57af')), '2da57af');
  assert.equal(readBuild(docWith('dev')), 'dev');
  assert.equal(readBuild(docWith('')), 'dev');
  assert.equal(readBuild(docWith(null)), 'dev');
  assert.equal(readBuild({ querySelector: () => null }), 'dev');
  assert.equal(readBuild(null), 'dev');
  assert.equal(readBuild(undefined), 'dev');
});

test('the page ships with the unstamped marker the deploy looks for', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta name="build" content="dev">'));
});
