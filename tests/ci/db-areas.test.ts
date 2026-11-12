// POLY-141 C7, C8, C10 (+ S7, S8): the db area map in infra/ci/changes.mjs and its `--db-select` CLI (ruling R3).
// Contract the builder implements (pinned here):
//   export const DB_SHARED: RegExp[]
//   export const DB_AREAS: { auth|tenancy|migrate|ops: { tests: string[] /* exact repo-relative files */, paths: RegExp[] } }
//   classify(paths) -> TABLE's five keys + db_auth, db_tenancy, db_migrate, db_ops; `db` = OR of the four areas for every
//     input; a shared path, or a `db` path in no area, turns all four on; a non-`db` path turns none on.
//   CLI stdin is NUL-separated paths (see changes.test.ts); `--none` prints the nine keys false (anchor.test.ts).
//   `node infra/ci/changes.mjs --db-select`: env DB_AUTH DB_TENANCY DB_MIGRATE DB_OPS, each exactly `true` or `false`.
//     Prints `all` iff all four are true, else the union of the selected areas' test files, one per line, each matching
//     ^tests/db/[a-z0-9-]+\.test\.ts$. Exit 1: an invalid map (a tests/db/*.test.ts in no area or in two, or a listed file that
//     does not exist), no area on, or a value that is not exactly true/false.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ci, node, ROOT } from './helpers.ts';

