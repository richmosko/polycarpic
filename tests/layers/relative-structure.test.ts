// POLY-140 gate 2 (ruling conditions 6, 7c, 10, 11, 12, 15, 16): the structure half of the relative-import rule.
// The lint fixtures for conditions 1-5, 7a/b, 8, 13, 14, 15, 17 are tests/layers/fixtures/25..29-*; this file holds what a fixture
// cannot say. Each guard is a pure function over file text, shown green on the real tree and red on a mutant input, so the
// guard is not vacuous and no tracked file is edited. Condition 4 (non-test src never leaves its package) is fixtures only,
// all in fixtures/26-src-stays-in-package/.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const layers = JSON.parse(read('layers.json'));
const names: string[] = Object.keys(layers.packages);
const tracked = (...paths: string[]) => spawnSync('git', ['ls-files', ...paths], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('the rules are generated from layers.json (conditions 6, 7c, 15)', () => {
  const gen = async () => {
    const { generateConfig } = await import(pathToFileURL(join(root, 'scripts/layers/generate.mjs')).href);
    return generateConfig(layers, { root }) as { name?: string; rules?: Record<string, any> }[];
  };
  for (const n of names) {
    it(`${n}: poly/restrictions/${n} turns poly/no-relative-cross-package on at error, with its own dir and every other package from the map  [red if: the rule is not generated]`, async () => {
      const block = (await gen()).find((b) => b.name === `poly/restrictions/${n}`);
      const entry = block?.rules?.['poly/no-relative-cross-package'];
      expect(entry, 'rule present in the generated block').toBeDefined();
      expect(Array.isArray(entry) ? entry[0] : entry).toBe(2);
      const opts = JSON.stringify(Array.isArray(entry) ? entry.slice(1) : []);
      expect(opts, 'own dir').toContain(layers.packages[n].dir);
      for (const o of names.filter((x) => x !== n)) expect(opts, `other package ${o}`).toContain(layers.packages[o].dir);
    });
    it(`${n}: poly/restrictions/${n} turns poly/no-require-factory on at error  [red if: the rule is not generated]`, async () => {
      const entry = (await gen()).find((b) => b.name === `poly/restrictions/${n}`)?.rules?.['poly/no-require-factory'];
      expect(entry, 'rule present in the generated block').toBeDefined();
      expect(Array.isArray(entry) ? entry[0] : entry).toBe(2);
    });
  }
  it('eslint.config.js does not name either rule: nothing is hand-written there (criterion 4)', () => {
    const cfg = read('eslint.config.js');
    expect(cfg).not.toMatch(/no-relative-cross-package|no-require-factory/);
  });
});

describe('every source extension is linted (condition 12)', () => {
  const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|svelte)$/;
  const eslint = new ESLint({ cwd: root });
  const linted = async (p: string) => {
    const cfg = await eslint.calculateConfigForFile(join(root, p));
    return !!cfg && 'boundaries/dependencies' in (cfg.rules ?? {});
  };
  for (const p of ['packages/auth/src/x.mts', 'packages/auth/src/x.cts', 'packages/auth/src/x.jsx', 'apps/web/src/x.mts', 'packages/auth/src/x.test.mts']) {
    it(`${p} gets the layer rules  [red if: SRC lacks mts, cts or jsx]`, async () => {
      expect(await linted(p)).toBe(true);
    });
  }
  it('packages/auth/src/x.test.mts is a test file: the cast exemption applies  [red if: TESTS lacks mts]', async () => {
    const cfg = await eslint.calculateConfigForFile(join(root, 'packages/auth/src/x.test.mts'));
    const entry = cfg?.rules?.['poly/no-session-user-id-cast'];
    expect(entry, 'x.test.mts is configured at all').toBeDefined();
    expect(JSON.stringify(entry)).toMatch(/^(0|\[0\]|"off"|\["off"\])$/);
  });
  it('every tracked source file under apps/ or packages/ is matched by SRC', async () => {
    const files = tracked('apps', 'packages').filter((f) => EXT.test(f));
    expect(files.length).toBeGreaterThan(50);
    const missed: string[] = [];
    for (const f of files) if (!(await linted(f))) missed.push(f);
    expect(missed).toEqual([]);
  });
});

