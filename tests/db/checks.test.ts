// POLY-83 static checks and guards (ruling R5-R8). Assumed invocation, reconcile in this header only:
//   node --experimental-strip-types packages/db/src/check-migrations-cli.ts <dir>   (the `check-migrations` script of @poly/db)
//   apps/migrate main with arg `check-config`: migrator secret file present + non-empty, connection settings present; 0 / 1
//   @poly/db/startup  assertSchemaNotBehind(): journal `when` list must be a prefix of tracking created_at list (by id)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DB_PKG, must, url } from './helpers/pg';
import { MIGRATE_CLI, REAL_MIGRATIONS, freshDb, migrateCli, writeMigrations } from './helpers/api';

const CHECK = process.env.POLY_DB_CHECK_CLI ?? join(DB_PKG, 'src', 'check-migrations-cli.ts');
const check = (dir: string) => {
  const p = spawnSync('node', ['--experimental-strip-types', CHECK, dir], { encoding: 'utf8' });
  return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
};
const T = (n: string) => `CREATE TABLE public.${n} (id int);\n`;

describe('file check on custom migrations', () => {
  it('comments are stripped: a commented-out RESET ROLE passes', () => {
    expect(check(writeMigrations([{ tag: '0000_a', sql: '-- RESET ROLE;\n/* SET SESSION AUTHORIZATION x; */\n' + T('ta') }])).code).toBe(0);
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
    process.env.DATABASE_URL = url('poly_app', db);
    const g: any = await import('../../packages/db/src/startup.ts');
    return g.assertSchemaNotBehind();
  };
  const migrated = () => {
    const db = freshDb();
    const r = migrateCli(db, REAL_MIGRATIONS);
    expect(r.code, r.err + r.out).toBe(0);
    return db;
  };
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

describe('migrate check-config (R7): migrator secret + connection settings; exit 0 / 1 naming each fault; no connection', () => {
  // Input names are assumptions: POLY_MIGRATOR_PASSWORD_FILE and DATABASE_URL.
  const mk = (over: { omit?: boolean; empty?: boolean; noUrl?: boolean }) => {
    const dir = mkdtempSync(join(tmpdir(), 'poly83-cfg-'));
    const f = join(dir, 'poly_migrator_password');
    if (!over.omit) writeFileSync(f, over.empty ? '' : 'x');
    return { POLY_MIGRATOR_PASSWORD_FILE: f, DATABASE_URL: over.noUrl ? '' : 'postgres://poly_migrator@127.0.0.1:1/none' };
  };
  const run = (env: Record<string, string>) => {
    const p = spawnSync('node', ['--experimental-strip-types', MIGRATE_CLI, 'check-config'], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
  };
  it('0 on a good config, with an unreachable database (it connects nowhere)', () => expect(run(mk({})).code).toBe(0));
  it('1 naming a missing secret file', () => {
    const r = run(mk({ omit: true }));
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/poly_migrator_password|POLY_MIGRATOR_PASSWORD_FILE/);
  });
  it('1 naming an empty secret file', () => {
    const r = run(mk({ empty: true }));
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/poly_migrator_password|empty/i);
  });
  it('1 naming missing connection settings', () => {
    const r = run(mk({ noUrl: true }));
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/DATABASE_URL|connection/i);
  });
});
