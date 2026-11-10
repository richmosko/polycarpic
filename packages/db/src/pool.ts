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
}

let config: PoolConfig = {};
let app: pg.Pool | undefined;
let worker: pg.Pool | undefined;

export function configure(next: PoolConfig): void {
  config = next;
}

export function appPool(): pg.Pool {
  return (app ??= new pg.Pool(connectionFrom(config.app ?? process.env)));
}

export function workerPool(): pg.Pool {
  return (worker ??= new pg.Pool(connectionFrom(config.worker ?? process.env)));
}

export async function close(): Promise<void> {
  const open = [app, worker].filter((p): p is pg.Pool => p !== undefined);
  app = worker = undefined;
  config = {};
  await Promise.all(open.map((p) => p.end()));
}
