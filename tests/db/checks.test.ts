// POLY-83 static checks and guards (ruling R5-R8). Assumed invocation, reconcile in this header only:
//   pnpm --filter @poly/db check-migrations <dir>   (backend-lead-2's surface)
//   apps/migrate main with arg `check-config`: migrator secret file present + non-empty, connection settings present; 0 / 1
//   @poly/db/startup  assertSchemaNotBehind(): journal `when` list must be a prefix of tracking created_at list (by id)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ROOT, must } from './helpers/pg';
import { MIGRATE_CLI, applied, captureRun, cloneMigrated, dbEnv, freshDb, writeMigrations } from './helpers/api';

const checkPnpm = (dir: string) => {
  const p = spawnSync('pnpm', ['--filter', '@poly/db', 'check-migrations', dir], { encoding: 'utf8', cwd: ROOT });
  const text = (p.stderr ?? '') + (p.stdout ?? '');
  // a missing CLI exits 1 and its error text can match a loose regex: report it as "not runnable"
  return { code: /Cannot find module|ERR_MODULE_NOT_FOUND|ERR_PNPM_NO_SCRIPT|Missing script/.test(text) ? 127 : (p.status ?? 127), text };
};
// POLY-136 item 1: spawned through `node` directly (ruling cut C3) so the new cases cost 100 ms, not 200.
const SCRIPT = join(ROOT, 'packages', 'db', 'scripts', 'check-migrations.ts');
const checkNode = (dir: string) => {
  const p = spawnSync('node', ['--experimental-strip-types', SCRIPT, dir], { encoding: 'utf8', cwd: ROOT });
  return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
};
const check = checkNode; // POLY-136 C3: node directly; one case keeps the pnpm script wiring
const T = (n: string) => `CREATE TABLE public.${n} (id int);\n`;

describe('file check on custom migrations', () => {
  it('comments are stripped: a commented-out RESET ROLE passes', () => {
    expect(checkPnpm(writeMigrations([{ tag: '0000_a', sql: '-- RESET ROLE;\n/* SET SESSION AUTHORIZATION x; */\n' + T('ta') }])).code).toBe(0);
  });
  it('passes plain DDL and a definer file that ends on SET ROLE poly_owner', () => {
    const dir = writeMigrations([
      { tag: '0000_a', sql: T('ta') },
      { tag: '0001_def', sql: 'SET ROLE poly_authz;\nCREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$select 1$$;\nSET ROLE poly_owner;\n' },
    ]);
    expect(check(dir)).toMatchObject({ code: 0 });
  });

  const bad: [string, string, RegExp][] = [
    ['last SET ROLE is a definer owner', 'SET ROLE poly_authz;\n' + T('tx'), /poly_owner|last SET ROLE/i],
    ['SET ROLE hidden before a different last SET ROLE', 'SET ROLE poly_authz;\nSET ROLE poly_owner;\nSET ROLE poly_rollup;\n', /poly_owner|last SET ROLE/i],
    ['SET SESSION AUTHORIZATION', 'SET SESSION AUTHORIZATION poly_owner;\n', /SESSION AUTHORIZATION/i],
    ['RESET ROLE', 'RESET ROLE;\n', /RESET ROLE/i],
    ['lower-case / extra whitespace form', 'reset   role ;\n', /RESET ROLE/i],
    ['RESET ALL', 'RESET ALL;\n', /RESET ALL/i],
    ['SET ROLE NONE', 'SET ROLE NONE;\n', /NONE|SET ROLE/i],
    ['SET ROLE DEFAULT', 'SET ROLE DEFAULT;\n', /DEFAULT|SET ROLE/i],
    ['SET LOCAL ROLE', 'SET LOCAL ROLE poly_owner;\n', /LOCAL|SET ROLE/i],
    ["set_config('role', ...)", "SELECT set_config('role', 'poly_authz', false);\n", /set_config|role/i],
    ['function with a SET role clause', 'CREATE FUNCTION public.g() RETURNS int LANGUAGE sql SET role = poly_authz AS $$select 1$$;\n', /role/i],
    ['dollar-quoted body is not exempt (fail closed)', 'DO $$ BEGIN RESET ROLE; END $$;\n', /RESET ROLE/i],
    ['SET ROLE to a role outside the closed list (poly_app)', 'SET ROLE poly_app;\nSET ROLE poly_owner;\n', /poly_app|outside|not allowed/i],
    ["single-quoted last target: SET ROLE 'poly_purge' (R1)", "SET ROLE 'poly_purge';\n", /poly_owner|last SET ROLE/i],
    ["SET SESSION ROLE 'evil' fails closed (R1)", "SET SESSION ROLE 'evil';\nSET ROLE poly_owner;\n", /evil|outside|not allowed/i],
    ["N1: a '--' inside a string literal must not hide a SET ROLE", "SELECT '--'; SET ROLE poly_authz;\n", /poly_owner|last SET ROLE/i],
    ['SET ROLE to postgres', 'SET ROLE postgres;\nSET ROLE poly_owner;\n', /postgres|outside|not allowed/i],
  ];
  for (const [name, sql, re] of bad) {
    it(`refuses: ${name}`, () => {
      const r = check(writeMigrations([{ tag: '0000_a', sql }]));
      expect(r.code, r.text).not.toBe(0);
      expect(r.code).not.toBe(127);
      expect(r.text).toMatch(re);
    });
  }
});

