// `migrate check-config` (ARCH §8.1, INFRA §3.2, §4.5). Reads files, connects nowhere. Returns problems; the CLI exits 1 on any.
import fs from 'node:fs';
import path from 'node:path';

/** Secret files every release needs mounted somewhere (INFRA §3.2). Provider keys that a milestone has not reached are not listed. */
export const REQUIRED_SECRETS = [
  'db_password_app', 'db_password_worker', 'db_password_migrator', 'auth_secret', 'credential_keyring',
] as const;

export interface ConfigCheckOptions {
  secretsDir: string;
  hostEnvFile: string;
  required?: readonly string[];
}

export function parseHostEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** The offline half of the §7.8 cross-check: a .local name, or one with no public suffix, needs private-ca. */
export function requiredTlsMode(origin: string): 'private-ca' | undefined {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return host.endsWith('.local') || !host.includes('.') ? 'private-ca' : undefined;
}

export function checkConfig(opts: ConfigCheckOptions): string[] {
  const problems: string[] = [];
  for (const name of opts.required ?? REQUIRED_SECRETS) {
    const file = path.join(opts.secretsDir, name);
    let text: string | undefined;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      problems.push(`secret file missing: ${file}`);
      continue;
    }
    if (text.trim() === '') problems.push(`secret file empty: ${file}`);
  }

  let env: Record<string, string> = {};
  try {
    env = parseHostEnv(fs.readFileSync(opts.hostEnvFile, 'utf8'));
  } catch {
    problems.push(`host.env unreadable: ${opts.hostEnvFile}`);
    return problems;
  }

  const mode = env.TLS_MODE;
  if (mode !== 'real-domain' && mode !== 'private-ca') {
    problems.push(`TLS_MODE must be real-domain or private-ca, got ${mode === undefined ? 'nothing' : JSON.stringify(mode)}`);
  } else if (env.PUBLIC_ORIGIN === undefined) {
    problems.push('PUBLIC_ORIGIN is not set in host.env');
  } else if (requiredTlsMode(env.PUBLIC_ORIGIN) === 'private-ca' && mode !== 'private-ca') {
    problems.push(`TLS_MODE=${mode} but ${env.PUBLIC_ORIGIN} has no public suffix: it requires private-ca`);
  }

  if (env.INSTANCE === 'staging' && env.PLAID_ENV !== undefined && env.PLAID_ENV !== 'sandbox') {
    problems.push(`PLAID_ENV must be sandbox on staging, got ${JSON.stringify(env.PLAID_ENV)}`);
  }
  if (env.INSTANCE === 'staging' && env.PLAID_ENV === undefined) problems.push('PLAID_ENV must be sandbox on staging, but it is not set');
  return problems;
}
