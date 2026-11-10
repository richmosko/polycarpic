// The two runtime pools: poly_app (web, BetterAuth) and poly_worker (jobs). Created lazily from configure() or the
// environment; POLY-85's runtime config replaces the environment fallback. Nothing outside packages/db sees a pool.
import pg from 'pg';

export interface PoolConfig {
  appUrl?: string;
  workerUrl?: string;
}

let config: PoolConfig = {};
let app: pg.Pool | undefined;
let worker: pg.Pool | undefined;

export function configure(next: PoolConfig): void {
  config = next;
}

export function appPool(): pg.Pool {
  const url = config.appUrl ?? process.env.POLY_APP_DATABASE_URL;
  if (!url) throw new Error('poly_app database URL is not configured');
  return (app ??= new pg.Pool({ connectionString: url }));
}

export function workerPool(): pg.Pool {
  const url = config.workerUrl ?? process.env.POLY_WORKER_DATABASE_URL;
  if (!url) throw new Error('poly_worker database URL is not configured');
  return (worker ??= new pg.Pool({ connectionString: url }));
}

export async function closePools(): Promise<void> {
  const open = [app, worker].filter((p): p is pg.Pool => p !== undefined);
  app = worker = undefined;
  config = {};
  await Promise.all(open.map((p) => p.end()));
}
