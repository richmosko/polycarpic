// Start-up guard: refuse to start when the applied schema is behind the image (ARCH §8.1; POLY-83 ruling R7).
// Importable by apps/web and apps/worker alone (layers.json). The expected version is this image's bundled journal,
// imported as JSON so it ships in every bundle. Hash comparison stays in the runner; this is a read-only prefix test.
import journal from '../migrations/meta/_journal.json' with { type: 'json' };
import { appPool, workerPool } from './pool.ts';

export class SchemaBehindError extends Error {
  constructor(detail: string) {
    super(`database schema is behind this image: ${detail}. Run migrate.`);
    this.name = 'SchemaBehindError';
  }
}

/** web passes nothing (poly_app); the worker passes 'worker' (poly_worker). Throws SchemaBehindError; the caller exits non-zero. */
export async function assertSchemaNotBehind(role: 'app' | 'worker' = 'app'): Promise<void> {
  const want = journal.entries.map((e) => e.when);
  const client = await (role === 'app' ? appPool() : workerPool()).connect();
  try {
    await client.query('BEGIN READ ONLY');
    const exists = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
    if (!exists.rows[0].ok) throw new SchemaBehindError('the migration table does not exist');
    const have = (await client.query(`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows.map((r) => Number(r.created_at));
    await client.query('ROLLBACK');
    const i = want.findIndex((w, k) => have[k] !== w);
    if (i !== -1) {
      throw new SchemaBehindError(have.length <= i ? `${journal.entries[i]!.tag} is not applied` : `applied migration #${i + 1} is not ${journal.entries[i]!.tag}`);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
