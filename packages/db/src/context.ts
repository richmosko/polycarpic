// The only connection path (ARCH §3.3): context is per transaction, never per session. withTenant, withSystem and
// withContextFreeTx refuse to nest inside one another, so a query never runs under two identities.
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { appPool, workerPool } from './pool.ts';
import type { SessionUserId } from './session.ts';

export type Tx = NodePgDatabase;
type Kind = 'withTenant' | 'withSystem' | 'withContextFreeTx';

export class NestedContextError extends Error {
  constructor(inner: Kind, outer: Kind) {
    super(`${inner} cannot run inside ${outer}`);
    this.name = 'NestedContextError';
  }
}
export class NoPrincipalError extends Error {
  constructor(job: string) {
    super(`job ${job} resolved no principal for the target`);
    this.name = 'NoPrincipalError';
  }
}
export class ContextNotEmptyError extends Error {
  constructor() {
    super('app.user_id is set on a context-free transaction');
    this.name = 'ContextNotEmptyError';
  }
}

const active = new AsyncLocalStorage<Kind>();
const clients = new WeakMap<object, pg.PoolClient>();

/** The raw client behind a Tx, for the BetterAuth routing pool in packages/auth (via db/auth only). */
export function clientOf(tx: Tx): pg.PoolClient {
  const c = clients.get(tx);
  if (!c) throw new Error('not a transaction handle from packages/db');
  return c;
}

async function inTransaction<T>(kind: Kind, pool: pg.Pool, body: (client: pg.PoolClient) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const outer = active.getStore();
  if (outer) throw new NestedContextError(kind, outer);
  const client = await pool.connect();
  let failed = true;
  try {
    return await active.run(kind, async () => {
      await client.query('BEGIN');
      try {
        const tx = drizzle(client);
        clients.set(tx, client);
        await body(client);
        const out = await fn(tx);
        await client.query('COMMIT');
        failed = false;
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        failed = false;
        throw e;
      }
    });
  } finally {
    client.release(failed ? true : undefined);
  }
}

/** A signed-in request. userId carries the SessionUserId brand (SECURITY A-39). */
export function withTenant<T>(userId: SessionUserId, sessionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withTenant', appPool(), async (c) => {
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.session_id', $2, true)`, [userId, sessionId]);
  }, fn);
}

export interface JobTarget {
  entityId: string;
  connectionId?: string;
}

/** A system job acting for one target's principal. Never context-free: errors when no principal resolves. */
export function withSystem<T>(job: string, target: JobTarget, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withSystem', workerPool(), async (c) => {
    const res = await c.query(
      `SELECT principal_user_id FROM app.job_targets($1)
        WHERE entity_id = $2 AND ($3::uuid IS NULL OR connection_id = $3::uuid) AND principal_user_id IS NOT NULL
        ORDER BY principal_user_id LIMIT 1`,
      [job, target.entityId, target.connectionId ?? null],
    );
    if (res.rowCount === 0) throw new NoPrincipalError(job);
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.actor', $2, true)`, [res.rows[0].principal_user_id, `system:${job}`]);
  }, fn);
}

/** Sign-up and other pre-identity work. Exported to packages/auth alone (db/auth). C-84: asserts first that no identity is set. */
export function withContextFreeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withContextFreeTx', appPool(), async (c) => {
    const res = await c.query(`SELECT coalesce(pg_catalog.current_setting('app.user_id', true), '') AS v`);
    if (res.rows[0].v !== '') throw new ContextNotEmptyError();
  }, fn);
}
