// The runtime pools. Connection settings are the DATABASE_* names (ruling addendum 1): the user is the role, so a web
// process runs as poly_app and a worker process as poly_worker, each with its own password file. withSystem needs
// poly_worker (app.job_targets), so in any other process it fails closed with a permission error.
// configure() lets one process (tests) hold both roles explicitly. Nothing outside packages/db sees a pool.
import fs from 'node:fs';
import pg from 'pg';

type Env = Record<string, string | undefined>;

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

function make(env: Env): pg.Pool {
  for (const k of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD_FILE'] as const) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const mode = env.DATABASE_SSLMODE;
  return new pg.Pool({
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT ?? 5432),
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: fs.readFileSync(env.DATABASE_PASSWORD_FILE!, 'utf8').replace(/\n$/, ''),
    ssl: mode === 'require' ? { rejectUnauthorized: false } : mode === 'verify-full' ? true : false,
  });
}

export function appPool(): pg.Pool {
  return (app ??= make(config.app ?? process.env));
}

export function workerPool(): pg.Pool {
  return (worker ??= make(config.worker ?? process.env));
}

export async function close(): Promise<void> {
  const open = [app, worker].filter((p): p is pg.Pool => p !== undefined);
  app = worker = undefined;
  config = {};
  await Promise.all(open.map((p) => p.end()));
}
