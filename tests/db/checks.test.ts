// POLY-83 static checks and guards. Assumed surface (reconcile with backend-lead; names live in this header only):
//   node packages/db/bin/check-migrations.mjs <migrations-dir>   file check + journal `when` ordering; exit 0 / non-zero + message
//   node packages/db/bin/migrate.mjs check-config                reads POLY_SECRETS_DIR + POLY_HOST_ENV, connects nowhere
//   @poly/db  assertSchemaCurrent(migrationsDir)                  the startup guard web and worker call; rejects when behind
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DB_PKG, must, url } from './helpers/pg';
import { freshDb, journalOf, migrateCli, rewrite, setJournal, writeMigrations } from './helpers/api';

const CHECK = process.env.POLY_DB_CHECK_CLI ?? join(DB_PKG, 'bin', 'check-migrations.mjs');
const check = (dir: string) => {
  const p = spawnSync('node', ['--experimental-strip-types', CHECK, dir], { encoding: 'utf8' });
  return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
};
const T = (n: string) => `CREATE TABLE public.${n} (id int);\n`;

describe('file check on custom migrations', () => {
  it('passes plain DDL and a definer file that ends on SET ROLE poly_owner', () => {
    const dir = writeMigrations([
      { tag: '0000_a', sql: T('ta') },
      { tag: '0001_def', sql: 'SET ROLE poly_authz;\nCREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$select 1$$;\nSET ROLE poly_owner;\n' },
    ]);
    expect(check(dir)).toMatchObject({ code: 0 });
  });

  const bad: [string, string, RegExp][] = [
    ['last SET ROLE is a definer owner', 'SET ROLE poly_authz;\n' + T('tx'), /poly_owner|last SET ROLE/i],
    ['SET SESSION AUTHORIZATION', 'SET SESSION AUTHORIZATION poly_owner;\n', /SESSION AUTHORIZATION/i],
    ['RESET ROLE', 'RESET ROLE;\n', /RESET ROLE/i],
    ['SET ROLE to a role outside poly_owner and the definer-owner set', 'SET ROLE poly_app;\nSET ROLE poly_owner;\n', /poly_app|outside|not allowed/i],
    ['SET ROLE to postgres', 'SET ROLE postgres;\nSET ROLE poly_owner;\n', /postgres|outside|not allowed/i],
    ['lower-case / extra whitespace form', 'reset   role ;\n', /RESET ROLE/i],
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
  it('refuses equal and decreasing timestamps naming the offending tags', () => {
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

describe('startup guard: web and worker refuse when the applied schema is behind the image', () => {
  const guard = async (db: string, dir: string) => {
    vi.resetModules();
    process.env.DATABASE_URL = url('poly_app', db);
    const m: any = await import('../../packages/db/src/index.ts');
    try { return await m.assertSchemaCurrent(dir); } finally { await m.close?.(); }
  };
  it('rejects when a journal entry is unapplied; resolves when current; resolves when the database is ahead', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    expect(migrateCli(db, dir).code).toBe(0);
    await expect(guard(db, dir)).resolves.not.toThrow();
    const j = journalOf(dir);
    rewrite(dir, '0001_b', T('tb'));
    j.entries.push({ idx: 1, version: '7', when: j.entries[0].when + 9000, tag: '0001_b', breakpoints: true });
    setJournal(dir, j);
    await expect(guard(db, dir)).rejects.toThrow(/behind|pending|0001_b/i);
    expect(migrateCli(db, dir).code).toBe(0);
    // previous image on the new schema: database ahead of an older journal is allowed
    const older = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    await expect(guard(db, older)).resolves.not.toThrow();
  });
});

describe('migrate check-config (ARCH §8.1): exit 0 good, non-zero naming what is wrong, connects nowhere', () => {
  const mk = (over: { omit?: string; empty?: string; host?: string }) => {
    const dir = mkdtempSync(join(tmpdir(), 'poly83-cfg-'));
    for (const f of ['poly_migrator_password', 'session_secret']) {
      if (f !== over.omit) writeFileSync(join(dir, f), f === over.empty ? '' : 'x');
    }
    const host = join(dir, 'host.env');
    writeFileSync(host, over.host ?? 'POLY_ENV=staging\nTLS_MODE=acme\nPLAID_ENV=sandbox\n');
    return { POLY_SECRETS_DIR: dir, POLY_HOST_ENV: host, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' };
  };
  const run = (env: Record<string, string>) => {
    const p = spawnSync('node', ['--experimental-strip-types', join(DB_PKG, 'bin', 'migrate.mjs'), 'check-config'], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: p.status ?? 127, text: (p.stderr ?? '') + (p.stdout ?? '') };
  };
  it('0 on a good config, with an unreachable database (it connects nowhere)', () => expect(run(mk({})).code).toBe(0));
  it('non-zero naming a missing secret file', () => {
    const r = run(mk({ omit: 'session_secret' }));
    expect(r.code).not.toBe(0); expect(r.code).not.toBe(127); expect(r.text).toMatch(/session_secret/);
  });
  it('non-zero naming an empty secret file', () => {
    const r = run(mk({ empty: 'poly_migrator_password' }));
    expect(r.code).not.toBe(0); expect(r.code).not.toBe(127); expect(r.text).toMatch(/poly_migrator_password/);
  });
  it('non-zero when PLAID_ENV is not sandbox on staging', () => {
    const r = run(mk({ host: 'POLY_ENV=staging\nTLS_MODE=acme\nPLAID_ENV=production\n' }));
    expect(r.code).not.toBe(0); expect(r.code).not.toBe(127); expect(r.text).toMatch(/PLAID_ENV/);
  });
  it('non-zero when TLS_MODE fails the §7.8 cross-check', () => {
    const r = run(mk({ host: 'POLY_ENV=prod\nTLS_MODE=bogus\nPLAID_ENV=production\n' }));
    expect(r.code).not.toBe(0); expect(r.code).not.toBe(127); expect(r.text).toMatch(/TLS_MODE/);
  });
});

void must;
