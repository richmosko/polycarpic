// The runtime pools. Connection settings are the DATABASE_* names (ruling addendum 1): the user is the role, so a web
// process runs as poly_app and a worker process as poly_worker, each with its own password file. withSystem needs
// poly_worker (app.job_targets), so in any other process it fails closed with a permission error.
// configure() is the seam where an app (or a test holding both roles) passes config down. Nothing outside packages/db sees a pool.
import pg from 'pg';
import { connectionFrom, type Env } from './connection.ts';

export interface PoolConfig {
  /** DATABASE_* settings for the tenant / context-free pool (default: process.env). */
  app?: Env;
  /** DATABASE_* settings for withSystem's pool (default: process.env). */
  worker?: Env;
  /** DATABASE_* settings for withOperatorTx's pool (default: process.env). DATABASE_USER must be poly_operator. */
  operator?: Env;
  /** Max connections per pool (pg default when unset). */
  max?: number;
}

let config: PoolConfig = {};
let app: pg.Pool | undefined;
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

export function configure(next: PoolConfig): void {
  config = next;
}

function maxOpt(): { max?: number } {
  return config.max === undefined ? {} : { max: config.max };
}

export function appPool(): pg.Pool {
  return (app ??= new pg.Pool({ ...connectionFrom(config.app ?? process.env), ...maxOpt() }));
}

export function workerPool(): pg.Pool {
  return (worker ??= new pg.Pool({ ...connectionFrom(config.worker ?? process.env), ...maxOpt() }));
}

export function operatorPool(): pg.Pool {
  const env = config.operator ?? process.env;
  if (env.DATABASE_USER !== 'poly_operator') throw new OperatorPoolRefused();
  if (operator) return operator;
  return (operator = new pg.Pool({ ...connectionFrom(env), ...maxOpt() }));
}

export async function close(): Promise<void> {
  const open = [app, worker, operator].filter((p): p is pg.Pool => p !== undefined);
  app = worker = operator = undefined;
  config = {};
  await Promise.all(open.map((p) => p.end()));
}
