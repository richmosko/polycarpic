// Review 1 R3: one connectionFrom(env) builds the connection for the migrate client and the pools.
// NOTE: the parity assertion below is STATIC (it greps migrate.ts and pool.ts for their connectionFrom call). It is not
// a runtime comparison of two live clients; the runtime checks are the per-SSLMODE values of connectionFrom itself.
// Seceng M-1: an unset or unknown DATABASE_SSLMODE throws (real calls); no pool is created and nothing connects.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectionFrom } from '../../packages/db/src/connection.ts';
import { DB_PKG } from './helpers/pg';

const env = (mode: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'poly83-conn-')), 'pw');
  writeFileSync(f, 'secret\n');
  return { DATABASE_HOST: 'h', DATABASE_PORT: '5433', DATABASE_NAME: 'n', DATABASE_USER: 'poly_app', DATABASE_SSLMODE: mode, DATABASE_PASSWORD_FILE: f };
};

describe('connectionFrom(env)', () => {
  it.each([
    ['disable', false],
    ['require', { rejectUnauthorized: false }],
    ['verify-full', true],
  ])('DATABASE_SSLMODE=%s yields the same ssl setting every time', (mode, ssl) => {
    expect(connectionFrom(env(mode)).ssl).toEqual(ssl);
    expect(connectionFrom(env(mode)).ssl).toEqual(connectionFrom(env(mode)).ssl);
  });
  it.each([['unset', undefined], ['unknown value "prefer"', 'prefer'], ['empty string', ''], ['wrong case "REQUIRE"', 'REQUIRE']])(
    'DATABASE_SSLMODE %s throws (fails closed)', (_n, mode) => {
      const e: Record<string, string | undefined> = env('require');
      if (mode === undefined) delete e.DATABASE_SSLMODE; else e.DATABASE_SSLMODE = mode;
      expect(() => connectionFrom(e)).toThrow(/DATABASE_SSLMODE/);
    });
  it('is a config object: no URL, password read from the file and stripped of its newline', () => {
    const c: any = connectionFrom(env('disable'));
    expect(c).toMatchObject({ host: 'h', port: 5433, database: 'n', user: 'poly_app', password: 'secret' });
    expect(c.connectionString).toBeUndefined();
  });
  it('migrate client and runtime pools both build their connection through connectionFrom', () => {
    for (const f of ['migrate.ts', 'pool.ts']) {
      const src = readFileSync(join(DB_PKG, 'src', f), 'utf8');
      expect(src, f).toMatch(/connectionFrom\(/);
      expect(src, f).not.toMatch(/connectionString|postgres(ql)?:\/\/|sslmode=/);
    }
  });
});
