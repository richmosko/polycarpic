// POLY-102 R5 / V8: the import closure of the db battery reaches only files the `db` filter matches, so a change to anything
// the battery runs triggers the db job. Roots: tests/db/**/*.ts and each spawned entrypoint. Followed through relative specifiers
// and `@poly/*` specifiers resolved via each workspace package.json `exports`. Data files read with join(ROOT|DB_PKG, ...) cannot
// be seen statically; they are explicit cases in changes.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../infra/ci/changes.mjs';
import * as changes from '../../infra/ci/changes.mjs';
import { ROOT } from './helpers.ts';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(ts|mjs|js)$/.test(n) ? [p] : [];
});

const pkgs = new Map<string, { dir: string; exports: Record<string, unknown> }>();
for (const base of ['packages', 'apps']) {
  for (const d of readdirSync(join(ROOT, base))) {
    const f = join(ROOT, base, d, 'package.json');
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (j.name) pkgs.set(j.name, { dir: join(ROOT, base, d), exports: typeof j.exports === 'string' ? { '.': j.exports } : (j.exports ?? {}) });
  }
}
const exportTarget = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' ? exportTarget((v as any).import ?? (v as any).default ?? (v as any).types) : null);

const spec = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const withExt = (p: string): string | null => [p, `${p}.ts`, join(p, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
function resolveSpec(from: string, s: string): string | null {
  if (s.startsWith('.')) return withExt(resolve(dirname(from), s));
  const m = /^(@poly\/[^/]+)(\/.*)?$/.exec(s);
  if (!m) return null; // node: builtins and third-party packages
  const p = pkgs.get(m[1]!);
  const t = p && exportTarget(p.exports[m[2] ? `.${m[2]}` : '.']);
  return p && t ? withExt(resolve(p.dir, t)) : null;
}

const roots = [
  ...walk(join(ROOT, 'tests', 'db')),
  ...['apps/migrate/src/cli.ts', 'apps/web/src/main.ts', 'apps/worker/src/cli/main.ts', ...readdirSync(join(ROOT, 'apps/web/src/ops')).map((f) => `apps/web/src/ops/${f}`)].map((f) => join(ROOT, f)),
];
function closure(): Set<string> {
  const seen = new Set<string>();
  const todo = roots.filter((f) => existsSync(f));
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|mjs|js)$/.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(spec)) {
      const r = resolveSpec(f, m[1]!);
      if (r && !r.includes('/node_modules/')) todo.push(r);
    }
  }
  return seen;
}

describe('the db filter covers the transitive import closure of the db battery', () => {
  const rel = [...closure()].map((f) => relative(ROOT, f)).sort();

  it('the walk is not vacuous: it reaches @poly/config (and /log), @poly/db subpaths, tenancy, tests/log and the entrypoints  [red if: the specifier regex or the @poly/exports resolution stops working]', () => {
    for (const must of ['packages/config/src/index.ts', 'packages/db/src/startup.ts', 'packages/db/src/migrate.ts', 'packages/tenancy/src/index.ts', 'tests/log/canary.ts', 'apps/migrate/src/cli.ts', 'apps/web/src/main.ts', 'apps/web/src/ops/status.ts']) {
      expect(rel, must).toContain(must);
    }
  });

  it('every file in the closure sets `db`  [red if: a db pattern is removed: packages/config/**, packages/tenancy/**, apps/migrate/**, apps/web/src/ops/**, apps/web/src/main.ts, tests/log/**]', () => {
    expect(rel.filter((p) => !classify([p]).db)).toEqual([]);
  });
});

