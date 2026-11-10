// Start-up guard: refuse to start when the applied schema is behind the image (ARCH §8.1; POLY-83 ruling R7).
// Importable by apps/web and apps/worker alone (layers.json). The expected version is this image's bundled journal,
// imported as JSON so it ships in every bundle. Hash comparison stays in the runner; this is a read-only prefix test.
// POLY-85 R7: schemaStatus is the one read; the guard and the status/health probe both sit on it.
import journal from '../migrations/meta/_journal.json' with { type: 'json' };
import { appPool, workerPool } from './pool.ts';

export class SchemaBehindError extends Error {
  constructor(detail: string) {
    super(`database schema is behind this image: ${detail}. Run migrate.`);
    this.name = 'SchemaBehindError';
  }
}

export type SchemaState = 'current' | 'ahead' | 'behind' | 'diverged' | 'unreachable';

export interface SchemaStatus {
  state: SchemaState;
  /** The newest journal tag in this image. */
  expected: string;
  /** The newest journal tag the database has applied in order; null when none (or unreachable). */
  applied: string | null;
}

const TAGS = journal.entries.map((e) => e.tag);
const WANT = journal.entries.map((e) => e.when);
const EXPECTED = TAGS[TAGS.length - 1]!;
/** The newest migration tag in this image (the status payload's `expected`). */
export const EXPECTED_TAG = EXPECTED;

/** Why the guard refuses, in the POLY-83 words. Internal: the status payload never carries it. */
const detailOf = new WeakMap<SchemaStatus, string>();

/** web passes nothing (poly_app); the worker passes 'worker' (poly_worker). Never throws: a connection error is `unreachable`. */
export async function schemaStatus(role: 'app' | 'worker' = 'app'): Promise<SchemaStatus> {
  const mk = (state: SchemaState, applied: string | null, detail?: string): SchemaStatus => {
    const s = { state, expected: EXPECTED, applied };
    if (detail) detailOf.set(s, detail);
    return s;
  };
  let client;
  try {
    client = await (role === 'app' ? appPool() : workerPool()).connect();
  } catch {
    return mk('unreachable', null);
  }
  try {
    await client.query('BEGIN READ ONLY');
    const exists = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
    if (!exists.rows[0].ok) return mk('behind', null, 'the migration table does not exist');
    const have = (await client.query(`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows.map((r) => Number(r.created_at));
    await client.query('ROLLBACK');
    const i = WANT.findIndex((w, k) => have[k] !== w);
    if (i === -1) return mk(have.length > WANT.length ? 'ahead' : 'current', EXPECTED);
    const applied = i === 0 ? null : TAGS[i - 1]!;
    if (have.length <= i) return mk('behind', applied, `${TAGS[i]} is not applied`);
    return mk('diverged', applied, `applied migration #${i + 1} is not ${TAGS[i]}`);
  } catch {
    return mk('unreachable', null);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Throws SchemaBehindError; the caller exits non-zero. `ahead` passes: the previous release must run on the newer schema. */
export async function assertSchemaNotBehind(role: 'app' | 'worker' = 'app'): Promise<void> {
  const s = await schemaStatus(role);
  if (s.state === 'unreachable') throw new SchemaBehindError('the database is not reachable');
  if (s.state === 'behind' || s.state === 'diverged') throw new SchemaBehindError(detailOf.get(s) ?? s.state);
}
