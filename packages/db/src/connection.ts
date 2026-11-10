// The one place a connection is described (architect review 1, R3): the DATABASE_* names -> a pg config object, never a URL.
// A URL would carry the password inline and pg reads sslmode=require in a URL as verify-full; the config object has one meaning.
import fs from 'node:fs';
import type pg from 'pg';

export type Env = Record<string, string | undefined>;

export function connectionFrom(env: Env): pg.ClientConfig {
  for (const k of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD_FILE'] as const) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const mode = env.DATABASE_SSLMODE;
  // fail closed: an unset or mistyped mode must not fall through to plaintext (SecEng M-1)
  if (mode !== 'disable' && mode !== 'require' && mode !== 'verify-full') {
    throw new Error('DATABASE_SSLMODE must be one of disable | require | verify-full');
  }
  return {
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT ?? 5432),
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: fs.readFileSync(env.DATABASE_PASSWORD_FILE!, 'utf8').replace(/\n$/, ''),
    // require: encrypted, certificate not verified (what the name says); verify-full: certificate and host name verified.
    ssl: mode === 'verify-full' ? true : mode === 'require' ? { rejectUnauthorized: false } : false,
  };
}