describe('no tracked symlink under apps/ or packages/ (condition 10)', () => {
  const symlinks = (lsFilesStage: string) => lsFilesStage.split('\n').filter((l) => /^120000\s/.test(l));
  const real = () => spawnSync('git', ['ls-files', '-s', 'apps', 'packages'], { cwd: root, encoding: 'utf8' }).stdout;
  it('the tree has none', () => {
    expect(real().length).toBeGreaterThan(0);
    expect(symlinks(real())).toEqual([]);
  });
  it('red on: a mode 120000 entry', () => {
    expect(symlinks(`${real()}120000 4f0a3c1e0000000000000000000000000000abcd 0\tpackages/auth/src/link.ts\n`).length).toBe(1);
  });
});

describe('no path alias reaches out of a package (condition 11)', () => {
  const tsconfigViolations = (text: string): string[] => {
    const co = ts.parseConfigFileTextToJson('tsconfig.json', text).config?.compilerOptions ?? {};
    return ['paths', 'baseUrl', 'rootDirs'].filter((k) => k in co);
  };
  const aliasViolations = (text: string): string[] => (/\balias\b/.test(noComments(text)) ? ['alias'] : []);
  it('no tsconfig in apps/*, packages/* or tsconfig.base.json sets paths, baseUrl or rootDirs', () => {
    const files = tracked('apps', 'packages', 'tsconfig.base.json').filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f));
    expect(files).toContain('tsconfig.base.json');
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(tsconfigViolations(read(f)), f).toEqual([]);
  });
  it('apps/web vite and svelte config set no alias (kit.alias, resolve.alias)', () => {
    const files = tracked('apps/web').filter((f) => /^apps\/web\/(vite|svelte)\.config\.[cm]?[jt]s$/.test(f));
    expect(files).toContain('apps/web/vite.config.ts');
    for (const f of files) expect(aliasViolations(read(f)), f).toEqual([]);
  });
  for (const k of ['paths', 'baseUrl', 'rootDirs']) {
    it(`red on: compilerOptions.${k}`, () => {
      const v = k === 'baseUrl' ? '"."' : k === 'rootDirs' ? '["./src", "../x"]' : '{ "x": ["../../ledger/src"] }';
      expect(tsconfigViolations(`{ // comment\n "compilerOptions": { "${k}": ${v} } }`)).toEqual([k]);
    });
  }
  it('red on: resolve.alias in a vite config', () => {
    expect(aliasViolations("export default { resolve: { alias: { '@x': '../../packages/ledger/src' } } };").length).toBe(1);
  });
  it('red on: kit.alias in a svelte config', () => {
    expect(aliasViolations("export default { kit: { alias: { x: '../ledger' } } };").length).toBe(1);
  });
  it('green on: an alias word in a comment', () => {
    expect(aliasViolations('// no alias here\nexport default {};').length).toBe(0);
  });
});

// Condition 15(d): .cjs and .cts have a real module.require whatever the package type, so none may sit under a src dir.
describe('no .cjs or .cts file under apps/*/src or packages/*/src (condition 15d)', () => {
  const offenders = (files: string[]) => files.filter((f) => /^(apps|packages)\/[^/]+\/src\/.*\.c(js|ts)$/.test(f));
  it('the tree has none', () => {
    const files = tracked('apps', 'packages');
    expect(files.length).toBeGreaterThan(100);
    expect(offenders(files)).toEqual([]);
  });
  for (const f of ['packages/auth/src/x.cjs', 'packages/auth/src/x.cts', 'apps/web/src/lib/deep/x.cjs']) {
    it(`red on: ${f}`, () => expect(offenders([...tracked('apps', 'packages'), f])).toEqual([f]));
  }
  it('green on: a .cjs outside src (it is still linted, condition 12)', () => {
    expect(offenders(['packages/auth/scripts/x.cjs', 'apps/web/tests/x.cts'])).toEqual([]);
  });
});

