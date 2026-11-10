// `migrate check-config` (ARCH §8.1; POLY-83 ruling addendum 1). Reads files and the environment, connects nowhere.
// POLY-85 moves the parsing into packages/config under the same names.
import fs from 'node:fs';
import type { Env } from './connection.ts';

export interface ConfigProblem {
  what: string;
}

const SSLMODES = ['disable', 'require', 'verify-full'];

/** Faults found, one per variable. Empty means ok. */
export function checkConfig(env: Env, expectedUser = 'poly_migrator'): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const bad = (what: string) => out.push({ what });
  for (const k of ['DATABASE_URL', 'DATABASE_PASSWORD']) if (env[k]) bad(`${k} must not be set`);
  if (!env.DATABASE_HOST) bad('DATABASE_HOST is not set');
  if (!env.DATABASE_NAME) bad('DATABASE_NAME is not set');
  if (env.DATABASE_PORT !== undefined && !/^\d+$/.test(env.DATABASE_PORT)) bad('DATABASE_PORT must be an integer');
  if (env.DATABASE_USER !== expectedUser) bad(`DATABASE_USER must be ${expectedUser}`);
  if (!env.DATABASE_SSLMODE || !SSLMODES.includes(env.DATABASE_SSLMODE)) bad(`DATABASE_SSLMODE must be one of ${SSLMODES.join(' | ')}`);
  const f = env.DATABASE_PASSWORD_FILE;
  if (!f) bad('DATABASE_PASSWORD_FILE is not set');
  else {
    let text: string | undefined;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      bad(`DATABASE_PASSWORD_FILE does not exist: ${f}`);
    }
    if (text !== undefined) {
      if (text.trim() === '') bad(`DATABASE_PASSWORD_FILE is empty: ${f}`);
      else if (text.replace(/\n$/, '').includes('\n')) bad(`DATABASE_PASSWORD_FILE must hold one line: ${f}`);
    }
  }
  return out;
}
