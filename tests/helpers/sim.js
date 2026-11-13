// Loads the pure simulation for headless tests.
// While the game is one file, the Sim is cut out of index.html. After the module split (M0.4) this becomes a plain import.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadSim() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const src = html.slice(html.indexOf('const Sim = (() => {'), html.indexOf('if (typeof module'));
  return vm.runInNewContext(src + ';Sim', { Math, Float32Array });
}
