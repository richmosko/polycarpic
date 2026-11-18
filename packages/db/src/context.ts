// The only connection path (ARCH §3.3): context is per transaction, never per session. withTenant, withSystem,
// withContextFreeTx and withOperatorTx refuse to nest inside one another, so a query never runs under two identities.
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, NodePgTransaction, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDialect } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { appPool, authPool, operatorPool, workerPool } from './pool.ts';
import { enterNewUserOn } from './new-user.ts';
import type { SessionUserId } from './session.ts';

export type Tx = NodePgDatabase;
/** The handle withContextFreeTx passes: the one transaction kind that can enter a user it just inserted (R4). */
export type ContextFreeTx = Tx & { enterNewUser(id: string): Promise<void> };
type Kind = 'withTenant' | 'withSession' | 'withSystem' | 'withContextFreeTx' | 'withOperatorTx' | 'withAuthSession' | 'withSignInTx';

export class NestedContextError extends Error {
  constructor(inner: Kind, outer: Kind) {
    super(`${inner} cannot nest inside ${outer}`);
    this.name = 'NestedContextError';
  }
}
/** app.enter_session refused the handle (42501, one message for every case): no live session. */
export class NoLiveSession extends Error {
  constructor() {
    super('no live session');
    this.name = 'NoLiveSession';
  }
}
/** What app.enter_session returns for the live session, camelCased (POLY-153 R4, R7.1). */
export interface SessionShell {
  userId: string;
  sessionId: string;
  name: string | null;
  image: string | null;
  expiresAt: Date;
}
export class NoPrincipalError extends Error {
  constructor(job: string) {
    super(`job ${job} resolved no single principal for the target`);
    this.name = 'NoPrincipalError';
  }
}
export class ContextNotEmptyError extends Error {
  constructor() {
    super('an identity is already in context on a context-free transaction');
    this.name = 'ContextNotEmptyError';
  }
}

export class IdentityMarkerLost extends Error {
  constructor() {
    super('IdentityMarkerLost: the transaction that carried the identity marker has ended');
    this.name = 'IdentityMarkerLost';
  }
}

export class TransactionAborted extends Error {
  constructor() {
    super('TransactionAborted: the transaction was aborted and rolled back, COMMIT reported ROLLBACK');
    this.name = 'TransactionAborted';
  }
}
export class TransactionEnded extends Error {
  constructor() {
    super('TransactionEnded: the transaction this context belongs to has ended');
    this.name = 'TransactionEnded';
  }
}

/** The opaque handle BetterAuth's routing pool uses: query only, never release (seceng S5). */
export interface AuthClient {
  query: pg.PoolClient['query'];
}
export class NewUserStepRefused extends Error {
  constructor(why: string) {
    super(`NewUserStepRefused: ${why}`);
    this.name = 'NewUserStepRefused';
  }
}
export class TransactionClosed extends Error {
  constructor() {
    super('TransactionClosed: the transaction this client belongs to has closed');
    this.name = 'TransactionClosed';
  }
}
interface Store {
  kind: Kind;
  client: pg.PoolClient;
  live: boolean;
  /** One stable handle per transaction; it refuses queries once the transaction has ended (S3). */
  handle: AuthClient;
  tx?: Tx;
  /** The xid text the identity definer returned (R3); set by a wrapper whose setup writes a marker. */
  marked?: string;
}

/** seceng N1: a definer result that is not a string (a renamed column) must fail the request, never skip S6's pre-COMMIT check. */
function markedOf(v: unknown): string {
  if (typeof v !== 'string') throw new IdentityMarkerLost();
  return v;
}

const JOB_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const active = new AsyncLocalStorage<Store>();
const clients = new WeakMap<object, pg.PoolClient>();

/**
 * The transaction this async context runs in, for the routing pool (db/auth). Null outside any transaction. A store whose
 * transaction has ended throws TransactionEnded: a late task must never fall through to the plain pool (S3).
 */
