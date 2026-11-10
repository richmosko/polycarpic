// POLY-82 acceptance harness, structural-check half: a mini repo is built in a temp dir from the real layers.json, one
// mutation per check, and scripts/layers/check.mjs must exit non-zero with the expected check id on a line.
// layers.json shape: { packages: { <key>: { dir, name, layer, subpaths: ['./x'], allow: ['db', 'db/auth'] } } }
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const realLayers = () => JSON.parse(readFileSync(join(root, 'layers.json'), 'utf8'));
const realArch = join(root, 'docs/ARCH/index.html');

type Mini = { layers: any; arch?: string; extraDirs?: string[]; dropDirs?: string[]; extraDeps?: Record<string, string[]> };

function run(m: Mini) {
  const dir = mkdtempSync(join(tmpdir(), 'poly-layers-'));
  const base = realLayers().packages;
  for (const [key, e] of Object.entries<any>(m.layers.packages)) {
    if (m.dropDirs?.includes(key)) continue;
    const d = join(dir, e.dir);
    mkdirSync(d, { recursive: true });
    const deps: Record<string, string> = {};
    // dependencies come from the UNMUTATED allow-list, so a mutated allow-list does not move them
    for (const a of [...(base[key]?.allow ?? []), ...(m.extraDeps?.[key] ?? [])]) deps[`@poly/${a.split('/')[0]}`] = 'workspace:*';
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: e.name, dependencies: deps }));
  }
  for (const d of m.extraDirs ?? []) mkdirSync(join(dir, d), { recursive: true });
  const archPath = join(dir, 'arch.html');
  if (m.arch) writeFileSync(archPath, m.arch);
  else cpSync(realArch, archPath);
  const layersPath = join(dir, 'layers.json');
  writeFileSync(layersPath, JSON.stringify(m.layers));
  const r = spawnSync('node', [join(root, 'scripts/layers/check.mjs'), '--root', dir, '--arch', archPath, '--layers', layersPath], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`.split('\n').filter(Boolean) };
}

const clone = () => structuredClone(realLayers());
const count = (out: string[], id: string) => out.filter((l) => l.startsWith(id) || l.includes(`${id}:`) || l.includes(`[${id}]`)).length;

describe('layers.json structural checks', () => {
  const baseline = () => run({ layers: clone() });

  it('passes on the unmodified file', () => {
    const r = baseline();
    expect(r.out).toEqual([]);
    expect(r.code).toBe(0);
  });

  // Each mutation must ADD a report of its own id over the baseline, so a baseline that already drifts cannot mask it.
  const mutate = (name: string, id: string, m: Mini) =>
    it(`${id}: ${name}`, () => {
      const b = baseline();
      const r = run(m);
      expect(r.code).not.toBe(0);
      expect(count(r.out, id), r.out.join('\n')).toBeGreaterThan(count(b.out, id));
    });

  mutate('a directory missing from the file', 'missing-from-file', { layers: clone(), extraDirs: ['packages/stray'] });
  mutate('an entry in the file with no directory', 'missing-directory', { layers: clone(), dropDirs: ['tax'] });
  mutate('a declared workspace dependency not on the allow-list', 'workspace-dep-not-allowed', { layers: clone(), extraDeps: { ledger: ['posting'] } });
  mutate('an allow-list entry pointing at a higher layer', 'allow-up', (() => {
    const l = clone();
    l.packages.securities.allow.push('posting');
    return { layers: l, extraDeps: { securities: ['posting'] } };
  })());
  mutate('two same-layer packages allowing each other', 'allow-cycle', (() => {
    const l = clone();
    l.packages.tenancy.allow.push('auth'); // auth -> tenancy is listed (same layer); add the reverse edge
    return { layers: l, extraDeps: { tenancy: ['auth'] } };
  })());
  mutate('an entry added to the layers.json side', 'arch-mismatch', (() => {
    const l = clone();
    l.packages.ledger.allow.push('refdata'); // legal layer-wise, absent from ARCH data-consumes
    return { layers: l, extraDeps: { ledger: ['refdata'] } };
  })());
  mutate('an entry added to the ARCH side', 'arch-mismatch', {
    layers: clone(),
    arch: readFileSync(realArch, 'utf8').replace('data-consumes="db tenancy"', 'data-consumes="db tenancy refdata"'),
  });
});
