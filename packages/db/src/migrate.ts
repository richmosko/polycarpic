// The migration runner (ARCH §6.2, POLY-83 ruling R6). The one module allowed a session-level SET (layers.json
// sessionSetExempt): a dedicated pg client, never pooled, closed in finally, so identity cannot leak across requests.
// Exported on the restricted subpath db/migrate, importable by apps/migrate alone.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { DEFAULT_FOLDER, MigrateRefusal, pendingFrom, readJournal, type AppliedRow, type JournalEntry } from './journal.ts';

export { MigrateRefusal, type JournalEntry } from './journal.ts';
export { checkConfig, type ConfigProblem } from './migrate-config.ts';

export const ROLES = [
  'poly_owner', 'poly_migrator', 'poly_app', 'poly_worker', 'poly_authz', 'poly_purge',
  'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal', 'poly_backup',
] as const;

export interface MigrateOptions {
  /** Login as poly_migrator. */
  url: string;
  /** Folder holding meta/_journal.json and the .sql files. Defaults to the package's migrations/. */
  folder?: string;
  /** How long to wait for the advisory lock before exiting 4. Defaults to 10 minutes (unmeasured). */
  lockTimeoutMs?: number;
}

const LOCK_SQL = `SELECT pg_advisory_lock(hashtextextended('polycarpic.migrate', 0))`;
const LOCK_TIMEOUT = '55P03';

async function readApplied(client: pg.Client): Promise<AppliedRow[]> {
  const exists = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return [];
  const res = await client.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
  return res.rows.map((r) => ({ hash: r.hash as string, createdAt: Number(r.created_at) }));
}

async function assertRoles(client: pg.Client): Promise<void> {
  const res = await client.query(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [[...ROLES]]);
  const have = new Set(res.rows.map((r) => r.rolname as string));
  const missing = ROLES.filter((r) => !have.has(r));
  if (missing.length) throw new MigrateRefusal('roles-missing', `roles missing (run sql/bootstrap.sql as a superuser): ${missing.join(', ')}`);
}

/** Applies every pending migration in one transaction under an advisory lock. Returns the tags applied. */
export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const folder = opts.folder ?? DEFAULT_FOLDER;
  const journal = readJournal(folder);
  const client = new pg.Client({ connectionString: opts.url });
  await client.connect();
  try {
    await assertRoles(client);
    await client.query('SET ROLE poly_owner');
    await client.query(`SET lock_timeout = ${Math.round(opts.lockTimeoutMs ?? 600_000)}`);
    try {
      await client.query(LOCK_SQL);
    } catch (e) {
      if ((e as { code?: string }).code === LOCK_TIMEOUT) throw new MigrateRefusal('lock-timeout', 'timed out waiting for the migrate advisory lock; nothing applied');
      throw e;
    }
    const pending = pendingFrom(journal, await readApplied(client));
    if (pending.length === 0) return [];
    await drizzleMigrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
    const who = await client.query('SELECT current_user AS u');
    if (who.rows[0].u !== 'poly_owner') {
      throw new MigrateRefusal('wrong-role', `migrate returned as ${String(who.rows[0].u)}, not poly_owner`);
    }
    // drizzle skips a migration silently when its timestamp is not later than the last applied: converge or fail loud.
    const after = await readApplied(client);
    if (after.length !== journal.length || after.some((r, i) => r.hash !== journal[i]!.hash)) {
      throw new MigrateRefusal('not-converged', 'tracking rows do not equal the journal after migrate(); a migration was skipped');
    }
    return pending.map((e) => e.tag);
  } finally {
    await client.end();
  }
}

/** Read-only: the pending files in order. Takes no lock and writes nothing. */
export async function plan(opts: MigrateOptions): Promise<JournalEntry[]> {
  const journal = readJournal(opts.folder ?? DEFAULT_FOLDER);
  const client = new pg.Client({ connectionString: opts.url });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE poly_owner');
    const pending = pendingFrom(journal, await readApplied(client));
    await client.query('ROLLBACK');
    return pending;
  } finally {
    await client.end();
  }
}