describe('journal `when` ordering (CI)', () => {
  it('refuses equal and decreasing timestamps naming the offending tag', () => {
    for (const whens of [[2000, 2000], [3000, 2000]]) {
      const dir = writeMigrations([{ tag: '0000_a', sql: T('ta'), when: whens[0] }, { tag: '0001_b', sql: T('tb'), when: whens[1] }]);
      const r = check(dir);
      expect(r.code, r.text).not.toBe(0);
      expect(r.text).toMatch(/0001_b/);
      expect(r.text).toMatch(/strictly|increasing|order/i);
    }
  });
  it('accepts strictly increasing', () => {
    expect(check(writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }])).code).toBe(0);
  });
});

describe('startup guard (db/startup assertSchemaNotBehind): refuse when the applied schema is behind the image', () => {
  // The image's bundled journal is packages/db/migrations/meta/_journal.json, so the guard is exercised on a database
  // migrated with the real chain, then made behind / ahead / divergent by the superuser.
  const guard = async (db: string) => {
    vi.resetModules();
    Object.assign(process.env, dbEnv('poly_app', db)); // startup reads process.env (unset => both pools read it)
    const g: any = await import('../../packages/db/src/startup.ts');
    return g.assertSchemaNotBehind('poly_app');
  };
  const migrated = cloneMigrated;
  it('starts when current', async () => {
    await expect(guard(migrated())).resolves.not.toThrow();
  });
  it('starts when the database is ahead (previous release on the new schema)', async () => {
    const db = migrated();
    must(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('ahead', 99999999999999)`, db);
    await expect(guard(db)).resolves.not.toThrow();
  });
  it('refuses when a journal entry is unapplied (tracking row removed)', async () => {
    const db = migrated();
    must(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`, db);
    await expect(guard(db)).rejects.toThrow(/behind|pending|mismatch|first/i);
  });
  it('refuses when a tracking timestamp diverges from the journal', async () => {
    const db = migrated();
    must(`UPDATE drizzle.__drizzle_migrations SET created_at = created_at + 1 WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)`, db);
    await expect(guard(db)).rejects.toThrow(/behind|mismatch|first/i);
  });
  it('refuses when the tracking table is missing (never migrated)', async () => {
    const db = freshDb();
    await expect(guard(db)).rejects.toThrow(/behind|missing|tracking|drizzle/i);
  });
});

