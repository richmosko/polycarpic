import { mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Serialise the cluster-wide part of the bootstrap across vitest workers (POLY-141 R1).
 * `roles.sql` ALTERs cluster-global roles, and two concurrent runs fail with `tuple concurrently updated`.
 * The lock is a directory made with mkdirSync (atomic across processes) inside the per-run directory that globalSetup
 * exports as POLY_TEST_LOCK_DIR. It never runs `fn` unlocked: an unset directory or a timeout throws.
 */
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_MS = 10;

export function withBootstrapLock<T>(fn: () => T): T {
  const dir = process.env.POLY_TEST_LOCK_DIR;
  if (!dir) throw new Error('bootstrap lock: POLY_TEST_LOCK_DIR is not set (globalSetup creates it)');
  const timeout = Number(process.env.POLY_TEST_LOCK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const lock = join(dir, 'bootstrap.lock');
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() - start >= timeout) throw new Error(`bootstrap lock timeout after ${timeout} ms (${lock})`);
      Atomics.wait(sleeper, 0, 0, POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    rmdirSync(lock);
  }
}
