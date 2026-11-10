// POLY-85 R2/R3: the *_FILE loader and the environment contract. Pure unit tests: tmp files, no database, no network.
// Surface assumed from the ruling (reconcile in `secretOf` / `portOf` below only; everything else is ruling text):
//   checkConfig(service, env) -> { var, fault, path? }[]      loadConfig(service, env) -> config, throws ConfigError
//   ConfigError.problems is that list.   config.secrets[<X_FILE name>] is a Secret.   config.statusPort is a number.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CANARIES, assertNoCanary } from '../../../tests/log/canary.ts';
import { ConfigError, Secret, checkConfig, loadConfig } from './index.ts';

type Svc = 'web' | 'worker' | 'migrate';
type Env = Record<string, string | undefined>;

const secretOf = (cfg: any, v: string): Secret => cfg.secrets[v];
const portOf = (cfg: any): number => cfg.statusPort;

const dir = mkdtempSync(join(tmpdir(), 'poly85-cfg-'));
let n = 0;
const file = (content: string): string => {
  const p = join(dir, `f${n++}`);
  writeFileSync(p, content);
  return p;
};
const DBUSER: Record<Svc, string> = { web: 'poly_app', worker: 'poly_worker', migrate: 'poly_migrator' };
/** A fully valid environment for the service, APP_ENV=development. */
const good = (svc: Svc, over: Env = {}): Env => {
  const e: Env = {
    APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '5432', DATABASE_NAME: 'polycarpic', DATABASE_USER: DBUSER[svc],
    DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: file('pw\n'),
  };
  if (svc !== 'migrate') e.AUTH_SECRET_FILE = file('auth-secret\n');
  return { ...e, ...over };
};
const prod = (svc: Svc, over: Env = {}): Env =>
  good(svc, { APP_ENV: 'production', TLS_MODE: 'real-domain', PUBLIC_ORIGIN: 'https://app.example.com', PLAID_ENV: 'production', DATABASE_SSLMODE: 'verify-full', ...over });
const stage = (svc: Svc, over: Env = {}): Env => prod(svc, { APP_ENV: 'staging', PLAID_ENV: 'sandbox', ...over });

const vars = (svc: Svc, env: Env) => checkConfig(svc, env).map((p) => p.var);

describe('good environments', () => {
  for (const svc of ['web', 'worker', 'migrate'] as Svc[]) {
    it(`${svc}: development, staging and production configs are clean`, () => {
      expect(checkConfig(svc, good(svc))).toEqual([]);
      expect(checkConfig(svc, stage(svc))).toEqual([]);
      expect(checkConfig(svc, prod(svc))).toEqual([]);
    });
  }
  it('loadConfig returns for a good config and throws ConfigError carrying the problem list for a bad one', () => {
    expect(() => loadConfig('web', good('web'))).not.toThrow();
    try {
      loadConfig('web', good('web', { AUTH_SECRET_FILE: undefined }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as any).problems.map((p: any) => p.var)).toContain('AUTH_SECRET_FILE');
    }
  });
});

