// POLY-102 R5 / V8: the import closure of the db battery reaches only files the `db` filter matches, so a change to anything
// the battery runs triggers the db job. Roots: tests/db/**/*.ts and each spawned entrypoint. Followed through relative specifiers
// and `@poly/*` specifiers resolved via each workspace package.json `exports`. Data files read with join(ROOT|DB_PKG, ...) cannot
// be seen statically; they are explicit cases in changes.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../infra/ci/changes.mjs';
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
  ...['apps/migrate/src/cli.ts', 'apps/web/src/main.ts', ...readdirSync(join(ROOT, 'apps/web/src/ops')).map((f) => `apps/web/src/ops/${f}`)].map((f) => join(ROOT, f)),
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