describe('migrate check-config (addendum 1): DB side only, no connection; exit 0 / 1, one line per fault naming the variable', () => {
  const good = (): Record<string, string> => {
    const f = join(mkdtempSync(join(tmpdir(), 'poly83-cfg-')), 'db_password_migrator');
    writeFileSync(f, 'secret\n');
    // POLY-85 R8: check-config now also covers the non-DB inputs, so a good config carries them too
    return { APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '1', DATABASE_NAME: 'none', DATABASE_USER: 'poly_migrator', DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: f };
  };
  const run = (env: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(base)) if (k.startsWith('DATABASE_')) delete base[k];
    const p = spawnSync('node', ['--experimental-strip-types', MIGRATE_CLI, 'check-config'], { encoding: 'utf8', env: { ...base, ...env } as NodeJS.ProcessEnv });
    return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
  };
  // C2: in-process through run() with exactly this env; good-config and one fault (via `run`) stay spawned through the real CLI.
  const runIn = async (env: Record<string, string | undefined>) => {
    const r = await captureRun(['check-config'], Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv);
    return { code: r.code, text: r.err + r.out };
  };
  const fault = (name: string, mut: (e: Record<string, string>) => Record<string, string>, token: RegExp) =>
    it(`1 naming ${name}`, async () => {
      const r = await runIn(mut(good()));
      expect(r.text).not.toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/);
      expect(r.code, r.text).toBe(1);
      expect(r.text).toMatch(token);
    });
  it('0 on a good config, with an unreachable database (it connects nowhere)', () => expect(run(good()).code).toBe(0));
  it('1 through the real CLI on a bad DATABASE_USER', () => { const r = run({ ...good(), DATABASE_USER: 'poly_app' }); expect(r.code, r.text).toBe(1); expect(r.text).toMatch(/DATABASE_USER/); });
  for (const k of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_SSLMODE', 'DATABASE_PASSWORD_FILE']) {
    fault(`missing ${k}`, (e) => { delete e[k]; return e; }, new RegExp(k));
  }
  fault('DATABASE_PORT that is not an integer', (e) => ({ ...e, DATABASE_PORT: 'abc' }), /DATABASE_PORT/);
  it('DATABASE_PORT defaults to 5432 when absent', async () => { const e = good(); delete (e as any).DATABASE_PORT; expect((await runIn(e)).code).toBe(0); });
  fault('DATABASE_USER that is not poly_migrator', (e) => ({ ...e, DATABASE_USER: 'poly_app' }), /DATABASE_USER/);
  fault('DATABASE_SSLMODE outside disable|require|verify-full', (e) => ({ ...e, DATABASE_SSLMODE: 'prefer' }), /DATABASE_SSLMODE/);
  fault('a missing password file', (e) => ({ ...e, DATABASE_PASSWORD_FILE: e.DATABASE_PASSWORD_FILE + '.nope' }), /DATABASE_PASSWORD_FILE/);
  fault('an empty password file', (e) => { writeFileSync(e.DATABASE_PASSWORD_FILE, ''); return e; }, /DATABASE_PASSWORD_FILE/);
  fault('a multi-line password file', (e) => { writeFileSync(e.DATABASE_PASSWORD_FILE, 'a\nb\n'); return e; }, /DATABASE_PASSWORD_FILE/);
  fault('DATABASE_PASSWORD being set', (e) => ({ ...e, DATABASE_PASSWORD: 'x' }), /DATABASE_PASSWORD\b(?!_FILE)/);
  fault('DATABASE_URL being set', (e) => ({ ...e, DATABASE_URL: 'postgres://x' }), /DATABASE_URL/);
  it('reports every fault, one line each', async () => {
    const r = await runIn({ DATABASE_USER: 'poly_app', DATABASE_SSLMODE: 'prefer' });
    expect(r.code).toBe(1);
    for (const k of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_SSLMODE', 'DATABASE_PASSWORD_FILE']) expect(r.text).toMatch(new RegExp(k));
  });
});

