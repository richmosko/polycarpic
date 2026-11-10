// checkConfig / loadConfig (POLY-85 ruling R2, R3). Reads the environment and the mounted secret files once; connects
// nowhere. One validator for all three entrypoints (migrate, web, worker). A problem names the variable and, for a file
// fault, the path. It never carries file content or the value of a refused variable (S-3).
import { constants, fstatSync, openSync, readSync, closeSync } from 'node:fs';
import { parse as parseHost } from 'tldts';
import { FORBIDDEN_PLAIN, REGISTRY, SECRET_NAME_ALLOW, SECRET_NAME_RE, stemOf, type Service } from './registry.ts';
import { Secret } from './secret.ts';

export type Env = Record<string, string | undefined>;

/** The fixed fault vocabulary. Also the enum of the `fault` field in log.schema.json. */
export const FAULTS = [
  'not_set', 'missing', 'unreadable', 'empty', 'multiline', 'whitespace',
  'forbidden', 'unregistered', 'secret_in_env', 'invalid', 'mismatch',
] as const;
export type Fault = (typeof FAULTS)[number];

export interface Problem {
  readonly var: string;
  readonly fault: Fault;
  readonly path?: string;
  /** Printable text (the POLY-83 `check-config:` line body). Names the variable and path, never content. */
  readonly message: string;
}

