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
    super(`${inner} cannot nest inside ${outer}`);
    this.name = 'NestedContextError';
  }
}
export class NoPrincipalError extends Error {
  constructor(job: string) {
    super(`job ${job} resolved no single principal for the target`);
    this.name = 'NoPrincipalError';
  }
}
export class ContextNotEmptyError extends Error {
  constructor() {
    super('app.user_id is set on a context-free transaction');
    this.name = 'ContextNotEmptyError';
  }
}

const JOB_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const active = new AsyncLocalStorage<Kind>();
const clients = new WeakMap<object, pg.PoolClient>();

/** The raw client behind a Tx, for the BetterAuth routing pool in packages/auth (exported on db/auth only). */
export function clientOf(tx: Tx): pg.PoolClient {
  const c = clients.get(tx);
  if (!c) throw new Error('not a transaction handle from packages/db');
  return c;
}

async function inTransaction<T>(kind: Kind, getPool: () => pg.Pool, setup: (client: pg.PoolClient) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const outer = active.getStore();
  if (outer) throw new NestedContextError(kind, outer);
  const client = await getPool().connect();
  try {
    return await active.run(kind, async () => {
      await client.query('BEGIN');
      try {
        const tx = drizzle(client);
        clients.set(tx, client);
        await setup(client);
        const out = await fn(tx);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  } finally {
    client.release();
  }
}

/** A signed-in request. userId carries the SessionUserId brand (SECURITY A-39). */
export async function withTenant<T>(userId: SessionUserId, sessionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new TypeError('withTenant: userId is not a uuid');
  return inTransaction('withTenant', appPool, async (c) => {
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.session_id', $2, true)`, [userId, sessionId]);
  }, fn);
}

export interface JobTarget {
  entityId: string;
  connectionId?: string | null;
}

/** A system job acting for one target's principal. Never context-free: errors unless exactly one principal resolves. */
export async function withSystem<T>(job: string, target: JobTarget, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!JOB_NAME.test(job)) throw new TypeError(`withSystem: invalid job name ${JSON.stringify(job)}`);
  return inTransaction('withSystem', workerPool, async (c) => {
    const res = await c.query(
      `SELECT principal_user_id FROM app.job_targets($1) WHERE entity_id = $2 AND connection_id IS NOT DISTINCT FROM $3::uuid`,
      [job, target?.entityId, target?.connectionId ?? null],
    );
    const principal = res.rows[0]?.principal_user_id as string | null | undefined;
    if (res.rowCount !== 1 || !principal) throw new NoPrincipalError(job);
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.actor', $2, true)`, [principal, `system:${job}`]);
  }, fn);
}

/** Sign-up and other pre-identity work. Exported to packages/auth alone (db/auth). C-84: asserts first that no identity is set. */
export async function withContextFreeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withContextFreeTx', appPool, async (c) => {
    const res = await c.query(`SELECT coalesce(pg_catalog.current_setting('app.user_id', true), '') AS v`);
    if (res.rows[0].v !== '') throw new ContextNotEmptyError();
  }, fn);
}
