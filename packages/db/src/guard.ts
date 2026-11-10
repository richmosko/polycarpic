// Startup guard (ARCH §8.1): web and worker refuse to start when the applied schema is behind the image, and
// start when it is ahead (which lets the previous release run on the new schema).
import type pg from 'pg';
import { DEFAULT_FOLDER, readJournal } from './journal.ts';
import { appPool, workerPool } from './pool.ts';

export class SchemaBehindError extends Error {
  constructor(missing: string[]) {
    super(`database schema is behind this image; unapplied: ${missing.join(', ')}. Run migrate.`);
    this.name = 'SchemaBehindError';
  }
}

export async function assertSchemaCurrent(role: 'app' | 'worker', folder: string = DEFAULT_FOLDER): Promise<void> {
  const pool: pg.Pool = role === 'app' ? appPool() : workerPool();
  const journal = readJournal(folder);
  const exists = await pool.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
  const applied = exists.rows[0].ok ? new Set((await pool.query(`SELECT hash FROM drizzle.__drizzle_migrations`)).rows.map((r) => r.hash as string)) : new Set<string>();
  const missing = journal.filter((e) => !applied.has(e.hash)).map((e) => e.tag);
  if (missing.length) throw new SchemaBehindError(missing);
}
