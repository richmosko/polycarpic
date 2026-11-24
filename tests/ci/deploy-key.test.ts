// POLY-100 T-real (ruling.md 3765f358, S38 a): the `deploy` key of infra/ci/changes.mjs gates the one real first-deploy step of the image job. Each row of the ruling's table has a path that sets it; every fault T-real
// would have caught is pinned by the path that held it; routes, components, the ledger package and tests leave it false; and every file the suite imports (the walk, as tests/ci does for the db battery) sets it.
// Red on a mutant dropping any row (each regex must be the only one matching some pinned path) and on an unlisted import.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLE, classify } from '../../infra/ci/changes.mjs';
import { ROOT } from './helpers.ts';

/** One path per row of the ruling, and the fault it pins. */
const ROWS: [string, string][] = [
  ['Dockerfile', 'F1 (the real tar)'],
  ['.dockerignore', 'the build context'],
  ['bin/polycarpic', 'the entrypoint'],
  ['infra/ops/lib/stack.py', 'F16 (`compose run` options)'],
  ['infra/ops/lib/release.py', 'G1 (the umask), the tool'],
  ['infra/ops/commands/deploy.py', 'the tool'],
  ['infra/deploy/compose-allow.json', 'the installed policy'],
  ['infra/compose/staging.yml', 'PLAID_ENV, the compose files'],
  ['infra/compose/edge.yml', 'the edge networks'],
  ['infra/caddy/Caddyfile', 'what the bundle holds'],
  ['infra/postgres/postgresql.prod.conf', 'what the bundle holds'],
  ['infra/backup/backup.sh', 'what the bundle holds'],
  ['infra/postgres-major', 'what the bundle holds'],
  ['infra/provision.sh', 'G1 (the directories), MAIL_FROM (the env files)'],
  ['infra/provision-check.sh', 'H23, H24'],
  ['infra/ci/image.sh', 'the images'],
  ['infra/ci/images-env.sh', 'images.env'],
  ['packages/config/src/check.ts', 'PLAID_ENV, MAIL_FROM: the settings contract'],
  ['packages/config/package.json', 'the settings contract'],
  ['packages/db/migrations/0001_init.sql', 'migrations'],
  ['packages/db/sql/roles.sql', 'migrations and roles'],
  ['packages/db/src/migrate.ts', 'the runner'],
  ['packages/db/src/journal.ts', 'the runner'],
  ['packages/db/src/connection.ts', 'the runner'],
  ['apps/migrate/src/cli.ts', 'startup code'],
  ['apps/web/src/main.ts', 'startup code'],
  ['apps/worker/src/startup.ts', 'startup code'],
  ['apps/auth/src/bind.ts', 'startup code'],
  ['apps/worker/src/jobs/index.ts', 'startup code'],
  ['apps/web/src/ops/health.ts', 'the health route'],
  ['tests/infra/deploy-real/first-deploy.test.ts', 'the test'],
  ['tests/infra/vitest.deploy-real.config.ts', "the suite's config"],
  ['infra/ci/changes.mjs', 'its trigger'],
  ['.github/workflows/ci.yml', 'its job'],
];

/** Paths that must NOT set the key (ruling: the rest of apps/ and packages/, lockfile and manifests, tests). */
const NEGATIVES = [
  'apps/web/src/routes/+page.svelte',
  'apps/web/src/lib/components/Button.svelte',
  'packages/ledger/src/entries.ts',
  'packages/config/src/check.test.ts',
  'apps/web/src/ops/health.test.ts',
  'pnpm-lock.yaml',
  'package.json',
  'docs/PRD/index.html',
  'process/cairn/issues/POLY-100.md',
];

describe('the `deploy` key (ruling 3765f358)', () => {
  it('the key exists in TABLE', () => {
    expect(Object.keys(TABLE)).toContain('deploy');
  });

  for (const [p, why] of ROWS) {
    it(`${p} sets deploy  (${why})`, () => {
      expect(classify([p]).deploy, p).toBe(true);
    });
  }

  for (const p of NEGATIVES) {
    it(`${p} leaves deploy false`, () => {
      expect(classify([p]).deploy, p).toBe(false);
    });
  }

  it('every row is needed: dropping any one regex loses a pinned path that no other regex matches  [red if: a row is dropped]', () => {
    const res: RegExp[] = (TABLE as any).deploy ?? [];
    expect(res.length).toBeGreaterThan(0);
    const paths = ROWS.map(([p]) => p);
    res.forEach((re, i) => {
      const others = res.filter((_, j) => j !== i);
      const lost = paths.filter((p) => re.test(p) && !others.some((o) => o.test(p)));
      expect(lost.length, `no pinned path needs ${re}: the row is unpinned or redundant`).toBeGreaterThan(0);
    });
  });
});

// ---- the suite's own import closure sets the key (S38 a) ----
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(ts|mjs|js)$/.test(n) ? [p] : [];
}) : []);
const spec = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const withExt = (p: string): string | null => [p, `${p}.ts`, join(p, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;

describe('the suite does not import what the key cannot see', () => {
  const roots = [...walk(join(ROOT, 'tests', 'infra', 'deploy-real')), join(ROOT, 'tests', 'infra', 'vitest.deploy-real.config.ts')].filter((f) => existsSync(f));
  const closure = (): string[] => {
    const seen = new Set<string>();
    const todo = [...roots];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!/\.(ts|mjs|js)$/.test(f)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(spec)) {
        if (!m[1]!.startsWith('.')) continue; // node: builtins and packages
        const r = withExt(resolve(dirname(f), m[1]!));
        if (r && !r.includes('/node_modules/')) todo.push(r);
      }
    }
    return [...seen].map((f) => relative(ROOT, f)).sort();
  };

  it('the walk is not vacuous: the suite exists and reaches its own files  [red if: the suite is absent or the specifier regex is wrong]', () => {
    const rel = closure();
    expect(rel.length, 'tests/infra/deploy-real is absent').toBeGreaterThan(1);
    expect(rel.some((f) => f.startsWith('tests/infra/deploy-real/'))).toBe(true);
  });

  it('every file in the closure sets deploy  [red if: the suite imports a helper the key does not cover]', () => {
    expect(closure().filter((p) => !classify([p]).deploy)).toEqual([]);
  });
});
