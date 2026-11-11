// The one place the harness names packages/db's surface. Names are the contract proposed to backend-lead; when the
// implementation differs, only this file changes. Everything else in tests/db goes through these helpers.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inspect } from 'node:util';
import { join } from 'node:path';
import { DB_PKG, freshName, must, psql } from './pg.ts';

export const MIGRATE_CLI = process.env.POLY_DB_MIGRATE_CLI ?? join(DB_PKG, '..', '..', 'apps', 'migrate', 'src', 'cli.ts');
export const REAL_MIGRATIONS = process.env.POLY_DB_MIGRATIONS ?? join(DB_PKG, 'migrations');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const BOOTSTRAP = process.env.POLY_DB_BOOTSTRAP ?? [join(DB_PKG, 'sql', 'roles.sql'), join(DB_PKG, 'sql', 'bootstrap.sql')].find((f) => existsSync(f)) ?? join(DB_PKG, 'sql', 'roles.sql');

/** The DB env contract (ruling addendum 1, review 1): HOST/PORT/NAME/USER/SSLMODE + a password file. No URL env anywhere. */
export function dbEnv(role: string, db: string): Record<string, string> {
  const f = join(mkdtempSync(join(tmpdir(), 'poly83-pw-')), `db_password_${role}`);
  writeFileSync(f, `qa-${role}\n`);
  const s = JSON.parse(process.env.POLY_TEST_SERVER!);
  return { DATABASE_HOST: s.host, DATABASE_PORT: String(s.port), DATABASE_NAME: db, DATABASE_USER: role, DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: f };
}
export const LOGIN = ['poly_migrator', 'poly_app', 'poly_worker', 'poly_backup'];

/** Global setup, once per run: the roles are cluster-global, so their harness passwords are set here and freshDb() never does. */
export function setRolePasswords(): void {
  const db = freshName();
  must(`CREATE DATABASE ${db}`);
  must(readFileSync(BOOTSTRAP, 'utf8'), db); // creates the roles (idempotent)
  must(LOGIN.map((r) => `ALTER ROLE ${r} PASSWORD 'qa-${r}';`).join('\n'), db);
  must(`DROP DATABASE ${db}`);
}

/** Fresh database + the superuser bootstrap run inside it (ruling R1; it sets the DB owner), in one psql session. */
export function freshDb(): string {
  const db = freshName();
  must(`CREATE DATABASE ${db};\n\\connect ${db}\n${readFileSync(BOOTSTRAP, 'utf8')}`);
  return db;
}

let template: string | null = null;
/**
 * A database migrated with the real chain, cloned from a per-file template (built once, on first use) instead of being
 * built again. A clone keeps neither the owner's database ACL nor anything the bootstrap sets at database level, so it is
 * created OWNER poly_owner and the (idempotent) bootstrap runs in it again, in the same psql session.
 */
export function cloneMigrated(): string {
  if (template === null) {
    const t = freshDb();
    const r = migrateCli(t, REAL_MIGRATIONS);
    if (r.code !== 0) throw new Error(`template migrate failed: ${r.err}${r.out}`);
    template = t;
  }
  const db = freshName();
  must(`CREATE DATABASE ${db} TEMPLATE ${template} OWNER poly_owner;\n\\connect ${db}\n${readFileSync(BOOTSTRAP, 'utf8')}`);
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
  // POLY-136: the journal-to-file check wants a snapshot per entry; a stub is enough, nothing reads its content.
  migs.forEach((_, i) => writeFileSync(join(dir, 'meta', `${String(i).padStart(4, '0')}_snapshot.json`), '{}'));
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
    env: { ...process.env, ...dbEnv('poly_migrator', db), POLY_MIGRATIONS_DIR: dir, ...env },
  });
  return { code: p.status ?? 127, out: p.stdout ?? '', err: p.stderr ?? '' };
}

/** Runs `run` (apps/migrate/src/run.ts) in this process with exactly `env`. Captures console and stderr, restored in `finally`. */
export async function captureRun(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  const { run } = await import('../../../apps/migrate/src/run.ts');
  let out = '';
  let err = '';
  const text = (a: unknown[]) => a.map((x) => (typeof x === 'string' ? x : inspect(x))).join(' ') + '\n';
  const saved = { log: console.log, error: console.error, warn: console.warn, write: process.stderr.write };
  console.log = (...a: unknown[]) => { out += text(a); };
  console.error = (...a: unknown[]) => { err += text(a); };
  console.warn = console.error;
  process.stderr.write = ((c: string | Uint8Array) => { err += String(c); return true; }) as typeof process.stderr.write;
  try {
    const code = await run(args, env);
    return { code, out, err };
  } finally {
    console.log = saved.log; console.error = saved.error; console.warn = saved.warn; process.stderr.write = saved.write;
  }
}

/** Same as migrateCli, in this process: no spawn. */
export const migrateRun = (db: string, dir: string, args: string[] = [], env: Record<string, string> = {}): Promise<Run> =>
  captureRun(args, { ...process.env, ...dbEnv('poly_migrator', db), POLY_MIGRATIONS_DIR: dir, ...env });

export const applied = (db: string) =>
  must(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`, db).rows;
export const tableExists = (db: string, t: string) =>
  must(`SELECT to_regclass('${t}') IS NOT NULL`, db).rows[0][0] === 't';
export { psql };
