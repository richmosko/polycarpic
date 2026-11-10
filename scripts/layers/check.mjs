// Structural checks on layers.json (ARCH §2.1, "Checks on the file").
// checkLayers() is pure; the CLI at the bottom gathers the real inputs. Exit 1 on any violation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseOf = (token) => token.split('/')[0];

function archConsumes(html) {
  const rows = new Map();
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const dir = /<code>((?:packages|apps)\/[a-z0-9-]+)<\/code>/.exec(row)?.[1];
    const consumes = /data-consumes="([^"]*)"/.exec(row)?.[1];
    if (dir && consumes !== undefined) rows.set(dir, consumes.split(/\s+/).filter(Boolean));
  }
  return rows;
}

export function checkLayers({ layers, archHtml, dirs, pkgJsons = {} }) {
  const out = [];
  const add = (check, subject) => out.push({ check, subject });
  const pk = layers.packages;
  const byDir = new Map(Object.entries(pk).map(([k, v]) => [v.dir, k]));

  // dir <-> file drift
  const present = new Set([...(dirs.packages ?? []).map((d) => `packages/${d}`), ...(dirs.apps ?? []).map((d) => `apps/${d}`)]);
  for (const d of present) if (!byDir.has(d)) add('missing-from-file', d);
  for (const [k, v] of Object.entries(pk)) if (!present.has(v.dir)) add('missing-directory', `${k} (${v.dir})`);

  for (const [k, v] of Object.entries(pk)) {
    for (const a of v.allow) {
      const target = pk[baseOf(a)];
      if (!target) {
        add('allow-unknown', `${k} -> ${a}`);
        continue;
      }
      if (a.includes('/')) {
        const sub = './' + a.split('/').slice(1).join('/');
        if (!pk[baseOf(a)].subpaths.includes(sub) || !v.allow.includes(baseOf(a))) add('allow-bad-subpath', `${k} -> ${a}`);
      }
      if (target.layer > v.layer) add('allow-up', `${k} (L${v.layer}) -> ${a} (L${target.layer})`);
    }
  }

  // cycles: DFS over base tokens, self-edges ignored
  const edges = (k) => [...new Set(pk[k].allow.map(baseOf))].filter((t) => t !== k && pk[t]);
  const state = new Map();
  const stack = [];
  const seen = new Set();
  const visit = (k) => {
    state.set(k, 1);
    stack.push(k);
    for (const t of edges(k)) {
      if (state.get(t) === 1) {
        const cyc = stack.slice(stack.indexOf(t)).concat(t);
        const key = [...cyc].sort().join();
        if (!seen.has(key)) {
          seen.add(key);
          add('allow-cycle', cyc.join(' -> '));
        }
      } else if (!state.has(t)) visit(t);
    }
    stack.pop();
    state.set(k, 2);
  };
  for (const k of Object.keys(pk)) if (!state.has(k)) visit(k);

  // declared workspace deps must be on the allow-list
  for (const [name, json] of Object.entries(pkgJsons)) {
    const key = Object.keys(pk).find((k) => pk[k].name === name || k === name);
    if (!key) {
      if (json.__dir && byDir.has(json.__dir)) add('name-mismatch', json.__dir + ' is named ' + name + ', layers.json says ' + pk[byDir.get(json.__dir)].name);
      continue;
    }
    if (json.exports) {
      const want = new Set(['.', ...pk[key].subpaths]);
      const have = new Set(Object.keys(json.exports));
      for (const e of have) if (!want.has(e)) add('exports-mismatch', key + ' exports ' + e + ', layers.json does not declare it');
      for (const e of want) if (!have.has(e)) add('exports-mismatch', key + ' does not export ' + e);
    }
    const allowed = new Set(pk[key].allow.map(baseOf));
    for (const [dep, range] of Object.entries({ ...json.dependencies, ...json.devDependencies })) {
      if (!dep.startsWith('@poly/') || !String(range).startsWith('workspace:')) continue;
      if (!allowed.has(dep.slice('@poly/'.length))) add('workspace-dep-not-allowed', `${key} declares ${dep}`);
    }
  }

  // exemption is one literal path
  const ex = layers.sessionSetExempt;
  if (typeof ex !== 'string' || /[*?[\]{}]/.test(ex)) add('exemption-not-a-path', JSON.stringify(ex));

  // ARCH §2.2 data-consumes <-> layers.json
  if (archHtml !== undefined) {
    const rows = archConsumes(archHtml);
    for (const [dir, tokens] of rows) {
      const k = byDir.get(dir);
      if (!k) {
        add('arch-mismatch', `${dir} is in ARCH §2.2 but not in layers.json`);
        continue;
      }
      const a = new Set(tokens);
      const b = new Set(pk[k].allow);
      for (const t of a) if (!b.has(t)) add('arch-mismatch', `${k}: ARCH lists ${t}, layers.json does not`);
      for (const t of b) if (!a.has(t)) add('arch-mismatch', `${k}: layers.json lists ${t}, ARCH does not`);
    }
    for (const dir of byDir.keys()) if (!rows.has(dir)) add('arch-mismatch', `${dir} is in layers.json but not in ARCH §2.2`);
  }
  return out;
}

export function gather(root, { layersFile, archFile } = {}) {
  const layers = JSON.parse(fs.readFileSync(layersFile ?? path.join(root, 'layers.json'), 'utf8'));
  const ls = (d) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'node_modules').map((e) => e.name) : []);
  const dirs = { packages: ls('packages'), apps: ls('apps') };
  const pkgJsons = {};
  for (const [k, v] of Object.entries(layers.packages)) {
    const f = path.join(root, v.dir, 'package.json');
    if (fs.existsSync(f)) {
      const json = JSON.parse(fs.readFileSync(f, 'utf8'));
      pkgJsons[json.name ?? v.name] = { ...json, __dir: v.dir };
    }
  }
  const arch = archFile ?? path.join(root, 'docs/ARCH/index.html');
  const archHtml = fs.existsSync(arch) ? fs.readFileSync(arch, 'utf8') : undefined;
  return { layers, archHtml, dirs, pkgJsons };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.includes(n) ? path.resolve(args[args.indexOf(n) + 1]) : d);
  const root = opt('--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  const problems = checkLayers(gather(root, { layersFile: opt('--layers'), archFile: opt('--arch') }));
  for (const p of problems) console.error(`${p.check}: ${p.subject}`);
  process.exit(problems.length ? 1 : 0);
}
