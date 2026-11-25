// The runtime pools. Connection settings are the DATABASE_* names (ruling addendum 1): the user is the role, so a web
// process runs as poly_app and a worker process as poly_worker, each with its own password file. withSystem needs
// poly_worker (app.job_targets), so in any other process it fails closed with a permission error.
// configure() is the seam where an app (or a test holding both roles) passes config down. Nothing outside packages/db sees a pool.
import pg from 'pg';
import { connectionFrom, type Env } from './connection.ts';
import { ExtendedClient } from './extended-client.ts';

// POLY-160 R5: a lost connection must not kill the process. pg-pool removes its own 'error' listener while a client is checked
// out, so each client gets one of its own for its whole life. Nothing is logged here: pg-pool sets `err.client` (it holds the
// password) and pg's `detail` quotes values. The callback gets a pool name, an error type and a SQLSTATE, and nothing else.
export type PoolName = 'app' | 'auth' | 'worker' | 'operator';
export interface LostConnection {
  pool: PoolName;
  type: string;
  code: string | undefined;
}
// A web build may hold its own copy of this module, so the callback lives on globalThis.
const LOST = Symbol.for('poly.db.connectionLost');
type Lost = (e: LostConnection) => void;
const slot = globalThis as unknown as Record<symbol, Lost | undefined>;

/** Registered by each service's main.ts before its first pool; re-exported by db/startup only. */
export function onConnectionLost(fn: Lost): void {
  slot[LOST] = fn;
}

const BOUND_MS = 10_000;
const lastTold = new Map<PoolName, number>();
const told = new WeakSet<object>();

function tell(name: PoolName, client: object, err: unknown): void {
  if (told.has(client)) return;
  told.add(client);
  const now = Date.now();
  const last = lastTold.get(name);
  if (last !== undefined && now - last < BOUND_MS) return;
  lastTold.set(name, now);
  const e = err as { name?: unknown; code?: unknown } | null;
  const type = typeof e?.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'unknown';
  const code = typeof e?.code === 'string' && /^[0-9A-Z_]{2,20}$/.test(e.code) ? e.code : undefined;
  try {
    slot[LOST]?.({ pool: name, type, code });
  } catch {
    // a callback that throws is ignored
  }
}

function survive(name: PoolName, pool: pg.Pool): pg.Pool {
  pool.on('error', () => undefined); // idle: the pool has already removed the client
  pool.on('connect', (c) => {
    c.on('error', (e) => tell(name, c, e)); // the client's whole life, checked out included
  });
  return pool;
}

export interface PoolConfig {
  /** DATABASE_* settings for the tenant / context-free pool (default: process.env). */
  app?: Env;
  /** DATABASE_* settings for the sign-in service's pool (default: process.env). DATABASE_USER must be poly_auth. */
  auth?: Env;
  /** DATABASE_* settings for withSystem's pool (default: process.env). */
  worker?: Env;
  /** DATABASE_* settings for withOperatorTx's pool (default: process.env). DATABASE_USER must be poly_operator. */
  operator?: Env;
  /** Max connections per pool (pg default when unset). */
  max?: number;
}

let config: PoolConfig = {};
let app: pg.Pool | undefined;
let auth: pg.Pool | undefined;
let worker: pg.Pool | undefined;
let operator: pg.Pool | undefined;

/**
 * The operator pool refuses before any connection unless the configured user is poly_operator (POLY-146 R1). This is a seatbelt,
 * not the boundary: the boundary is that no process but the `operator` service holds poly_operator's password.
 */
export class OperatorPoolRefused extends Error {
  constructor() {
    super('the operator pool requires DATABASE_USER=poly_operator');
    this.name = 'OperatorPoolRefused';
  }
}

/** The auth pool refuses before any connection unless the configured user is poly_auth (POLY-152 R1): a seatbelt, not the boundary. */
export class AuthPoolRefused extends Error {
  constructor() {
    super('the auth pool requires DATABASE_USER=poly_auth');
    this.name = 'AuthPoolRefused';
  }
}

export function configure(next: PoolConfig): void {
  config = next;
}

function maxOpt(): { max?: number } {
  return config.max === undefined ? {} : { max: config.max };
}

export function appPool(): pg.Pool {
  return (app ??= survive('app', new pg.Pool({ ...connectionFrom(config.app ?? process.env), Client: ExtendedClient, ...maxOpt() })));
}

export function authPool(): pg.Pool {
  const env = config.auth ?? process.env;
  if (env.DATABASE_USER !== 'poly_auth') throw new AuthPoolRefused();
  if (auth) return auth;
  return (auth = survive('auth', new pg.Pool({ ...connectionFrom(env), Client: ExtendedClient, ...maxOpt() })));
}

export function workerPool(): pg.Pool {
  return (worker ??= survive('worker', new pg.Pool({ ...connectionFrom(config.worker ?? process.env), Client: ExtendedClient, ...maxOpt() })));
}

export function operatorPool(): pg.Pool {
  const env = config.operator ?? process.env;
  if (env.DATABASE_USER !== 'poly_operator') throw new OperatorPoolRefused();
  if (operator) return operator;
  return (operator = survive('operator', new pg.Pool({ ...connectionFrom(env), Client: ExtendedClient, ...maxOpt() })));
}

export async function close(): Promise<void> {
  const open = [app, auth, worker, operator].filter((p): p is pg.Pool => p !== undefined);
  app = auth = worker = operator = undefined;
  config = {};
  await Promise.all(open.map((p) => p.end()));
}
