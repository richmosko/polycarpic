// POLY-147 guard (i), ruling R4: every poly_app and poly_worker query goes out in extended mode, and nothing can bypass the
// seam. Written by qa-147 at the red gate (a test file beside the source, as R8 places it); it needs no database.
// Titles name the mutation that turns them red.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtendedClient, ExtendedModeRequired } from './extended-client.ts';
import { appPool, close, configure, operatorPool, workerPool } from './pool.ts';

function env(user: string): Record<string, string> {
  const f = join(mkdtempSync(join(tmpdir(), 'poly147-pw-')), 'pw');
  writeFileSync(f, 'x\n');
  return { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '1', DATABASE_NAME: 'x', DATABASE_USER: user, DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: f };
}

afterEach(async () => { vi.restoreAllMocks(); await close(); });

describe('ExtendedClient', () => {
  it('turns a string into an extended-mode query, keeping the values  [red if: a string goes out in simple mode]', () => {
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation((() => Promise.resolve({ rows: [] })) as never);
    const c = new ExtendedClient({});
    void c.query('SELECT $1', [1] as never);
    expect(spy).toHaveBeenCalledTimes(1);
    const [cfg, values] = spy.mock.calls[0] as unknown as [{ text: string; queryMode: string }, unknown[]];
    expect(cfg).toMatchObject({ text: 'SELECT $1', queryMode: 'extended' });
    expect(values).toEqual([1]);
  });
  it('overwrites a caller-supplied queryMode  [red if: a caller can ask for simple mode]', () => {
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation((() => Promise.resolve({ rows: [] })) as never);
    const c = new ExtendedClient({});
    void c.query({ text: 'SELECT 1', queryMode: 'simple', rowMode: 'array' } as never);
    const [cfg] = spy.mock.calls[0] as unknown as [{ text: string; queryMode: string; rowMode?: string }];
    expect(cfg.queryMode).toBe('extended');
    expect(cfg.rowMode).toBe('array'); // every other field is kept
  });
  it('refuses a Submittable (pg-cursor, pg-query-stream) with ExtendedModeRequired  [red if: an object with submit() reaches the wire]', async () => {
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation((() => Promise.resolve({ rows: [] })) as never);
    const c = new ExtendedClient({});
    await expect((async () => c.query({ submit() {} } as never))()).rejects.toThrow(ExtendedModeRequired);
    await expect((async () => c.query({ submit() {} } as never))()).rejects.toThrow('ExtendedModeRequired: a query must be sent in extended mode');
    expect(spy).not.toHaveBeenCalled();
  });
  it('is a pg.Client  [red if: it stops being one]', () => {
    expect(new ExtendedClient({})).toBeInstanceOf(pg.Client);
  });
});

describe('the three pools build ExtendedClient clients', () => {
  it('appPool, workerPool and operatorPool all carry options.Client === ExtendedClient  [red if: a pool is built without the Client option]', () => {
    configure({ app: env('poly_app'), worker: env('poly_worker'), operator: env('poly_operator') });
    for (const p of [appPool(), workerPool(), operatorPool()]) expect((p as unknown as { options: { Client: unknown } }).options.Client).toBe(ExtendedClient);
  });
});
