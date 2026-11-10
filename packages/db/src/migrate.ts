// The migration runner (ARCH §6.2). The one module allowed a session-level SET (layers.json sessionSetExempt):
// a dedicated pg client, never pooled, closed in finally, so identity cannot leak across requests.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { DEFAULT_FOLDER, MigrateRefusal, pendingFrom, readJournal, type AppliedRow, type JournalEntry } from './journal.ts';

export const ROLES = [
  'poly_owner', 'poly_migrator', 'poly_app', 'poly_worker', 'poly_authz', 'poly_purge',
  'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal', 'poly_backup',
] as const;

export interface MigrateOptions {
  /** Login as poly_migrator. */
  url: string;
  /** Folder holding meta/_journal.json and the .sql files. Defaults to the package's drizzle/. */
  folder?: string;
}

const LOCK_SQL = `SELECT pg_advisory_lock(hashtextextended('polycarpic:migrate', 0))`;

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
  if (missing.length) throw new MigrateRefusal('roles-missing', `roles missing (apply sql/roles.sql as a superuser): ${missing.join(', ')}`);
}

/** Applies every pending migration in one transaction under an advisory lock. Returns the tags applied. */
export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const folder = opts.folder ?? DEFAULT_FOLDER;
  const journal = readJournal(folder);
  const client = new pg.Client({ connectionString: opts.url });
  await client.connect();
  try {
    await client.query(LOCK_SQL);
    await assertRoles(client);
    await client.query('SET ROLE poly_owner');
    const pending = pendingFrom(journal, await readApplied(client));
    if (pending.length === 0) return [];
    await drizzleMigrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
    const who = await client.query('SELECT current_user AS u');
    if (who.rows[0].u !== 'poly_owner') {
      throw new MigrateRefusal('wrong-role', `migrate returned as ${String(who.rows[0].u)}, not poly_owner`);
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
    await client.query('SET ROLE poly_owner');
    const pending = pendingFrom(journal, await readApplied(client));
    await client.query('ROLLBACK');
    return pending;
  } finally {
    await client.end();
  }
}