type Area = { tests: string[]; paths: RegExp[] };
const AREAS = ['auth', 'tenancy', 'migrate', 'ops'] as const;
const KEYS9 = ['ci', 'db', 'db_auth', 'db_migrate', 'db_ops', 'db_tenancy', 'image', 'layers', 'node'];
const ch = async (): Promise<{ classify: (p: string[]) => Record<string, boolean>; DB_AREAS: Record<string, Area>; DB_SHARED: RegExp[] }> => {
  const m: any = await import(pathToFileURL(ci('changes.mjs')).href);
  if (!m.DB_AREAS || !m.DB_SHARED) throw new Error('infra/ci/changes.mjs does not export DB_AREAS and DB_SHARED');
  return m;
};
const FILES = readdirSync(join(ROOT, 'tests/db')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/db/${f}`).sort();

// The ruling's table, pinned: which file belongs to which area.
const TABLE: Record<(typeof AREAS)[number], string[]> = {
  auth: ['auth-client-ip', 'auth-fields', 'auth-route-policy', 'auth-routing-pool', 'auth-second-step', 'auth-session', 'auth-signup-wrap'],
  tenancy: ['tenancy', 'matrix', 'wrappers', 'battery', 'pgtap'],
  migrate: ['checks', 'connection', 'migrate-run-helper', 'runner', 'template-clone'],
  ops: ['ops-status', 'ops-hardening'],
};
const tf = (names: string[]) => names.map((n) => `tests/db/${n}.test.ts`).sort();

describe('C7 one area, one project', () => {
  it('DB_AREAS has exactly auth, tenancy, migrate, ops, with the ruling\'s test files  [red if: a file moves area]', async () => {
    const { DB_AREAS } = await ch();
    expect(Object.keys(DB_AREAS).sort()).toEqual([...AREAS].sort());
    for (const a of AREAS) expect([...DB_AREAS[a]!.tests].sort(), a).toEqual(tf(TABLE[a]));
  });
  it('every tests/db/*.test.ts on disk is in exactly one area and every listed file exists  [red for a file in none, in two, or missing]', async () => {
    const { DB_AREAS } = await ch();
    const all = AREAS.flatMap((a) => DB_AREAS[a]!.tests);
    for (const f of FILES) expect(all.filter((x) => x === f).length, f).toBe(1);
    for (const f of all) expect(existsSync(join(ROOT, f)), f).toBe(true);
    expect([...all].sort()).toEqual(FILES);
  });
  it('every file is in exactly one project: SERIAL or the parallel remainder; SERIAL files are in migrate and ops only', async () => {
    const cfg: any = await import(pathToFileURL(join(ROOT, 'tests/db/vitest.config.ts')).href);
    if (!Array.isArray(cfg.SERIAL)) throw new Error('tests/db/vitest.config.ts does not export SERIAL');
    const { DB_AREAS } = await ch();
    for (const s of cfg.SERIAL as string[]) expect([...DB_AREAS.migrate!.tests, ...DB_AREAS.ops!.tests], s).toContain(s);
  });
  it('each area\'s own test files match its own paths and no other area\'s  [red if: a test file is not covered by its area]', async () => {
    const { classify, DB_AREAS } = await ch();
    for (const a of AREAS) for (const f of DB_AREAS[a]!.tests) {
      const out = classify([f]);
      expect(out[`db_${a}`], `${f} -> db_${a}`).toBe(true);
      for (const b of AREAS) if (b !== a) expect(out[`db_${b}`], `${f} -> db_${b}`).toBe(false);
    }
  });
});

describe('C8 classify', () => {
  const on = async (paths: string[]) => { const { classify } = await ch(); const o = classify(paths); return AREAS.filter((a) => o[`db_${a}`]); };
  const ALL = [...AREAS];

  const ONLY: [string[], (typeof AREAS)[number][], string][] = [
    [['packages/auth/src/index.ts'], ['auth'], 'packages/auth dropped from auth, or widened to all'],
    [['packages/tenancy/src/index.ts'], ['auth', 'tenancy'], 'packages/tenancy dropped from auth or tenancy'],
    [['packages/tenancy/permission-matrix.json'], ['auth', 'tenancy'], 'the matrix json dropped'],
    [['tests/db/pgtap/02_rls_catalog.sql'], ['tenancy'], 'tests/db/pgtap dropped from tenancy'],
    [['apps/web/src/ops/status.ts'], ['ops'], 'apps/web/src/ops dropped from ops'],
    [['apps/web/src/main.ts'], ['ops'], 'main.ts dropped from ops'],
    [['apps/web/src/startup.ts'], ['ops'], 'startup.ts dropped from ops'],
    [['tests/log/canary.ts'], ['ops'], 'tests/log dropped from ops'],
    [['tests/db/runner.test.ts'], ['migrate'], 'runner moved'],
    [['tests/db/ops-hardening.test.ts', 'tests/db/auth-session.test.ts'], ['auth', 'ops'], 'a union of two areas is lost'],
  ];
  for (const [paths, want, mut] of ONLY) {
    it(`${paths.join(' + ')} -> {${want.join(',')}}  [red if: ${mut}]`, async () => { expect(await on(paths)).toEqual(want); });
  }

  const SHARED = [
    'packages/db/src/connection.ts', 'packages/db/migrations/0001_init.sql', 'packages/db/sql/roles.sql', 'packages/db/package.json', 'apps/migrate/src/cli.ts',
    'packages/config/src/index.ts', 'tests/db/helpers/api.ts', 'tests/db/helpers/pg.ts', 'tests/db/global-setup.ts', 'tests/db/vitest.config.ts',
    'tests/db/docker/Dockerfile', 'infra/postgres/Dockerfile', 'infra/postgres-major', 'pnpm-lock.yaml',
    // S8: root manifests and config that every package resolves through
    'package.json', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'tsconfig.base.json', 'apps/web/package.json', 'apps/web/tsconfig.json',
  ];
  for (const p of SHARED) it(`shared path ${p} -> all four  [red if: it is dropped from DB_SHARED / TABLE.db]`, async () => { expect(await on([p])).toEqual(ALL); });
  it('a shared path with an area path -> all four', async () => { expect(await on(['pnpm-lock.yaml', 'packages/auth/src/x.ts'])).toEqual(ALL); });

  for (const p of ['tests/db/new.test.ts', 'tests/db/x.sql', 'tests/db/helpers/new-helper.ts', 'tests/db/pgtap-new/x.sql']) {
    it(`a db path in no area (${p}) -> all four (fail closed)`, async () => { expect(await on([p])).toEqual(ALL); });
  }
  for (const p of ['docs/PRD/index.html', 'process/STATE.md', 'apps/web/src/routes/+page.svelte', 'infra/ci/changes.mjs', 'Dockerfile']) {
    it(`a non-db path (${p}) -> none  [red if: db_* keys widened beyond TABLE.db]`, async () => { expect(await on([p])).toEqual([]); });
  }
  it('db equals the OR of the four area keys for every fixture above and for the empty list', async () => {
    const { classify } = await ch();
    const fixtures = [...ONLY.map((c) => c[0]), ...SHARED.map((p) => [p]), [], ['docs/PRD/index.html'], ['tests/db/new.test.ts'], ['docs/PRD/index.html', 'packages/auth/src/x.ts']];
    for (const f of fixtures) {
      const o = classify(f);
      expect(o.db, f.join(',')).toBe(AREAS.some((a) => o[`db_${a}`]));
    }
  });
  it('the CLI prints exactly the nine keys, NUL-separated input', () => {
    const r = node('changes.mjs', { input: ['README.md', 'packages/auth/src/x.ts'].join('\0') + '\0' });
    expect(r.code, r.stderr).toBe(0);
    const out = Object.fromEntries(r.stdout.split('\n').filter(Boolean).map((l) => l.split('=')));
    expect(Object.keys(out).sort()).toEqual(KEYS9);
    expect(out).toMatchObject({ db: 'true', db_auth: 'true', db_tenancy: 'false', db_migrate: 'false', db_ops: 'false' });
  });
});

describe('C10 --db-select', () => {
  const FALSE = { DB_AUTH: 'false', DB_TENANCY: 'false', DB_MIGRATE: 'false', DB_OPS: 'false' };
  const sel = (env: Record<string, string>, cwd = ROOT) => node('changes.mjs', { args: ['--db-select'], env, cwd });
  const lines = (s: string) => s.split('\n').filter(Boolean);

  it('all four on -> prints `all` and nothing else', () => {
    const r = sel({ DB_AUTH: 'true', DB_TENANCY: 'true', DB_MIGRATE: 'true', DB_OPS: 'true' });
    expect(r.code, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(['all']);
  });
  for (const a of AREAS) {
    it(`only ${a} -> exactly its test files, one per line  [red if: another area's file leaks in]`, () => {
      const r = sel({ ...FALSE, [`DB_${a.toUpperCase()}`]: 'true' });
      expect(r.code, r.stderr).toBe(0);
      expect(lines(r.stdout).sort()).toEqual(tf(TABLE[a]));
      for (const l of lines(r.stdout)) expect(l).toMatch(/^tests\/db\/[a-z0-9-]+\.test\.ts$/);
    });
  }
  it('two areas -> the union', () => {
    const r = sel({ ...FALSE, DB_AUTH: 'true', DB_OPS: 'true' });
    expect(lines(r.stdout).sort()).toEqual(tf([...TABLE.auth, ...TABLE.ops]));
  });
  it('three areas -> the union, not `all`', () => {
    const r = sel({ ...FALSE, DB_AUTH: 'true', DB_OPS: 'true', DB_MIGRATE: 'true' });
    expect(lines(r.stdout)).not.toContain('all');
    expect(lines(r.stdout).sort()).toEqual(tf([...TABLE.auth, ...TABLE.ops, ...TABLE.migrate]));
  });
  it('no area on -> exit 1  [red if: an empty selection runs everything or nothing]', () => {
    const r = sel(FALSE);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/\S/);
    expect(r.stderr).not.toMatch(/no changed paths on stdin/); // the stdin guard of the plain mode is not an answer to --db-select
  });
  for (const [name, env] of [
    ['a missing variable', { DB_AUTH: 'true', DB_TENANCY: 'false', DB_MIGRATE: 'false' }],
    ['TRUE', { ...FALSE, DB_AUTH: 'TRUE' }],
    ['1', { ...FALSE, DB_AUTH: '1' }],
    ['an empty value', { ...FALSE, DB_AUTH: '' }],
    ['a value with a trailing space', { ...FALSE, DB_OPS: 'true ' }],
  ] as [string, Record<string, string>][]) {
    it(`${name} -> exit 1, nothing on stdout  [red if: anything but exactly true/false is read as false]`, () => {
      const r = sel(env);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).not.toMatch(/no changed paths on stdin/);
    });
  }

  // The map is checked against the disk. A copy of changes.mjs runs in a scratch tree so the disk can be wrong on purpose.
  const tree = (files: string[]) => {
    const root = mkdtempSync(join(tmpdir(), 'poly141-sel-'));
    mkdirSync(join(root, 'infra/ci'), { recursive: true });
    cpSync(ci('changes.mjs'), join(root, 'infra/ci/changes.mjs'));
    mkdirSync(join(root, 'tests/db'), { recursive: true });
    for (const f of files) writeFileSync(join(root, f), '');
    return root;
  };
  const runIn = (root: string) => {
    // node() runs ROOT's script; run the scratch copy directly.
    const r = spawnSync('node', [join(root, 'infra/ci/changes.mjs'), '--db-select'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DB_AUTH: 'true', DB_TENANCY: 'false', DB_MIGRATE: 'false', DB_OPS: 'false' } });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  it('control: a scratch tree with exactly the 19 mapped files is valid', () => {
    const r = runIn(tree(FILES));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(tf(TABLE.auth));
  });
  it('a tests/db/*.test.ts in no area -> exit 1', () => {
    const r = runIn(tree([...FILES, 'tests/db/stray.test.ts']));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
  });
  it('a listed file missing from disk -> exit 1', () => {
    const r = runIn(tree(FILES.filter((f) => f !== 'tests/db/checks.test.ts')));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
  });
});