export function currentClient(): { kind: Kind; client: AuthClient } | null {
  const store = active.getStore();
  if (!store) return null;
  if (!store.live) throw new TransactionEnded();
  return { kind: store.kind, client: store.handle };
}

/** The drizzle handle of the transaction this async context runs in, for hooks that call tenancy code inside it (db/auth). */
export function currentTx(): Tx | null {
  const store = active.getStore();
  if (!store) return null;
  if (!store.live) throw new TransactionEnded();
  return store.tx ?? null;
}

/** The raw client behind a Tx, for the BetterAuth routing pool in packages/auth (exported on db/auth only). */
export function clientOf(tx: Tx): pg.PoolClient {
  const c = clients.get(tx);
  if (!c) throw new Error('not a transaction handle from packages/db');
  return c;
}

async function inTransaction<T>(kind: Kind, getPool: () => pg.Pool, setup: (client: pg.PoolClient, store: Store) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const outer = active.getStore();
  if (outer?.live) throw new NestedContextError(kind, outer.kind);
  const client = await getPool().connect();
  const store: Store = {
    kind,
    client,
    live: true,
    handle: {
      query: (async (...args: unknown[]) => {
        if (!store.live) throw new TransactionClosed();
        return (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
      }) as AuthClient['query'],
    },
  };
  let broken = false;
  try {
    return await active.run(store, async () => {
      await client.query('BEGIN');
      try {
        // A NodePgTransaction, not drizzle(client): the database object's transaction() issues its own BEGIN and, on a throw, a
        // ROLLBACK of the whole real transaction, which would end the marked transaction. The transaction object's is a savepoint.
        const s = drizzle(client)._.session as unknown as ConstructorParameters<typeof NodePgTransaction>[1] & { dialect: PgDialect; schema: undefined };
        const tx = new NodePgTransaction(s.dialect, s, s.schema) as unknown as Tx;
        if (kind === 'withContextFreeTx') {
          let used = false;
          Object.defineProperty(tx, 'enterNewUser', {
            enumerable: false,
            value: async (id: string): Promise<void> => {
              if (!store.live) throw new TransactionClosed();
              if (used) throw new NewUserStepRefused('the step runs once per transaction');
              used = true;
              await enterNewUserOn(client, id);
            },
          });
        }
        clients.set(tx, client);
        store.tx = tx;
        // The first statement after the real BEGIN is the whole identity step (guard ii): nothing is sent between the two,
        // so the marker exists before fn can open a savepoint.
        await setup(client, store);
        const out = await fn(tx);
        if (store.marked !== undefined) {
          // S6: a whole-statement COMMIT inside fn would have ended the marked transaction; the xid then differs or is unassigned.
          const x = await client.query('SELECT pg_catalog.pg_current_xact_id_if_assigned()::pg_catalog.text AS x');
          if (x.rows[0]?.x !== store.marked) throw new IdentityMarkerLost();
        }
        const done = await client.query('COMMIT');
        // COMMIT on an aborted transaction succeeds as a statement and rolls back; node-pg reports the command (S2)
        if (done.command !== 'COMMIT') throw new TransactionAborted();
        return out;
      } catch (e) {
        // a backend that cannot roll back is destroyed, not returned to the pool
        await client.query('ROLLBACK').catch(() => { broken = true; });
        throw e;
      }
    });
  } finally {
    store.live = false;
    client.release(broken ? new Error('rollback failed') : undefined);
  }
}

/** A signed-in request. userId carries the SessionUserId brand (SECURITY A-39). */
export async function withTenant<T>(userId: SessionUserId, sessionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new TypeError('withTenant: userId is not a uuid');
  if (!UUID.test(sessionId)) throw new TypeError('withTenant: sessionId is not a uuid');
  return inTransaction('withTenant', appPool, async (c, store) => {
    // The canonical text, byte for byte (R2's exact-call check); the result column is read by its default name.
    const res = await c.query('SELECT app.enter_asserted_user($1, $2)', [userId, sessionId]);
    store.marked = markedOf(res.rows[0]?.enter_asserted_user);
  }, fn);
}

/**
 * A signed-in web request (POLY-153 R7.1): the cookie's plain handle goes to app.enter_session, which hashes it and writes the marker.
 * The setup is that one statement; the row is the shell fn receives. A refusal is NoLiveSession.
 */
export async function withSession<T>(handle: string, fn: (tx: Tx, shell: SessionShell) => Promise<T>): Promise<T> {
  if (typeof handle !== 'string') throw new TypeError('withSession: handle is required');
  let shell: SessionShell | undefined;
  return inTransaction('withSession', appPool, async (c, store) => {
    let res: pg.QueryResult;
    try {
      // The canonical text, byte for byte (R4's exact-call check).
      res = await c.query('SELECT * FROM app.enter_session($1)', [handle]);
    } catch (e) {
      if ((e as { code?: string }).code === '42501') throw new NoLiveSession();
      throw e;
    }
    const row = res.rows[0] as { xid?: unknown; user_id: string; session_id: string; name: string | null; image: string | null; expires_at: Date | string } | undefined;
    store.marked = markedOf(row?.xid);
    shell = { userId: row!.user_id, sessionId: row!.session_id, name: row!.name, image: row!.image, expiresAt: new Date(row!.expires_at) };
  }, (tx) => fn(tx, shell!));
}

/**
 * A signed-in request to the sign-in service (POLY-152 R5). The marker is written from a live session row by app.enter_auth_session;
 * poly_auth never names a user. Exported on db/auth only. The routing pool treats it as withTenant.
 */
export async function withAuthSession<T>(token: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('withAuthSession: token is required');
  return inTransaction('withAuthSession', authPool, async (c, store) => {
    const res = await c.query('SELECT app.enter_auth_session($1)', [token]);
    store.marked = markedOf(res.rows[0]?.enter_auth_session);
  }, fn);
}

/**
 * A context-free transaction for the paths that create a session (POLY-152 R9): no marker, poly_auth. Every row the request writes
 * commits or rolls back together. Exported on db/auth only.
 */
export async function withSignInTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withSignInTx', authPool, async (c) => {
    const res = await c.query('SELECT app.current_user_id() IS NULL AS ok');
    if (res.rows[0].ok !== true) throw new ContextNotEmptyError();
  }, fn);
}