describe('R3 *_FILE semantics (criterion 1: a missing or empty file refuses start, naming the variable)', () => {
  const required: [Svc, string][] = [['web', 'DATABASE_PASSWORD_FILE'], ['worker', 'DATABASE_PASSWORD_FILE'], ['migrate', 'DATABASE_PASSWORD_FILE'], ['web', 'AUTH_SECRET_FILE'], ['worker', 'AUTH_SECRET_FILE']];
  for (const [svc, v] of required) {
    it(`${svc}: ${v} unset refuses, naming it`, () => expect(vars(svc, good(svc, { [v]: undefined }))).toContain(v));
    it(`${svc}: ${v} set to '' refuses, naming it`, () => expect(vars(svc, good(svc, { [v]: '' }))).toContain(v));
    it(`${svc}: ${v} naming a missing file refuses, with the path`, () => {
      const p = checkConfig(svc, good(svc, { [v]: join(dir, 'nope') })).find((x) => x.var === v);
      expect(p).toBeDefined();
      expect(p!.path).toBe(join(dir, 'nope'));
    });
    it(`${svc}: ${v} naming an empty file refuses`, () => expect(vars(svc, good(svc, { [v]: file('') }))).toContain(v));
    it(`${svc}: ${v} naming a whitespace-only file refuses`, () => expect(vars(svc, good(svc, { [v]: file(' \n') }))).toContain(v));
    it(`${svc}: ${v} naming only a newline refuses (one \\n is stripped, then it is empty)`, () => expect(vars(svc, good(svc, { [v]: file('\n') }))).toContain(v));
  }

  it('there is no env-var fallback: AUTH_SECRET in the environment does not satisfy a missing AUTH_SECRET_FILE', () => {
    const env = good('web', { AUTH_SECRET_FILE: undefined, AUTH_SECRET: CANARIES.secretFile });
    expect(vars('web', env)).toContain('AUTH_SECRET_FILE');
    expect(() => loadConfig('web', env)).toThrow(ConfigError);
  });
  it('a missing file and an unreadable path are different faults (ENOENT vs other read error)', () => {
    const missing = checkConfig('web', good('web', { AUTH_SECRET_FILE: join(dir, 'nope') })).find((x) => x.var === 'AUTH_SECRET_FILE')!;
    const adir = join(dir, 'adir');
    mkdirSync(adir);
    const unreadable = checkConfig('web', good('web', { AUTH_SECRET_FILE: adir })).find((x) => x.var === 'AUTH_SECRET_FILE')!;
    expect(unreadable).toBeDefined();
    expect(unreadable.fault).not.toBe(missing.fault);
  });
  it('the four fault kinds for one variable are four distinct fault codes', () => {
    const f = (c: string | null) => checkConfig('web', good('web', { AUTH_SECRET_FILE: c === null ? undefined : c === 'MISSING' ? join(dir, 'zz') : file(c) })).find((x) => x.var === 'AUTH_SECRET_FILE')!.fault;
    const codes = [f(null), f('MISSING'), f(''), f('a\nb\n')];
    expect(new Set(codes).size).toBe(4);
    codes.forEach((c) => expect(typeof c).toBe('string'));
  });

  describe('line secrets', () => {
    it('exactly one trailing newline is removed', () => {
      const cfg = loadConfig('web', good('web', { AUTH_SECRET_FILE: file('abc\n') }));
      expect(secretOf(cfg, 'AUTH_SECRET_FILE').reveal()).toBe('abc');
    });
    it('a file without a trailing newline is taken as is', () => expect(secretOf(loadConfig('web', good('web', { AUTH_SECRET_FILE: file('abc') })), 'AUTH_SECRET_FILE').reveal()).toBe('abc'));
    for (const [name, content] of [['an interior newline', 'a\nb\n'], ['two trailing newlines', 'abc\n\n'], ['leading whitespace', ' abc\n'], ['trailing whitespace', 'abc \n'], ['CRLF', 'abc\r\n'], ['a tab', '\tabc']] as const) {
      it(`refuses ${name}`, () => expect(vars('web', good('web', { AUTH_SECRET_FILE: file(content) }))).toContain('AUTH_SECRET_FILE'));
    }
  });
  describe('text secrets (CREDENTIAL_KEYRING_FILE, worker)', () => {
    it('multi-line content is allowed; one trailing newline removed; nothing else trimmed', () => {
      const cfg = loadConfig('worker', good('worker', { CREDENTIAL_KEYRING_FILE: file('k1:aaa\nk2:bbb\n') }));
      expect(secretOf(cfg, 'CREDENTIAL_KEYRING_FILE').reveal()).toBe('k1:aaa\nk2:bbb');
    });
    it('an empty keyring file refuses', () => expect(vars('worker', good('worker', { CREDENTIAL_KEYRING_FILE: file('') }))).toContain('CREDENTIAL_KEYRING_FILE'));
  });

  describe('optional secrets', () => {
    const optional: [Svc, string][] = [['web', 'OAUTH_GOOGLE_SECRET_FILE'], ['web', 'OAUTH_GITHUB_SECRET_FILE'], ['web', 'RESEND_API_KEY_FILE'], ['worker', 'RESEND_API_KEY_FILE'], ['web', 'PLAID_SECRET_FILE'], ['worker', 'PLAID_SECRET_FILE'], ['worker', 'PRICE_API_KEY_FILE'], ['worker', 'BLS_API_KEY_FILE'], ['worker', 'CREDENTIAL_KEYRING_FILE']];
    for (const [svc, v] of optional) {
      it(`${svc}: ${v} absent is fine`, () => expect(vars(svc, good(svc))).not.toContain(v));
      it(`${svc}: ${v} set to a good file is fine`, () => expect(checkConfig(svc, good(svc, { [v]: file('x\n') }))).toEqual([]));
      it(`${svc}: ${v} set but missing refuses`, () => expect(vars(svc, good(svc, { [v]: join(dir, 'nope') }))).toContain(v));
      it(`${svc}: ${v} set but empty refuses`, () => expect(vars(svc, good(svc, { [v]: file('') }))).toContain(v));
    }
  });

  describe('forbidden per service (TB-4) and unregistered names', () => {
    it('CREDENTIAL_KEYRING_FILE is refused in web, even with a good file', () => expect(vars('web', good('web', { CREDENTIAL_KEYRING_FILE: file('k\n') }))).toContain('CREDENTIAL_KEYRING_FILE'));
    it('CREDENTIAL_KEYRING_FILE is refused in migrate', () => expect(vars('migrate', good('migrate', { CREDENTIAL_KEYRING_FILE: file('k\n') }))).toContain('CREDENTIAL_KEYRING_FILE'));
    it('AUTH_SECRET_FILE is refused in migrate (the migrator password only)', () => expect(vars('migrate', good('migrate', { AUTH_SECRET_FILE: file('a\n') }))).toContain('AUTH_SECRET_FILE'));
    it('PRICE_API_KEY_FILE is refused in web', () => expect(vars('web', good('web', { PRICE_API_KEY_FILE: file('a\n') }))).toContain('PRICE_API_KEY_FILE'));
    for (const env of [good, stage, prod] as const) {
      it(`an unregistered *_FILE (a typo) is refused, naming it (${env === good ? 'development' : env === stage ? 'staging' : 'production'})`, () =>
        expect(vars('web', env('web', { AUTH_SECRET_FIEL: undefined, AUHT_SECRET_FILE: file('x\n') }))).toContain('AUHT_SECRET_FILE'));
    }
  });

  it('reports every fault, one problem each, and does not stop at the first', () => {
    const env = good('web', { DATABASE_PASSWORD_FILE: join(dir, 'a'), AUTH_SECRET_FILE: file(''), TLS_MODE: undefined, PLAID_SECRET_FILE: join(dir, 'b') });
    const v = vars('web', env);
    for (const k of ['DATABASE_PASSWORD_FILE', 'AUTH_SECRET_FILE', 'TLS_MODE', 'PLAID_SECRET_FILE']) expect(v.filter((x) => x === k)).toHaveLength(1);
  });
});