// POLY-141 C25 (ruling addendum 3): the db job's own files trigger it, each selecting all four areas.
describe('C25 the files the db job runs set every area', () => {
  const ALL = ['db_auth', 'db_tenancy', 'db_migrate', 'db_ops'];
  const OWN = ['.github/workflows/ci.yml', 'infra/ci/changes.mjs', 'infra/ci/job-report.mjs', 'infra/ci/budgets.json',
    'tests/ci/db-filter-imports.test.ts', 'tests/ci/db-areas.test.ts', 'tests/ci/db-harness.test.ts', 'tests/ci/helpers.ts', 'tests/ci/vitest.config.ts'];
  for (const p of OWN) {
    it(`${p} -> db and all four areas  [red if: it is dropped from TABLE.db / DB_SHARED]`, async () => {
      const { classify } = await ch();
      const o = classify([p]);
      expect(o.db, p).toBe(true);
      for (const k of ALL) expect(o[k], `${p} ${k}`).toBe(true);
    });
  }
  for (const p of ['infra/ci/anchor.mjs', 'infra/ci/aggregate.mjs', 'infra/ci/check-pins.mjs', 'infra/ci/check-run-expr.mjs', 'infra/ci/image.sh', 'tests/ci/anchor.test.ts', 'tests/ci/changes.test.ts', '.github/workflows/build.yml']) {
    it(`${p} does not set db (it runs in another job)  [red if: all of infra/ci or tests/ci was added]`, async () => {
      const { classify } = await ch();
      expect(classify([p]).db, p).toBe(false);
    });
  }
  it('every `node infra/ci/*.mjs` call and every preflight test path in the db job selects all four areas  [red if: a new step calls a file outside the set]', async () => {
    const { classify } = await ch();
    const { wf, steps } = await import('./helpers.ts');
    const body = steps(wf('ci.yml').jobs.db!).map((s) => s.run ?? '').join('\n');
    const paths = [
      ...[...body.matchAll(/\bnode\s+(infra\/ci\/[\w.-]+\.mjs)/g)].map((m) => m[1]!),
      ...[...body.matchAll(/(?<![\w/])(tests\/ci\/[\w.-]+\.(?:ts|json))/g)].map((m) => m[1]!),
      ...[...body.matchAll(/\.github\/workflows\/[\w.-]+\.yml/g)].map((m) => m[0]),
    ];
    expect(paths, 'the db job calls infra/ci scripts and the preflight').toEqual(expect.arrayContaining(['infra/ci/changes.mjs', 'infra/ci/job-report.mjs', 'tests/ci/vitest.config.ts', 'tests/ci/db-areas.test.ts']));
    for (const p of new Set(paths)) {
      const o = classify([p]);
      expect(o.db, p).toBe(true);
      for (const k of ALL) expect(o[k], `${p} ${k}`).toBe(true);
    }
    const budgets = body.includes('job-report.mjs') ? ['infra/ci/budgets.json'] : [];
    for (const p of budgets) expect(classify([p]).db_auth, p).toBe(true);
  });
});
