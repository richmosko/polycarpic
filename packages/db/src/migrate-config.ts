// `migrate check-config` (ARCH §8.1; POLY-83 ruling R7). Reads files and the environment, connects nowhere.
// The TLS_MODE / PLAID_ENV / other-secret checks arrive with packages/config (POLY-85).
import fs from 'node:fs';
import path from 'node:path';

export interface ConfigProblem {
  what: string;
}

export interface ConfigInput {
  secretsDir: string;
  env: Record<string, string | undefined>;
}

/** Faults found, each naming what is wrong. Empty means ok. */
export function checkConfig({ secretsDir, env }: ConfigInput): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const file = path.join(secretsDir, 'db_password_migrator');
  if (!env.POLY_MIGRATOR_DATABASE_URL && !env.DATABASE_URL) {
    let text: string | undefined;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      problems.push({ what: `secret file missing: ${file}` });
    }
    if (text !== undefined && text.trim() === '') problems.push({ what: `secret file empty: ${file}` });
    for (const k of ['PGHOST', 'PGDATABASE'] as const) {
      if (!env[k]) problems.push({ what: `connection setting missing: ${k}` });
    }
  }
  return problems;
}