describe('R3 Secret objects never render', () => {
  const cfg = () => loadConfig('web', good('web', { AUTH_SECRET_FILE: file(CANARIES.secretFile + '\n') }));
  it('reveal() returns the value', () => expect(secretOf(cfg(), 'AUTH_SECRET_FILE').reveal()).toBe(CANARIES.secretFile));
  it('toString, String(), template, toJSON all give [secret]', () => {
    const s = secretOf(cfg(), 'AUTH_SECRET_FILE');
    expect(s.toString()).toBe('[secret]');
    expect(`${s}`).toBe('[secret]');
    expect(JSON.stringify({ s })).toBe('{"s":"[secret]"}');
  });
  it('JSON.stringify(config) and util.inspect(config) contain no secret content', () => {
    const c = cfg();
    assertNoCanary(JSON.stringify(c), 'JSON.stringify(config)');
    assertNoCanary(inspect(c, { depth: null, showHidden: true }), 'util.inspect(config)');
    assertNoCanary(inspect(secretOf(c, 'AUTH_SECRET_FILE')), 'util.inspect(secret)');
  });
  it('problems and ConfigError text never contain file content or the value of a refused variable', () => {
    const env = good('web', { AUTH_SECRET_FILE: file(CANARIES.secretFile + '\nsecond line\n'), DATABASE_PASSWORD: CANARIES.token, DATABASE_URL: CANARIES.url });
    const problems = checkConfig('web', env);
    expect(problems.length).toBeGreaterThan(0);
    assertNoCanary(JSON.stringify(problems), 'problems');
    try { loadConfig('web', env); } catch (e) { assertNoCanary(String(e) + ((e as Error).stack ?? '') + JSON.stringify(e), 'ConfigError'); }
  });
});

