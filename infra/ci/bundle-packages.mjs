#!/usr/bin/env node
// POLY-161 R14: which packages the web bundle holds. Run in the `web` stage of the Dockerfile after `vite build` and before the source maps are deleted, and again by `image.sh check`.
//   node infra/ci/bundle-packages.mjs <web-dir> [<committed-list>]
// Reads <web-dir>/.svelte-kit/bundle-modules.json (every module id of the client and the server build, written by apps/web/bundle-packages.ts) and the `sources` of
// every *.map under <web-dir>/build; writes <web-dir>/build/packages.json (sorted {name, version}); compares the names exactly with the committed list.
// Fails on: no record or an empty one, a list that differs from the committed one, picomatch (refused by name whatever the list says).
// `packages.json` is the kept artefact: Trivy and the SBOM cannot see bundled packages.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REFUSED = ['picomatch'];

/** `.pnpm/<name>@<ver>[_peers]/node_modules/<name>/...` -> {name, version}; a path outside node_modules is our own code -> null. */
export function packageOf(raw) {
  const id = raw.replace(/^\0/, '').replace(/[?#].*$/, '');
  if (!/[\\/]/.test(id) || id.startsWith('node:')) return null;
  const norm = id.replaceAll('\\', '/');
  const i = norm.lastIndexOf('/node_modules/');
  if (i >= 0) {
    const rest = norm.slice(i + '/node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    const before = norm.slice(0, i + '/node_modules/'.length - 1);
    const m = /\/\.pnpm\/([^/]+)\/node_modules$/.exec(before);
    let version = 'unknown';
    if (m) {
      const dir = m[1];
      const at = dir.indexOf('@', dir.startsWith('@') ? 1 : 0);
      if (at > 0) version = dir.slice(at + 1).split('_')[0];
    }
    return { name, version };
  }
  // outside node_modules is our own code (the workspace packages and apps/web); the list is of third-party packages
  return null;
}

function* maps(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* maps(p);
    else if (e.name.endsWith('.map')) yield p;
  }
}

export function collect(web) {
  const record = join(web, '.svelte-kit', 'bundle-modules.json');
  if (!existsSync(record)) throw new Error(`no module record at ${record}`);
  const ids = JSON.parse(readFileSync(record, 'utf8'));
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('the module record is empty');
  const found = new Map();
  const add = (p) => { if (p) found.set(`${p.name}@${p.version}`, p); };
  // plugin ids are absolute paths; map sources are relative to the map file
  for (const id of ids) add(packageOf(String(id), web));
  const buildDir = join(web, 'build');
  if (existsSync(buildDir)) {
    for (const f of maps(buildDir)) {
      const m = JSON.parse(readFileSync(f, 'utf8'));
      for (const s of m.sources ?? []) add(packageOf(String(s), dirname(f)));
    }
  }
  return [...found.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));
}

/** Names only: versions are not in the committed list. Returns the problems, empty when the bundle is as committed. */
export function compare(pkgs, listText) {
  const have = [...new Set(pkgs.map((p) => p.name))].sort();
  const want = listText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).sort();
  const problems = [];
  for (const r of REFUSED) if (have.includes(r)) problems.push(`${r} is in the bundle (refused by name)`);
  for (const n of have) if (!want.includes(n)) problems.push(`in the bundle, not in the committed list: ${n}`);
  for (const n of want) if (!have.includes(n)) problems.push(`in the committed list, not in the bundle: ${n}`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [web, list] = process.argv.slice(2);
  if (!web || !list) { console.error('usage: bundle-packages.mjs <web-dir> <committed-list>'); process.exit(2); }
  try {
    const pkgs = collect(resolve(web));
    writeFileSync(join(resolve(web), 'build', 'packages.json'), JSON.stringify(pkgs, null, 2) + '\n');
    const problems = compare(pkgs, readFileSync(list, 'utf8'));
    if (problems.length) { for (const p of problems) console.error(`bundle-packages: ${p}`); process.exit(1); }
    console.log(`bundle-packages: ${new Set(pkgs.map((p) => p.name)).size} packages`);
  } catch (e) { console.error(`bundle-packages: ${e.message}`); process.exit(1); }
}
