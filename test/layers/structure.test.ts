// POLY-82 acceptance harness, structure half: workspace shape, layers.json vs ARCH, exports maps, strict linking, and
// the tsc-resolved criteria (deep import, SessionUserId constructor absent from the @poly/db index).
// layers.json shape: { packages: { <key>: { dir, name, layer, subpaths: ['./x'], allow } }, sessionSetExempt: '<one literal path>' }.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const layers = JSON.parse(readFileSync(join(root, 'layers.json'), 'utf8'));
const names: string[] = Object.keys(layers.packages);
const all = () => [...names].sort();
const dirOf = (n: string) => join(root, layers.packages[n].dir);
const arch = readFileSync(join(root, 'docs/ARCH/index.html'), 'utf8');

const SPEC_PKGS = ['config', 'db', 'auth', 'tenancy', 'secrets', 'import', 'refdata', 'ledger', 'securities', 'posting', 'reports', 'tax', 'portfolio', 'ui', 'web', 'worker'];

describe('workspace (criterion 1)', () => {
  it('holds exactly the ARCH 2.2 packages and apps', () => {
    const real = [...readdirSync(join(root, 'packages')), ...readdirSync(join(root, 'apps'))].sort();
    expect(real).toEqual([...SPEC_PKGS].sort());
  });
  for (const n of SPEC_PKGS) {
    it(`${n}: one vitest test that runs alone`, () => {
      const d = dirOf(n);
      expect(existsSync(join(d, 'package.json'))).toBe(true);
      const tests = readdirSync(join(d, 'src')).filter((f) => f.endsWith('.test.ts'));
      expect(tests.length).toBe(1);
      const r = spawnSync('node', [join(root, 'node_modules/vitest/vitest.mjs'), 'run'], { cwd: d, encoding: 'utf8' });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }, 60_000);
  }
});

describe('layers.json (criteria 2, 21, 22, 23)', () => {
  it('lists every package and app with layer, subpaths and allow-list', () => {
    expect(all()).toEqual([...SPEC_PKGS].sort());
    for (const n of names) {
      const e = layers.packages[n];
      expect(typeof e.layer, n).toBe('number');
      expect(Array.isArray(e.subpaths), n).toBe(true);
      expect(Array.isArray(e.allow), n).toBe(true);
    }
  });

  it('declares db/auth as a restricted subpath of db, and db/session', () => {
    expect(layers.packages.db.subpaths).toEqual(expect.arrayContaining(['./auth', './session']));
    expect(layers.packages.secrets.subpaths).toContain('./open');
  });

  it('names exactly one session-SET exemption: packages/db migrate module, a literal path (no glob)', () => {
    const hits: string[] = [];
    const scan = (o: any, key = '') => {
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) scan(v, k);
      else if (/exempt/i.test(key) && typeof o === 'string') hits.push(o);
    };
    const scanArrays = (o: any, key = '') => {
      if (Array.isArray(o) && /exempt/i.test(key)) hits.push(...o.filter((x) => typeof x === 'string'));
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) scanArrays(v, k);
    };
    scan(layers);
    scanArrays(layers);
    expect(new Set(hits).size).toBe(1);
    const p = [...new Set(hits)][0];
    expect(p).toMatch(/^packages\/db\/src\/migrate/);
    expect(p).not.toMatch(/[*?{}\[\]]/);
    expect(existsSync(join(root, p))).toBe(true);
  });
});

describe('package.json exports + strict linking (criteria 15, 16)', () => {
  for (const n of names) {
    it(`${n}: exports lists only "." and the declared subpaths`, () => {
      const pj = JSON.parse(readFileSync(join(dirOf(n), 'package.json'), 'utf8'));
      const want = ['.', ...layers.packages[n].subpaths].sort();
      expect(Object.keys(pj.exports ?? {}).sort()).toEqual(want);
    });
  }
  it('.npmrc has no workspace hoisting', () => {
    const rc = readFileSync(join(root, '.npmrc'), 'utf8');
    expect(rc).not.toMatch(/^shamefully-hoist\s*=\s*true/m);
    expect(rc).not.toMatch(/^hoist-workspace-packages\s*=\s*true/m);
    expect(rc).not.toMatch(/^public-hoist-pattern\[\]\s*=\s*[^\s]/m);
  });
  it('an undeclared cross-package import does not resolve from the package dir', () => {
    // ui declares no workspace dependency; @poly/db must be unreachable from it.
    const r = spawnSync('node', ['--input-type=module', '-e', "import('@poly/db').then(()=>process.exit(0),()=>process.exit(1))"], { cwd: dirOf('ui') });
    expect(r.status).toBe(1);
  });
});

describe('tsc-resolved criteria (13, 15)', () => {
  const tsc = (cfg: string) => spawnSync('node', [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(here, 'tsc', cfg)], { cwd: root, encoding: 'utf8' });
  it('a deep import past the index fails tsc (moduleResolution bundler)', () => {
    const r = tsc('tsconfig.deep-import.json');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/TS(2307|2792)/);
  });
  it('the @poly/db index does not export the SessionUserId constructor (type test compiles)', () => {
    const r = tsc('tsconfig.db-index.json');
    expect(r.status, r.stdout).toBe(0);
  });
  it('the type test is not vacuous: the same probe against db/session DOES find the constructor', () => {
    const r = tsc('tsconfig.db-session-control.json');
    expect(r.status, r.stdout).toBe(0);
  });
});

describe('eslint config is generated (criterion 3)', () => {
  it('root eslint.config.js builds from scripts/layers/generate.mjs', () => {
    const cfg = readFileSync(join(root, 'eslint.config.js'), 'utf8');
    expect(cfg).toMatch(/layers\/generate/);
    expect(cfg).toMatch(/layers\.json/);
  });
});