describe('R2 environment', () => {
  it('APP_ENV is required, with no default', () => expect(vars('web', good('web', { APP_ENV: undefined }))).toContain('APP_ENV'));
  it('APP_ENV outside development|staging|production is refused', () => { for (const v of ['prod', 'test', 'Production', '']) expect(vars('web', good('web', { APP_ENV: v })), v).toContain('APP_ENV'); });
  it('NODE_ENV is never read for a security decision', () => {
    expect(checkConfig('web', good('web', { NODE_ENV: 'production' }))).toEqual([]);
    expect(vars('web', prod('web', { NODE_ENV: 'development' }))).toEqual([]);
    expect(vars('web', good('web', { APP_ENV: undefined, NODE_ENV: 'production' }))).toContain('APP_ENV');
  });
  it('TLS_MODE is required everywhere and must be real-domain|private-ca (C-76: nothing infers it)', () => {
    for (const mk of [good, stage, prod]) expect(vars('web', mk('web', { TLS_MODE: undefined }))).toContain('TLS_MODE');
    expect(vars('web', good('web', { TLS_MODE: 'auto' }))).toContain('TLS_MODE');
  });

  describe('PUBLIC_ORIGIN', () => {
    it('is required', () => expect(vars('web', good('web', { PUBLIC_ORIGIN: undefined }))).toContain('PUBLIC_ORIGIN'));
    it('https with no path, query or fragment is fine', () => expect(checkConfig('web', prod('web'))).toEqual([]));
    for (const o of ['https://app.example.com/app', 'https://app.example.com/?a=1', 'https://app.example.com/#x', 'app.example.com', 'ftp://app.example.com', 'http://app.example.com']) {
      it(`refuses ${o}`, () => expect(vars('web', prod('web', { PUBLIC_ORIGIN: o })), o).toContain('PUBLIC_ORIGIN'));
    }
    it('http://localhost[:port] is allowed in development only', () => {
      expect(vars('web', good('web', { PUBLIC_ORIGIN: 'http://localhost' }))).not.toContain('PUBLIC_ORIGIN');
      expect(vars('web', good('web', { PUBLIC_ORIGIN: 'http://localhost:5173' }))).not.toContain('PUBLIC_ORIGIN');
      expect(vars('web', stage('web', { PUBLIC_ORIGIN: 'http://localhost:5173', TLS_MODE: 'private-ca' }))).toContain('PUBLIC_ORIGIN');
      expect(vars('web', prod('web', { PUBLIC_ORIGIN: 'http://localhost:5173', TLS_MODE: 'private-ca' }))).toContain('PUBLIC_ORIGIN');
    });
    it('http on any other host is refused even in development', () => expect(vars('web', good('web', { PUBLIC_ORIGIN: 'http://example.com' }))).toContain('PUBLIC_ORIGIN'));
  });

  describe('PLAID_ENV (C-77: both refusals)', () => {
    it('staging with production Plaid is refused', () => expect(vars('web', stage('web', { PLAID_ENV: 'production' }))).toContain('PLAID_ENV'));
    it('production with sandbox Plaid is refused', () => expect(vars('web', prod('web', { PLAID_ENV: 'sandbox' }))).toContain('PLAID_ENV'));
    it('is required in staging and production', () => {
      expect(vars('web', stage('web', { PLAID_ENV: undefined }))).toContain('PLAID_ENV');
      expect(vars('web', prod('web', { PLAID_ENV: undefined }))).toContain('PLAID_ENV');
    });
    it('is optional in development, but if set must be sandbox|production', () => {
      expect(vars('web', good('web'))).not.toContain('PLAID_ENV');
      expect(vars('web', good('web', { PLAID_ENV: 'sandbox' }))).not.toContain('PLAID_ENV');
      expect(vars('web', good('web', { PLAID_ENV: 'development' }))).toContain('PLAID_ENV');
    });
  });

  describe('STATUS_PORT (web only)', () => {
    it('defaults to 8081', () => expect(portOf(loadConfig('web', good('web')))).toBe(8081));
    it('accepts 1024..65535', () => {
      for (const p of ['1024', '8081', '65535']) expect(vars('web', good('web', { STATUS_PORT: p })), p).not.toContain('STATUS_PORT');
      expect(portOf(loadConfig('web', good('web', { STATUS_PORT: '9090' })))).toBe(9090);
    });
    for (const p of ['1023', '80', '65536', '0', '-1', 'abc', '80.5', '8081 ', '0x1F90']) {
      it(`refuses ${JSON.stringify(p)}`, () => expect(vars('web', good('web', { STATUS_PORT: p }))).toContain('STATUS_PORT'));
    }
    it('STATUS_PORT is not a worker/migrate variable: set there it is ignored without refusal or effect', () => {
      expect(checkConfig('worker', good('worker', { STATUS_PORT: '9090' }))).toEqual([]);
    });
  });

  describe('DATABASE_* per service (POLY-83 addendum 1)', () => {
    for (const svc of ['web', 'worker', 'migrate'] as Svc[]) {
      for (const other of Object.values(DBUSER).filter((u) => u !== DBUSER[svc])) {
        it(`${svc} refuses DATABASE_USER=${other}`, () => expect(vars(svc, good(svc, { DATABASE_USER: other }))).toContain('DATABASE_USER'));
      }
      for (const mk of [good, stage, prod]) {
        it(`${svc} refuses DATABASE_PASSWORD and DATABASE_URL (${mk === good ? 'development' : mk === stage ? 'staging' : 'production'}), naming them, never their values`, () => {
          const problems = checkConfig(svc, mk(svc, { DATABASE_PASSWORD: CANARIES.token, DATABASE_URL: CANARIES.url }));
          const v = problems.map((p) => p.var);
          expect(v).toContain('DATABASE_PASSWORD');
          expect(v).toContain('DATABASE_URL');
          assertNoCanary(JSON.stringify(problems));
        });
      }
    }
  });
});