export class ConfigError extends Error {
  readonly problems: readonly Problem[];
  constructor(problems: readonly Problem[]) {
    super(`invalid configuration: ${problems.map((p) => `${p.var} (${p.fault})`).join(', ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export interface Config {
  readonly service: Service;
  readonly appEnv: 'development' | 'staging' | 'production';
  readonly tlsMode: 'real-domain' | 'private-ca';
  readonly publicOrigin: string;
  readonly plaidEnv: 'sandbox' | 'production' | undefined;
  /** web only; 8081 by default. The bind host is not configurable (R4). */
  readonly statusPort: number;
  /** The source commit baked into the image (POLY_IMAGE_REVISION); undefined outside an image. */
  readonly imageRevision: string | undefined;
  /** One Secret per registered *_FILE variable that is set, keyed by the variable name. */
  readonly secrets: Readonly<Record<string, Secret>>;
}

const APP_ENVS = ['development', 'staging', 'production'] as const;
const DB_USER: Record<Service, string> = { web: 'poly_app', worker: 'poly_worker', migrate: 'poly_migrator' };
const SSLMODES = ['disable', 'require', 'verify-full'];
const MAX_SECRET_BYTES = 64 * 1024;
/** Hosts that are never on the public DNS even where the public suffix list knows the final label. */
const PRIVATE_SUFFIX = /\.(local|localhost|internal|lan|home\.arpa|test|invalid)$/;

type Read = { ok: true; value: string } | { ok: false; fault: Fault };

/** Reads a regular file of bounded size. A FIFO or /dev/zero cannot hang the check. */
function readSecretFile(path: string): Read {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); // a FIFO must not block the check
  } catch (e) {
    return { ok: false, fault: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_SECRET_BYTES) return { ok: false, fault: 'unreadable' };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { ok: true, value: buf.subarray(0, off).toString('utf8') };
  } catch {
    return { ok: false, fault: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

function fileMessage(v: string, fault: Fault, path: string | undefined): string {
  switch (fault) {
    case 'not_set': return `${v} is not set`;
    case 'missing': return `${v} does not exist: ${path}`;
    case 'unreadable': return `${v} cannot be read: ${path}`;
    case 'empty': return `${v} is empty: ${path}`;
    case 'multiline': return `${v} must hold one line: ${path}`;
    default: return `${v} has surrounding whitespace: ${path}`;
  }
}

/** Faults found plus the secrets read. loadConfig throws on any fault; checkConfig returns them. */
function evaluate(service: Service, env: Env): { problems: Problem[]; secrets: Record<string, Secret>; config: Omit<Config, 'secrets'> | undefined } {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const add = (v: string, fault: Fault, message: string, path?: string): void => {
    if (seen.has(v)) return;
    seen.add(v);
    problems.push(path === undefined ? { var: v, fault, message } : { var: v, fault, path, message });
  };
  const set = (k: string): string | undefined => (env[k] === undefined || env[k] === '' ? undefined : env[k]);

  // APP_ENV: required, never defaulted, never inferred from NODE_ENV (R2)
  const appEnvRaw = set('APP_ENV');
  const appEnv = APP_ENVS.find((a) => a === appEnvRaw);
  if (appEnvRaw === undefined) add('APP_ENV', 'not_set', 'APP_ENV is not set');
  else if (!appEnv) add('APP_ENV', 'invalid', `APP_ENV must be one of ${APP_ENVS.join(' | ')}`);
  else if (appEnv === 'development' && set('POLY_IMAGE_REVISION') !== undefined) {
    add('APP_ENV', 'invalid', 'APP_ENV must not be development in a release image');
  }

  // TLS_MODE: required everywhere, never inferred (C-76)
  const tlsRaw = set('TLS_MODE');
  const tlsMode: Config['tlsMode'] | undefined = tlsRaw === 'real-domain' || tlsRaw === 'private-ca' ? tlsRaw : undefined;
  if (tlsRaw === undefined) add('TLS_MODE', 'not_set', 'TLS_MODE is not set');
  else if (!tlsMode) add('TLS_MODE', 'invalid', 'TLS_MODE must be one of real-domain | private-ca');

  // PUBLIC_ORIGIN: an origin and nothing else (S-9a), https unless development localhost
  const originRaw = set('PUBLIC_ORIGIN');
  let host: string | undefined;
  if (originRaw === undefined) add('PUBLIC_ORIGIN', 'not_set', 'PUBLIC_ORIGIN is not set');
  else {
    let u: URL | undefined;
    try { u = new URL(originRaw); } catch { /* refused below */ }
    const local = u?.protocol === 'http:' && u.hostname === 'localhost' && appEnv === 'development';
    if (!u || u.origin !== originRaw || (u.protocol !== 'https:' && !local)) {
      add('PUBLIC_ORIGIN', 'invalid', 'PUBLIC_ORIGIN must be an https origin with no path, query, fragment or credentials');
    } else host = u.hostname;
  }

  // TLS_MODE against PUBLIC_ORIGIN: offline only, from the public suffix list (R2). The zone test runs at web start.
  if (tlsMode && host !== undefined) {
    const t = parseHost(host);
    const isPublic = !t.isIp && t.isIcann === true && t.domain !== null && !PRIVATE_SUFFIX.test(host);
    if (isPublic && tlsMode !== 'real-domain') add('TLS_MODE', 'mismatch', 'TLS_MODE must be real-domain for a public domain in PUBLIC_ORIGIN');
    if (!isPublic && tlsMode !== 'private-ca') add('TLS_MODE', 'mismatch', 'TLS_MODE must be private-ca for a private or local host in PUBLIC_ORIGIN');
  }

  // PLAID_ENV (C-77): staging is sandbox, production is production
  const plaidRaw = set('PLAID_ENV');
  const plaidEnv: Config['plaidEnv'] = plaidRaw === 'sandbox' || plaidRaw === 'production' ? plaidRaw : undefined;
  if (plaidRaw !== undefined && !plaidEnv) add('PLAID_ENV', 'invalid', 'PLAID_ENV must be one of sandbox | production');
  else if (appEnv === 'staging' || appEnv === 'production') {
    const want = appEnv === 'staging' ? 'sandbox' : 'production';
    if (plaidRaw === undefined) add('PLAID_ENV', 'not_set', 'PLAID_ENV is not set');
    else if (plaidEnv !== want) add('PLAID_ENV', 'mismatch', `PLAID_ENV must be ${want} when APP_ENV is ${appEnv}`);
  }

  // STATUS_PORT (web only): an integer in 1024..65535
  let statusPort = 8081;
  if (service === 'web' && set('STATUS_PORT') !== undefined) {
    const p = env.STATUS_PORT!;
    const n = /^\d{1,5}$/.test(p) ? Number(p) : NaN;
    if (n >= 1024 && n <= 65535) statusPort = n;
    else add('STATUS_PORT', 'invalid', 'STATUS_PORT must be an integer from 1024 to 65535');
  }

  // DATABASE_* (POLY-83 addendum 1; the texts are pinned by tests/db/checks.test.ts)
  for (const k of ['DATABASE_URL', 'DATABASE_PASSWORD']) if (set(k) !== undefined) add(k, 'forbidden', `${k} must not be set`);
  if (!set('DATABASE_HOST')) add('DATABASE_HOST', 'not_set', 'DATABASE_HOST is not set');
  if (!set('DATABASE_NAME')) add('DATABASE_NAME', 'not_set', 'DATABASE_NAME is not set');
  if (env.DATABASE_PORT !== undefined && !/^\d+$/.test(env.DATABASE_PORT)) add('DATABASE_PORT', 'invalid', 'DATABASE_PORT must be an integer');
  if (env.DATABASE_USER !== DB_USER[service]) add('DATABASE_USER', 'invalid', `DATABASE_USER must be ${DB_USER[service]}`);
  if (!env.DATABASE_SSLMODE || !SSLMODES.includes(env.DATABASE_SSLMODE)) add('DATABASE_SSLMODE', 'invalid', `DATABASE_SSLMODE must be one of ${SSLMODES.join(' | ')}`);

  // plain-variable fallbacks, refused in every APP_ENV (S-2)
  for (const k of [...FORBIDDEN_PLAIN, ...REGISTRY.map((r) => stemOf(r.var))]) {
    if (set(k) !== undefined) add(k, 'forbidden', `${k} must not be set; the secret comes from ${k === 'BETTER_AUTH_SECRET' ? 'AUTH_SECRET_FILE' : `${k}_FILE`}`);
  }

  // *_FILE variables: forbidden here, unregistered, or read (R3)
  const secrets: Record<string, Secret> = {};
  for (const k of Object.keys(env)) {
    if (!k.endsWith('_FILE') || env[k] === undefined) continue;
    const row = REGISTRY.find((r) => r.var === k);
    if (!row) add(k, 'unregistered', `${k} is not a known secret file variable`);
    else if (!row.services.includes(service)) add(k, 'forbidden', `${k} must not be set for ${service}`);
  }
  for (const row of REGISTRY.filter((r) => r.services.includes(service))) {
    const path = set(row.var);
    if (path === undefined) {
      if (row.required) add(row.var, 'not_set', fileMessage(row.var, 'not_set', undefined));
      continue;
    }
    const r = readSecretFile(path);
    if (!r.ok) { add(row.var, r.fault, fileMessage(row.var, r.fault, path), path); continue; }
    const value = r.value.replace(/\n$/, '');
    let fault: Fault | undefined;
    if (value.trim() === '') fault = 'empty';
    else if (row.shape === 'line' && value.includes('\n')) fault = 'multiline';
    else if (row.shape === 'line' && value !== value.trim()) fault = 'whitespace';
    if (fault) add(row.var, fault, fileMessage(row.var, fault, path), path);
    else secrets[row.var] = new Secret(value);
  }

  // secret-looking variables in staging and production (SECURITY 6.2; staging is held to the same standard)
  if (appEnv === 'staging' || appEnv === 'production') {
    for (const k of Object.keys(env)) {
      if (env[k] !== undefined && !k.endsWith('_FILE') && SECRET_NAME_RE.test(k) && !SECRET_NAME_ALLOW.includes(k)) {
        add(k, 'secret_in_env', `${k} looks like a secret and must be a mounted file named by ${k}_FILE`);
      }
    }
  }

  const config = problems.length === 0 && appEnv && tlsMode && originRaw !== undefined
    ? { service, appEnv, tlsMode, publicOrigin: originRaw, plaidEnv, statusPort, imageRevision: set('POLY_IMAGE_REVISION') }
    : undefined;
  return { problems, secrets, config };
}

/** Every fault, one problem each. Empty means ok. */
export function checkConfig(service: Service, env: Env = process.env): Problem[] {
  return evaluate(service, env).problems;
}

/** The validated configuration, or a ConfigError carrying every problem. */
export function loadConfig(service: Service, env: Env = process.env): Config {
  const { problems, secrets, config } = evaluate(service, env);
  if (problems.length > 0 || !config) throw new ConfigError(problems);
  return { ...config, secrets };
}

/**
 * The DATABASE_* faults alone. `migrate` and `migrate --plan` check only what they use, so the runner does not need the
 * web-facing variables; `migrate check-config` and the two apps check everything (R3).
 */
export function checkDatabaseConfig(service: Service, env: Env = process.env): Problem[] {
  return evaluate(service, env).problems.filter((p) => p.var.startsWith('DATABASE_'));
}