export interface JobTarget {
  entityId: string;
  connectionId?: string | null;
}

/** A system job acting for one target's principal. Never context-free: errors unless exactly one principal resolves. */
export async function withSystem<T>(job: string, target: JobTarget, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!JOB_NAME.test(job)) throw new TypeError(`withSystem: invalid job name ${JSON.stringify(job)}`);
  return inTransaction('withSystem', workerPool, async (c, store) => {
    try {
      const res = await c.query('SELECT app.enter_job($1, $2, $3)', [job, target?.entityId, target?.connectionId ?? null]);
      store.marked = markedOf(res.rows[0]?.enter_job);
    } catch (e) {
      if ((e as { code?: string }).code === 'P0002') throw new NoPrincipalError(job);
      throw e;
    }
  }, fn);
}

/** Sign-up and other pre-identity work. Exported to packages/auth alone (db/auth). C-84: asserts first that no identity is set. */
export async function withContextFreeTx<T>(fn: (tx: ContextFreeTx) => Promise<T>): Promise<T> {
  return inTransaction('withContextFreeTx', authPool, async (c) => {
    const res = await c.query('SELECT app.current_user_id() IS NULL AS ok');
    if (res.rows[0].ok !== true) throw new ContextNotEmptyError();
  }, fn as (tx: Tx) => Promise<T>);
}

/**
 * The operator's CLI transaction (POLY-142 R3; SECURITY C-84): the operator pool (poly_operator), no user (it cannot write a marker: no enter_* grant), and only app.actor set. The actor is for
 * the database's own logs: issue_operator_invitation writes its own literal. Exported on db/operator alone, to one caller.
 */
export async function withOperatorTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('withOperatorTx', operatorPool, async (c) => {
    await c.query(`SELECT set_config('app.actor', 'operator:cli', true)`);
  }, fn);
}
