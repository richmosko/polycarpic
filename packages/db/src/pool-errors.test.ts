// POLY-160c, ruling R5 and S: a lost connection never kills the process, and the callback learns only the pool, the error's name and its SQLSTATE.
// No database: a pool is built without connecting; the idle path is pool.emit('error'), the checked-out path is a client's own 'error'.
// Mutants (V): `survive` removed from one pool; either `on(…)` line removed; the error object passed on; the 10 s bound removed.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import * as pool from './pool.ts';
import * as startup from './startup.ts';
import * as index from './index.ts';

const NAMES = ['app', 'auth', 'worker', 'operator'] as const;
const CANARY_PW = 'canary-password-word';
const CANARY_DETAIL = 'canary-detail-word';

let dir: string;
function env(user: string) {
  return {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_NAME: 'x',
    DATABASE_USER: user,
    DATABASE_PASSWORD_FILE: path.join(dir, 'pw'),
    DATABASE_SSLMODE: 'disable',
  };
}
function make(name: (typeof NAMES)[number]): pg.Pool {
  return { app: pool.appPool, auth: pool.authPool, worker: pool.workerPool, operator: pool.operatorPool }[name]();
}
function failure(extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('boom ' + CANARY_DETAIL), { code: '57P01', detail: CANARY_DETAIL, client: { password: CANARY_PW } }, extra);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-errors-'));
  fs.writeFileSync(path.join(dir, 'pw'), CANARY_PW + '\n');
  pool.configure({ app: env('poly_app'), auth: env('poly_auth'), worker: env('poly_worker'), operator: env('poly_operator') });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  (pool.onConnectionLost as ((fn: () => void) => void) | undefined)?.(() => undefined);
  await pool.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('connection-lost seam', () => {
  it('pool.ts exports onConnectionLost, startup re-exports it, the db index does not', () => {
    expect(typeof pool.onConnectionLost).toBe('function');
    expect(startup.onConnectionLost).toBe(pool.onConnectionLost);
    expect('onConnectionLost' in index).toBe(false);
  });
});

describe.each(NAMES)('the %s pool survives a lost connection', (name) => {
  it('an idle client error does not throw and calls nobody', () => {
    const seen: unknown[] = [];
    pool.onConnectionLost((e) => seen.push(e));
    const p = make(name);
    expect(() => p.emit('error', new Error('x'), {} as pg.PoolClient)).not.toThrow();
    expect(seen).toEqual([]); // the pool has already removed an idle client; nothing to report
  });

  it('a checked-out client error does not throw and reports the pool, name and code only', () => {
    const seen: unknown[] = [];
    const out: string[] = [];
    const w1 = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => (out.push(String(c)), true));
    const w2 = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => (out.push(String(c)), true));
    pool.onConnectionLost((e) => seen.push(e));
    const p = make(name);
    const c = new EventEmitter();
    p.emit('connect', c as unknown as pg.PoolClient);
    expect(() => c.emit('error', failure())).not.toThrow();
    w1.mockRestore();
    w2.mockRestore();
    expect(seen).toEqual([{ pool: name, type: 'Error', code: '57P01' }]);
    const everything = JSON.stringify(seen) + out.join('');
    expect(everything).not.toContain(CANARY_PW);
    expect(everything).not.toContain(CANARY_DETAIL);
    expect(out.join('')).toBe('');
  });

  it('a callback that throws is ignored', () => {
    pool.onConnectionLost(() => {
      throw new Error('logger down');
    });
    const p = make(name);
    const c = new EventEmitter();
    p.emit('connect', c as unknown as pg.PoolClient);
    expect(() => c.emit('error', failure())).not.toThrow();
  });
});

describe('what the callback may receive', () => {
  it('a name or code that is not plain text becomes unknown or nothing', () => {
    const seen: Array<{ type: string; code: string | undefined }> = [];
    pool.onConnectionLost((e) => seen.push(e));
    const c = new EventEmitter();
    make('app').emit('connect', c as unknown as pg.PoolClient);
    c.emit('error', failure({ name: 'has a space ' + CANARY_DETAIL, code: 'bad code ' + CANARY_PW }));
    expect(seen).toEqual([{ pool: 'app', type: 'unknown', code: undefined }]);
  });

  it('is told once per client, and at most once per pool in 10 seconds', () => {
    let n = 0;
    pool.onConnectionLost(() => n++);
    const p = make('worker');
    const a = new EventEmitter();
    const b = new EventEmitter();
    p.emit('connect', a as unknown as pg.PoolClient);
    p.emit('connect', b as unknown as pg.PoolClient);
    a.emit('error', failure());
    a.emit('error', failure());
    expect(n).toBe(1); // the same client twice
    b.emit('error', failure());
    expect(n).toBe(1); // another client inside 10 s
    vi.advanceTimersByTime(11_000);
    const c = new EventEmitter();
    p.emit('connect', c as unknown as pg.PoolClient);
    c.emit('error', failure());
    expect(n).toBe(2); // the bound lifts
  });

  it('the bound is per pool', () => {
    let n = 0;
    pool.onConnectionLost(() => n++);
    for (const name of NAMES) {
      const c = new EventEmitter();
      make(name).emit('connect', c as unknown as pg.PoolClient);
      c.emit('error', failure());
    }
    expect(n).toBe(4);
  });
});