// POLY-141 C9 (criterion 5): per area, the closure of its test files lies inside that area's paths or the shared set.
// Extra edges beyond import specifiers: `join(ROOT|DB_PKG, 'a', 'b')` literals (a file the test reads or spawns) and
// `new URL('./x', import.meta.url)`. A computed path string is invisible here (the ruling's residual risk; reviewers watch for it).
type AreaDef = { tests: string[]; paths: RegExp[] };
const joinEdge = /join\(\s*(ROOT|DB_PKG)\s*,\s*((?:'[^']*'\s*,\s*)*'[^']*')\s*\)/g;
const urlEdge = /new URL\(\s*'(\.[^']*)'\s*,\s*import\.meta\.url/g;
function areaClosure(testFiles: string[]): Set<string> {
  const seen = new Set<string>();
  const todo = testFiles.map((f) => join(ROOT, f)).filter((f) => existsSync(f));
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|mjs|js)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(spec)) { const r = resolveSpec(f, m[1]!); if (r && !r.includes('/node_modules/')) todo.push(r); }
    for (const m of text.matchAll(joinEdge)) {
      const segs = [...m[2]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
      const p = join(m[1] === 'ROOT' ? ROOT : join(ROOT, 'packages', 'db'), ...segs);
      if (existsSync(p) && statSync(p).isFile()) todo.push(p);
    }
    for (const m of text.matchAll(urlEdge)) { const p = resolve(dirname(f), m[1]!); if (existsSync(p) && statSync(p).isFile()) todo.push(p); }
  }
  return seen;
}
export function areaViolations(rel: string[], area: AreaDef, shared: RegExp[]): string[] {
  return rel.filter((p) => !area.tests.includes(p) && !shared.some((re) => re.test(p)) && !area.paths.some((re) => re.test(p)));
}