describe('no package-level indirection (condition 16)', () => {
  type Pkg = { path: string; json: Record<string, any> };
  const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const PLAIN_WORKSPACE = /^workspace:[\^~]?(\*|\d[\w.+-]*)?$/;
  function violations(pkgs: Pkg[], rootPkg: Record<string, any>, wsYaml: Record<string, any>): string[] {
    const out: string[] = [];
    const workspaceNames = new Set(pkgs.map((p) => p.json.name as string));
    for (const { path, json } of pkgs) {
      if ('imports' in json) out.push(`${path}: imports field`);
      for (const f of DEP_FIELDS) {
        for (const [key, spec] of Object.entries<string>(json[f] ?? {})) {
          if (/^(link|file|npm):/.test(spec)) out.push(`${path}: ${f}.${key} = ${spec}`);
          else if (spec.startsWith('workspace:')) {
            if (!PLAIN_WORKSPACE.test(spec)) out.push(`${path}: ${f}.${key} workspace alias ${spec}`);
            if (!workspaceNames.has(key)) out.push(`${path}: ${f}.${key} is not a workspace package name`);
          }
        }
      }
    }
    const overrides = [rootPkg.pnpm?.overrides, rootPkg.overrides, rootPkg.resolutions, wsYaml.overrides];
    for (const o of overrides) for (const [k, v] of Object.entries<string>(o ?? {})) if (/^(link|file|npm|workspace):/.test(v)) out.push(`override ${k} = ${v}`);
    return out;
  }
  const realPkgs = (): Pkg[] =>
    tracked('apps', 'packages')
      .filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f))
      .map((f) => ({ path: f, json: JSON.parse(read(f)) }));
  const realRoot = () => JSON.parse(read('package.json'));
  const realWs = () => (existsSync(join(root, 'pnpm-workspace.yaml')) ? parseYaml(read('pnpm-workspace.yaml')) : {}) ?? {};

  it('the real tree is clean (and the checker sees every package)', () => {
    expect(realPkgs().length).toBe(names.length);
    expect(violations(realPkgs(), realRoot(), realWs())).toEqual([]);
  });
  it('the real pnpm-workspace.yaml overrides are all "-" (removal), as the checker expects', () => {
    const o = realWs().overrides ?? {};
    expect(Object.keys(o).length).toBeGreaterThan(0);
    expect(Object.values(o).every((v) => v === '-')).toBe(true);
  });
  const mutate = (f: (pkgs: Pkg[], root: Record<string, any>, ws: Record<string, any>) => void) => {
    const pkgs = structuredClone(realPkgs());
    const r = structuredClone(realRoot());
    const ws = structuredClone(realWs());
    f(pkgs, r, ws);
    return violations(pkgs, r, ws);
  };
  const auth = (p: Pkg[]) => p.find((x) => x.path === 'packages/auth/package.json')!.json;
  const cases: [string, Parameters<typeof mutate>[0]][] = [
    ['an imports field', (p) => (auth(p).imports = { '#ledger': '../ledger/src/index.ts' })],
    ['dependencies "link:"', (p) => ((auth(p).dependencies ??= {})['@poly/ledger'] = 'link:../ledger')],
    ['devDependencies "file:"', (p) => ((auth(p).devDependencies ??= {})['@poly/ledger'] = 'file:../ledger')],
    ['peerDependencies "npm:"', (p) => ((auth(p).peerDependencies ??= {})['x'] = 'npm:@poly/ledger@*')],
    ['optionalDependencies "link:"', (p) => ((auth(p).optionalDependencies ??= {})['x'] = 'link:../ledger')],
    ['"workspace:@poly/ledger@*" alias form', (p) => ((auth(p).dependencies ??= {})['@poly/db'] = 'workspace:@poly/ledger@*')],
    ['"workspace:ledger@*" alias form', (p) => ((auth(p).dependencies ??= {})['ledger-alias'] = 'workspace:ledger@*')],
    ['a workspace package under a key that is not its @poly name', (p) => ((auth(p).dependencies ??= {})['ledger-alias'] = 'workspace:*')],
    ['root package.json pnpm.overrides to "link:"', (_p, r) => ((r.pnpm ??= {}).overrides = { '@poly/db': 'link:../ledger' })],
    ['root package.json overrides to "file:"', (_p, r) => (r.overrides = { x: 'file:../ledger' })],
    ['root package.json resolutions to "link:"', (_p, r) => (r.resolutions = { x: 'link:../ledger' })],
    ['pnpm-workspace.yaml overrides to "npm:"', (_p, _r, ws) => ((ws.overrides ??= {})['better-auth>pg'] = 'npm:@poly/ledger@*')],
    ['pnpm-workspace.yaml overrides to "workspace:"', (_p, _r, ws) => ((ws.overrides ??= {})['better-auth>pg'] = 'workspace:*')],
  ];
  for (const [name, f] of cases) {
    it(`red on: ${name}  [red if: the checker stops flagging it]`, () => {
      expect(mutate(f).length).toBeGreaterThan(0);
    });
  }
  it('green on: plain workspace specs ("workspace:*", "workspace:^") under their own @poly name', () => {
    expect(mutate((p) => ((auth(p).dependencies ??= {})['@poly/ledger'] = 'workspace:^'))).toEqual([]);
  });
  it('every package declares itself as @poly/<its dir name>', () => {
    for (const p of realPkgs()) expect(p.json.name, p.path).toBe(`@poly/${basename(p.path.replace(/\/package\.json$/, ''))}`);
  });
});

