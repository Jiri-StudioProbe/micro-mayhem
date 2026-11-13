import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../helpers/sim.js';

// The shell's modules must not import each other in a circle: where one needs an action from another, main.js passes it in.
const SRC = path.join(ROOT, 'src');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(SRC);
const graph = new Map(files.map(f => [f, [...fs.readFileSync(f, 'utf8').matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)].map(m => path.resolve(path.dirname(f), m[1]))]));

test('every relative import points at a module that exists', () => {
  for (const [f, deps] of graph) for (const d of deps) assert.ok(graph.has(d), `${path.relative(ROOT, f)} imports ${path.relative(ROOT, d)}, which does not exist`);
});

test('the modules form a tree with no import cycles', () => {
  const state = new Map();   // 1 = on the current path, 2 = done
  const visit = (f, trail) => {
    if (state.get(f) === 2) return;
    assert.notEqual(state.get(f), 1, `import cycle: ${[...trail, f].map(x => path.relative(SRC, x)).join(' -> ')}`);
    state.set(f, 1); for (const d of graph.get(f)) visit(d, [...trail, f]); state.set(f, 2);
  };
  for (const f of graph.keys()) visit(f, []);
});

test('only main.js knows every part: no other module imports it, and the simulation imports nothing', () => {
  const main = path.join(SRC, 'main.js');
  for (const [f, deps] of graph) if (f !== main) assert.ok(!deps.includes(main), `${path.relative(ROOT, f)} imports main.js`);
  for (const [f, deps] of graph) if (f.startsWith(path.join(SRC, 'sim') + path.sep)) assert.deepEqual(deps.filter(d => !d.startsWith(path.join(SRC, 'sim') + path.sep)), [], `${path.relative(ROOT, f)} reaches out of src/sim/`);
});