describe('each db area\'s import closure lies inside its own paths or the shared set (POLY-141 C9, criterion 5)', () => {
  const defs = () => {
    const { DB_AREAS, DB_SHARED } = changes as unknown as { DB_AREAS?: Record<string, AreaDef>; DB_SHARED?: RegExp[] };
    if (!DB_AREAS || !DB_SHARED) throw new Error('infra/ci/changes.mjs does not export DB_AREAS and DB_SHARED');
    return { DB_AREAS, DB_SHARED };
  };
  it('the walk follows join(ROOT, ...) and join(DB_PKG, ...) literals: ops reaches main.ts and the status module, migrate reaches apps/migrate/src/cli.ts', () => {
    const ops = [...areaClosure(['tests/db/ops-hardening.test.ts', 'tests/db/ops-status.test.ts'])].map((f) => relative(ROOT, f));
    for (const must of ['apps/web/src/main.ts', 'apps/web/src/ops/status.ts', 'tests/db/helpers/api.ts']) expect(ops, must).toContain(must);
    const mig = [...areaClosure(['tests/db/runner.test.ts'])].map((f) => relative(ROOT, f));
    expect(mig).toContain('apps/migrate/src/cli.ts');
    expect(mig).toContain('packages/db/sql/roles.sql');
  });
  for (const a of ['auth', 'tenancy', 'migrate', 'ops']) {
    it(`${a}: every file its tests import, read or spawn is in ${a}'s paths or the shared set  [red if: an ${a} test reaches a file only another area's paths cover]`, () => {
      const { DB_AREAS, DB_SHARED } = defs();
      const area = DB_AREAS[a]!;
      const rel = [...areaClosure(area.tests)].map((f) => relative(ROOT, f)).sort();
      expect(areaViolations(rel, area, DB_SHARED)).toEqual([]);
    });
  }
  it('the check can fail: a fixture where an auth test reaches a file covered only by ops paths is reported', () => {
    const auth: AreaDef = { tests: ['tests/db/auth-session.test.ts'], paths: [/^packages\/auth\//] };
    const shared = [/^packages\/db\//];
    const closure = ['tests/db/auth-session.test.ts', 'packages/auth/src/x.ts', 'packages/db/src/y.ts', 'apps/web/src/ops/status.ts'];
    expect(areaViolations(closure, auth, shared)).toEqual(['apps/web/src/ops/status.ts']);
  });
  it('the shared set alone covers what every test file reaches through helpers/api.ts: packages/db, apps/migrate, packages/config, the helpers', () => {
    const { DB_SHARED } = defs();
    for (const p of ['packages/db/src/migrate.ts', 'packages/db/sql/roles.sql', 'packages/db/migrations/0001_init.sql', 'apps/migrate/src/cli.ts', 'packages/config/src/index.ts', 'tests/db/helpers/api.ts', 'tests/db/helpers/pg.ts', 'tests/db/docker/Dockerfile', 'infra/postgres/Dockerfile', 'infra/postgres-major', 'pnpm-lock.yaml']) {
      expect(DB_SHARED.some((re) => re.test(p)), p).toBe(true);
    }
  });
});

// POLY-141 E2 (ruling § Filter gap): the web e2e step imports the db harness. Every file the e2e files reach outside apps/web/
// must be in a workspace package apps/web/package.json lists (turbo sees those) or match TABLE.e2e.
export function e2eViolations(rel: string[], listedPackageDirs: string[], e2eRes: RegExp[]): string[] {
  return rel.filter((p) => !p.startsWith('apps/web/') && !listedPackageDirs.some((d) => p.startsWith(`${d}/`)) && !e2eRes.some((re) => re.test(p)));
}
describe('the web e2e import closure is covered by turbo packages or TABLE.e2e (POLY-141 E2)', () => {
  const e2eFiles = () => readdirSync(join(ROOT, 'apps/web/tests/e2e')).filter((f) => f.endsWith('.ts')).map((f) => `apps/web/tests/e2e/${f}`);
  const listedDirs = () => {
    const deps = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8')) as Record<string, Record<string, string>>;
    const names = Object.keys({ ...deps.dependencies, ...deps.devDependencies }).filter((n) => n.startsWith('@poly/'));
    return names.map((n) => relative(ROOT, pkgs.get(n)?.dir ?? join(ROOT, 'packages', 'MISSING', n)));
  };
  const tableE2e = () => {
    const re = (changes as unknown as { TABLE: Record<string, RegExp[]> }).TABLE.e2e;
    if (!re) throw new Error('infra/ci/changes.mjs TABLE has no e2e key');
    return re;
  };
  it('the walk reaches serve.ts and the harness it imports (not vacuous)', () => {
    const rel = [...areaClosure(e2eFiles())].map((f) => relative(ROOT, f));
    expect(rel).toContain('apps/web/tests/e2e/serve.ts');
    expect(rel).toContain('tests/db/helpers/api.ts');
    expect(rel).toContain('tests/db/helpers/pg.ts');
    expect(rel).toContain('apps/migrate/src/cli.ts');
  });
  it('every file outside apps/web/ in the closure is in a listed workspace package or matched by TABLE.e2e  [red if: serve.ts imports a file the key does not cover]', () => {
    const rel = [...areaClosure(e2eFiles())].map((f) => relative(ROOT, f)).sort();
    expect(e2eViolations(rel, listedDirs(), tableE2e())).toEqual([]);
  });
  it('the data files the harness reads are matched by TABLE.e2e: pgtap-image.mjs, the Postgres Dockerfile and major, tests/db/docker', () => {
    const re = tableE2e();
    for (const p of ['tests/db/helpers/pgtap-image.mjs', 'infra/postgres/Dockerfile', 'infra/postgres-major', 'tests/db/docker/Dockerfile', 'apps/migrate/src/cli.ts']) expect(re.some((r) => r.test(p)), p).toBe(true);
  });
  it('the check can fail: a fixture closure with an uncovered tests/db/new-thing.ts is reported', () => {
    const closure = ['apps/web/tests/e2e/serve.ts', 'packages/db/src/x.ts', 'tests/db/helpers/api.ts', 'tests/db/new-thing.ts'];
    expect(e2eViolations(closure, ['packages/db'], [/^tests\/db\/helpers\//])).toEqual(['tests/db/new-thing.ts']);
  });
});