// Condition 16 (addendum 2): a readPackage hook can rewrite a dependency to link: with no package.json change.
describe('no pnpmfile hook (condition 16, addendum 2)', () => {
  const OK_KEY = /^(ignore-pnpmfile|ignorePnpmfile)$/;
  const fileViolations = (files: string[]) => files.filter((f) => /pnpmfile/i.test(f));
  const npmrcViolations = (text: string) =>
    text.split('\n').map((l) => l.match(/^\s*([^#;=\s][^=]*?)\s*=/)?.[1] ?? '').filter((k) => /pnpmfile/i.test(k) && !OK_KEY.test(k));
  const keyViolations = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).filter((k) => /pnpmfile/i.test(k) && !OK_KEY.test(k));
  const all = () => spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  it('no tracked file is named like a pnpmfile', () => {
    expect(all().length).toBeGreaterThan(500);
    expect(fileViolations(all())).toEqual([]);
  });
  it('.npmrc, pnpm-workspace.yaml and package.json#pnpm hold no pnpmfile key', () => {
    expect(npmrcViolations(read('.npmrc'))).toEqual([]);
    expect(keyViolations(parseYaml(read('pnpm-workspace.yaml')))).toEqual([]);
    expect(keyViolations(JSON.parse(read('package.json')).pnpm)).toEqual([]);
  });
  it('red on: a tracked .pnpmfile.cjs, and a nested *pnpmfile* file', () => {
    expect(fileViolations([...all(), '.pnpmfile.cjs']).length).toBe(1);
    expect(fileViolations([...all(), 'tools/x/custom-pnpmfile.mjs']).length).toBe(1);
  });
  it('red on: pnpmfile= and global-pnpmfile= in .npmrc', () => {
    expect(npmrcViolations('pnpmfile=.pnpmfile.cjs\n')).toEqual(['pnpmfile']);
    expect(npmrcViolations('# c\nglobal-pnpmfile = ../x.cjs\n')).toEqual(['global-pnpmfile']);
  });
  it('red on: a pnpmfile key in pnpm-workspace.yaml and in package.json#pnpm', () => {
    expect(keyViolations(parseYaml('pnpmfile: .pnpmfile.cjs\npackages: []\n'))).toEqual(['pnpmfile']);
    expect(keyViolations({ globalPnpmfile: '../x.cjs' })).toEqual(['globalPnpmfile']);
  });
  it('green on: ignore-pnpmfile and ignorePnpmfile', () => {
    expect(npmrcViolations('ignore-pnpmfile=true\n')).toEqual([]);
    expect(keyViolations({ ignorePnpmfile: true })).toEqual([]);
  });
});
