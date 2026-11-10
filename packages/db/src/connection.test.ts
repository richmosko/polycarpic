import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { connectionFrom } from './connection.ts';

const pw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poly-conn-')), 'pw');
fs.writeFileSync(pw, 'secret\n');
const env = (mode?: string) => ({
  DATABASE_HOST: 'db', DATABASE_NAME: 'n', DATABASE_USER: 'poly_app', DATABASE_PASSWORD_FILE: pw,
  ...(mode === undefined ? {} : { DATABASE_SSLMODE: mode }),
});

test('SSLMODE is mandatory and closed: unset or unknown throws (SecEng M-1)', () => {
  for (const bad of [undefined, '', 'verify_full', 'prefer', 'DISABLE']) expect(() => connectionFrom(env(bad))).toThrow(/DATABASE_SSLMODE/);
});

test('each mode maps to one ssl meaning; the password comes from the file', () => {
  expect(connectionFrom(env('disable')).ssl).toBe(false);
  expect(connectionFrom(env('require')).ssl).toEqual({ rejectUnauthorized: false });
  expect(connectionFrom(env('verify-full')).ssl).toBe(true);
  expect(connectionFrom(env('disable')).password).toBe('secret');
});
