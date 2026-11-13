// Builds the folder that gets published to GitHub Pages: only what players need, stamped with the commit.
// Usage: node tools/stage-site.mjs <outDir> [commitSha]
// Without a commit the build stays "dev" (the value committed in index.html). Anything missing or malformed fails loudly,
// so a broken stamp stops the deploy instead of shipping an unlabelled build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.STAGE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIP = ['index.html', 'src', 'fonts'];   // everything else (tests, tools, docs, node_modules) stays out
const [out, sha = ''] = process.argv.slice(2);
if (!out) { console.error('usage: stage-site.mjs <outDir> [commitSha]'); process.exit(2); }
if (sha && !/^[0-9a-f]{7,40}$/i.test(sha)) { console.error(`not a commit sha: ${sha}`); process.exit(2); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('index.html is missing'); process.exit(1); }
for (const name of SHIP) {
  const from = path.join(ROOT, name);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(out, name), { recursive: true });
}

const META = '<meta name="build" content="dev">';
const file = path.join(out, 'index.html');
const html = fs.readFileSync(file, 'utf8');
if (!html.includes(META)) { console.error(`index.html has no ${META}; cannot stamp the build`); process.exit(1); }
const build = sha ? sha.slice(0, 7).toLowerCase() : 'dev';
fs.writeFileSync(file, html.replace(META, `<meta name="build" content="${build}">`));
fs.writeFileSync(path.join(out, 'build.txt'), (sha || 'dev') + '\n');
console.log(`staged ${out} (build ${build}): ${fs.readdirSync(out).join(', ')}`);