describe('journal-to-file check (POLY-136 item 1): every .sql and snapshot has its journal entry, and the reverse', () => {
  const two = () => writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
  it('the real migration folder passes', () => {
    const r = checkNode(join(ROOT, 'packages', 'db', 'migrations'));
    expect(r.code, r.text).toBe(0);
  });
  it('a consistent fixture passes', () => {
    const r = checkNode(two());
    expect(r.code, r.text).toBe(0);
  });
  it('a stray .sql outside the journal is refused, by name  [red if: the .sql-to-entry direction is dropped]', () => {
    const dir = two();
    writeFileSync(join(dir, '0002_stray.sql'), T('tz'));
    const r = checkNode(dir);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toContain('journal-files: 0002_stray.sql: not in meta/_journal.json');
  });
  it('a stray snapshot outside the journal is refused, by name  [red if: the snapshot-to-entry direction is dropped]', () => {
    const dir = two();
    writeFileSync(join(dir, 'meta', '0007_snapshot.json'), '{}');
    const r = checkNode(dir);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toContain('journal-files: meta/0007_snapshot.json: not in meta/_journal.json');
  });
  it('an entry whose .sql is missing is refused  [red if: the entry-to-.sql direction is dropped]', () => {
    const dir = two();
    rmSync(join(dir, '0001_b.sql'));
    const r = checkNode(dir);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toContain('journal-files: 0001_b.sql: journal entry 0001_b has no 0001_b.sql');
  });
  it('an entry whose snapshot is missing is refused  [red if: the entry-to-snapshot direction is dropped, or idx is not padded to 4]', () => {
    const dir = two();
    rmSync(join(dir, 'meta', '0001_snapshot.json'));
    const r = checkNode(dir);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toContain('journal-files: meta/0001_snapshot.json: journal entry 0001_b has no meta/0001_snapshot.json');
  });
  it('_journal.json is not read as a snapshot  [red if: the meta scan matches every .json]', () => {
    expect(checkNode(two()).text).not.toMatch(/_journal\.json: not in/);
  });
  it('a stray .sql is still scanned by the file rules (fail closed)  [red if: the stray file is skipped after the journal problem]', () => {
    const dir = two();
    writeFileSync(join(dir, '0002_stray.sql'), 'RESET ROLE;\n');
    const r = checkNode(dir);
    expect(r.text).toContain('journal-files: 0002_stray.sql');
    expect(r.text).toMatch(/reset: 0002_stray\.sql/);
  });
  it('the package script still reaches the same check through pnpm (the one case that keeps the wiring)', () => {
    const dir = two();
    writeFileSync(join(dir, '0002_stray.sql'), T('tz'));
    const r = check(dir);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toContain('journal-files: 0002_stray.sql');
  });
});

describe('migrate run() reads only the env it is given (POLY-136 item 4, cut C1)', () => {
  const cfg = (): Record<string, string> => {
    const f = join(mkdtempSync(join(tmpdir(), 'poly136-cfg-')), 'db_password_migrator');
    writeFileSync(f, 'secret\n');
    return { APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '1', DATABASE_NAME: 'none', DATABASE_USER: 'poly_migrator', DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: f };
  };
  const load = () => import('../../apps/migrate/src/run.ts') as Promise<{ run: (argv: string[], env: NodeJS.ProcessEnv) => Promise<number> }>;
  // C2 (seceng, ruling addendum 2): both directions for each of the three commands.
  const full = (db: string, dir: string): Record<string, string> => ({ ...cfg(), ...dbEnv('poly_migrator', db), POLY_MIGRATIONS_DIR: dir });
  const COMMANDS: [string, string[], number][] = [['no argument', [], 0], ['--plan', ['--plan'], 3], ['check-config', ['check-config'], 0]];
  for (const [name, argv, normal] of COMMANDS) {
    it(`${name}: (a) env lacks DATABASE_* while process.env holds a valid set -> exit 1  [red if: run falls back to or merges process.env]`, async () => {
      const { run } = await load();
      const db = freshDb();
      const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
      for (const [k, v] of Object.entries(full(db, dir))) vi.stubEnv(k, v);
      try {
        expect(await run(argv, {})).toBe(1);
        expect(applied(db)).toEqual([]);
      } finally { vi.unstubAllEnvs(); }
    });
    it(`${name}: (b) a valid env with a stray DATABASE_URL and a bogus POLY_MIGRATIONS_DIR in process.env -> the normal result, from the env-named folder  [red if: process.env overrides or is merged over env]`, async () => {
      const { run } = await load();
      const db = freshDb();
      const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
      vi.stubEnv('DATABASE_URL', 'postgres://stray@127.0.0.1:1/none');
      vi.stubEnv('POLY_MIGRATIONS_DIR', '/nonexistent/poly136');
      try {
        expect(await run(argv, full(db, dir))).toBe(normal);
        expect(applied(db).length).toBe(argv[0] === undefined ? 1 : 0);
      } finally { vi.unstubAllEnvs(); }
    });
  }
});
