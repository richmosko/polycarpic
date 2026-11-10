// The one place the harness names packages/db's surface. Names are the contract proposed to backend-lead; when the
// implementation differs, only this file changes. Everything else in tests/db goes through these helpers.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB_PKG, freshName, must, psql, url } from './pg';

export const MIGRATE_CLI = process.env.POLY_DB_MIGRATE_CLI ?? join(DB_PKG, '..', '..', 'apps', 'migrate', 'src', 'main.ts');
export const REAL_MIGRATIONS = process.env.POLY_DB_MIGRATIONS ?? join(DB_PKG, 'migrations');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const BOOTSTRAP = process.env.POLY_DB_BOOTSTRAP ?? join(DB_PKG, 'sql', 'bootstrap.sql');
const LOGIN = ['poly_migrator', 'poly_app', 'poly_worker', 'poly_backup'];

/** Fresh database + the superuser bootstrap run inside it (ruling R1; it sets the DB owner). Passwords are the harness's. */
export function freshDb(): string {
  const db = freshName();
  must(`CREATE DATABASE ${db}`);
  must(readFileSync(BOOTSTRAP, 'utf8'), db);
  for (const r of LOGIN) must(`ALTER ROLE ${r} PASSWORD 'qa-${r}'`);
  return db;
}

export type Mig = { tag: string; sql: string; when?: number };

/** A drizzle-format migration folder: meta/_journal.json + <tag>.sql. `when` defaults to strictly increasing. */
export function writeMigrations(migs: Mig[], dir = mkdtempSync(join(tmpdir(), 'poly83-mig-'))): string {
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const base = 1_700_000_000_000;
  const entries = migs.map((m, i) => ({ idx: i, version: '7', when: m.when ?? base + i * 1000, tag: m.tag, breakpoints: true }));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2));
  for (const m of migs) writeFileSync(join(dir, `${m.tag}.sql`), m.sql);
  return dir;
}
export const rewrite = (dir: string, tag: string, sql: string) => writeFileSync(join(dir, `${tag}.sql`), sql);
export const journalOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'));
export const setJournal = (dir: string, j: unknown) => writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(j, null, 2));

export type Run = { code: number; out: string; err: string };
/** Invoke the migrate CLI the way the deploy script does: `migrate [--plan|check-config|<none>]`, poly_migrator URL in env. */
export function migrateCli(db: string, dir: string, args: string[] = [], env: Record<string, string> = {}): Run {
  const p = spawnSync('node', ['--experimental-strip-types', MIGRATE_CLI, ...args], {
    encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, DATABASE_URL: url('poly_migrator', db), POLY_MIGRATIONS_DIR: dir, ...env },
  });
  return { code: p.status ?? 127, out: p.stdout ?? '', err: p.stderr ?? '' };
}

export const applied = (db: string) =>
  must(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`, db).rows;
export const tableExists = (db: string, t: string) =>
  must(`SELECT to_regclass('${t}') IS NOT NULL`, db).rows[0][0] === 't';
export { psql };