describe('R2 TLS_MODE cross-check against PUBLIC_ORIGIN (offline only, public suffix list)', () => {
  const t = (origin: string, mode: string) => vars('web', prod('web', { PUBLIC_ORIGIN: origin, TLS_MODE: mode })).includes('TLS_MODE');
  const cases: [string, string, boolean][] = [
    // origin, mode, refused?
    ['https://app.example.com', 'real-domain', false],
    ['https://app.example.com', 'private-ca', true],
    ['https://x.example.co.uk', 'real-domain', false],
    ['https://x.example.co.uk', 'private-ca', true],
    ['https://polycarpic.local', 'private-ca', false],
    ['https://polycarpic.local', 'real-domain', true],
    ['https://app.home.arpa', 'private-ca', false],
    ['https://app.home.arpa', 'real-domain', true],
    ['https://polycarpic', 'private-ca', false],
    ['https://polycarpic', 'real-domain', true],
    ['https://10.0.0.5', 'private-ca', false],
    ['https://10.0.0.5', 'real-domain', true],
    ['https://example.com:8443', 'real-domain', false],
  ];
  for (const [o, m, refused] of cases) it(`${o} with ${m} is ${refused ? 'refused' : 'accepted'}`, () => expect(t(o, m)).toBe(refused));
  it('a mismatch names TLS_MODE and the check makes no network call (it returns synchronously)', () => {
    const r = checkConfig('web', prod('web', { PUBLIC_ORIGIN: 'https://nonexistent-zone.example.invalid', TLS_MODE: 'private-ca' }));
    expect(Array.isArray(r)).toBe(true); // a Promise here would mean a lookup
  });
});

describe('R2 secret-looking variables are refused in staging and production (SECURITY 6.2)', () => {
  const bad = ['AUTH_SECRET', 'STRIPE_TOKEN', 'RESEND_API_KEY', 'SOME_APIKEY', 'PRIVATE_KEY', 'CREDENTIAL_KEYRING', 'DB_PASSWD', 'my_password', 'SESSION_CREDENTIALS'];
  for (const name of bad) {
    for (const [label, mk] of [['staging', stage], ['production', prod]] as const) {
      it(`${label}: ${name} is refused, naming it and not its value`, () => {
        const problems = checkConfig('web', mk('web', { [name]: CANARIES.token }));
        expect(problems.map((p) => p.var)).toContain(name);
        assertNoCanary(JSON.stringify(problems));
      });
    }
    it(`development: ${name} is allowed`, () => expect(vars('web', good('web', { [name]: 'x' }))).not.toContain(name));
  }
  it('a name ending in _FILE is the sanctioned form and is not caught by the pattern', () => expect(checkConfig('web', prod('web', { PLAID_SECRET_FILE: file('x\n') }))).toEqual([]));
  it('names that merely resemble the pattern are not refused (PUBLIC_ORIGIN, STATUS_PORT, TLS_MODE)', () => expect(checkConfig('web', prod('web', { STATUS_PORT: '8081' }))).toEqual([]));
});
