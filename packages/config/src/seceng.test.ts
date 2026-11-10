// POLY-85 seceng conditions S-1 .. S-4, S-9 (a, b) on the loader. One describe per condition; the name carries the S-n.
// Same assumed surface as loader.test.ts, plus: SECRET_NAME_RE exported from ./index.ts (S-1 says "export the regex").
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CANARIES, assertNoCanary } from '../../../tests/log/canary.ts';
import { SECRET_NAME_RE, checkConfig, loadConfig } from './index.ts';

type Env = Record<string, string | undefined>;
const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'poly85-sec-'));
let n = 0;
const file = (c: string) => { const p = join(dir, `f${n++}`); writeFileSync(p, c); return p; };
const good = (over: Env = {}): Env => ({
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '5432', DATABASE_NAME: 'polycarpic',
  DATABASE_USER: 'poly_app', DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: file('pw\n'), AUTH_SECRET_FILE: file('auth\n'), ...over,
});
const prod = (over: Env = {}): Env => good({ APP_ENV: 'production', TLS_MODE: 'real-domain', PUBLIC_ORIGIN: 'https://app.example.com', PLAID_ENV: 'production', DATABASE_SSLMODE: 'verify-full', ...over });
const stage = (over: Env = {}): Env => prod({ APP_ENV: 'staging', PLAID_ENV: 'sandbox', ...over });
const vars = (env: Env, svc: 'web' | 'worker' | 'migrate' = 'web') => checkConfig(svc, env).map((p) => p.var);
const authSecret = (c: string): any => (loadConfig('web', good({ AUTH_SECRET_FILE: file(c) })) as any).secrets.AUTH_SECRET_FILE;

describe('S-1 the secret-looking pattern: one exported source, wider than R2 (KEY, PASS, PWD, DSN as name parts)', () => {
  it('SECRET_NAME_RE matches the S-1 additions and the R2 originals', () => {
    for (const n of ['B2_APPLICATION_KEY', 'RESEND_KEY', 'DB_PASS', 'DB_PWD', 'SENTRY_DSN', 'KEY', 'PASS', 'AUTH_SECRET', 'my_password', 'STRIPE_TOKEN']) expect(SECRET_NAME_RE.test(n), n).toBe(true);
  });
  it('and does not over-reach on words that merely contain KEY or PASS', () => {
    for (const n of ['MONKEY', 'KEYBOARD_LAYOUT', 'PASSENGER_COUNT', 'COMPASS', 'APP_ENV', 'TLS_MODE', 'PUBLIC_ORIGIN', 'STATUS_PORT', 'PLAID_ENV']) expect(SECRET_NAME_RE.test(n), n).toBe(false);
  });
  for (const name of ['B2_APPLICATION_KEY', 'RESEND_KEY', 'DB_PASS']) {
    it(`${name} is refused in staging, naming the variable and not the value`, () => {
      const problems = checkConfig('web', stage({ [name]: CANARIES.token }));
      expect(problems.map((p) => p.var)).toContain(name);
      assertNoCanary(JSON.stringify(problems));
    });
  }
  it('the Dockerfile test and the loader share the one pattern (no second copy of the regex in tests/image)', () => {
    const t = readFileSync(join(HERE, '..', '..', '..', 'tests', 'image', 'dockerfile.test.ts'), 'utf8');
    expect(t).toMatch(/SECRET_NAME_RE/);
    expect(t).not.toMatch(/PASSWORD\|PASSWD\|SECRET/);
  });
});

describe('S-2 no plain-variable fallback, in every APP_ENV', () => {
  const stems = ['AUTH_SECRET', 'PLAID_SECRET', 'OAUTH_GOOGLE_SECRET', 'OAUTH_GITHUB_SECRET', 'RESEND_API_KEY', 'PRICE_API_KEY', 'BLS_API_KEY', 'CREDENTIAL_KEYRING', 'BETTER_AUTH_SECRET'];
  for (const stem of stems) {
    for (const [label, mk] of [['development', good], ['staging', stage], ['production', prod]] as const) {
      it(`${label}: ${stem} set as a plain variable is refused, naming it; canary absent`, () => {
        const problems = checkConfig('web', mk({ [stem]: CANARIES.secretFile }));
        expect(problems.map((p) => p.var), stem).toContain(stem);
        assertNoCanary(JSON.stringify(problems));
      });
    }
  }
  it('development AUTH_SECRET with no _FILE refuses naming AUTH_SECRET and AUTH_SECRET_FILE (the S-2 canary)', () => {
    expect(vars(good({ AUTH_SECRET_FILE: undefined, AUTH_SECRET: CANARIES.secretFile }))).toEqual(expect.arrayContaining(['AUTH_SECRET', 'AUTH_SECRET_FILE']));
  });
  it('the DATABASE_PASSWORD stem stays refused in every service', () => {
    for (const svc of ['web', 'worker', 'migrate'] as const) expect(vars(good({ DATABASE_PASSWORD: 'x' }), svc)).toContain('DATABASE_PASSWORD');
  });
});

describe('S-3 every fault with the canary as content: nothing in problems, ConfigError message, cause or stack', () => {
  const contents: [string, string][] = [
    ['the canary as the whole file (a good file)', CANARIES.secretFile + '\n'],
    ['canary\\ncanary (line)', `${CANARIES.secretFile}\n${CANARIES.secretFile}\n`],
    [' canary (leading whitespace)', ` ${CANARIES.secretFile}\n`],
    ['canary  (trailing whitespace)', `${CANARIES.secretFile} \n`],
    ['canary\\r\\n', `${CANARIES.secretFile}\r\n`],
  ];
  for (const [name, c] of contents) {
    it(name, () => {
      const env = good({ AUTH_SECRET_FILE: file(c), DATABASE_PASSWORD_FILE: file(c) });
      assertNoCanary(JSON.stringify(checkConfig('web', env)), 'problems');
      try { loadConfig('web', env); } catch (e: any) {
        assertNoCanary([e.message, String(e.cause ?? ''), e.stack ?? '', JSON.stringify(e)].join('\n'), 'ConfigError');
      }
    });
  }
  it('a directory path (cannot be read) leaks nothing', () => {
    const d = join(dir, 'cdir'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'x'), CANARIES.secretFile);
    const env = good({ AUTH_SECRET_FILE: d });
    assertNoCanary(JSON.stringify(checkConfig('web', env)));
    expect(() => loadConfig('web', env)).toThrow();
    try { loadConfig('web', env); } catch (e: any) { assertNoCanary([e.message, String(e.cause ?? ''), e.stack ?? ''].join('\n')); }
  });
});

describe('S-4 Secret holds its value in a #private field', () => {
  const s = () => authSecret(CANARIES.secretFile + '\n');
  it('Object.keys is empty; no own property or symbol carries the value', () => {
    expect(Object.keys(s())).toEqual([]);
    expect(Object.getOwnPropertySymbols(s())).toEqual([]);
    expect(Object.getOwnPropertyNames(s())).toEqual([]);
  });
  it('spread, JSON, structuredClone and a template contain no canary', () => {
    const x = s();
    assertNoCanary(JSON.stringify({ ...x }), 'spread');
    assertNoCanary(JSON.stringify(x), 'JSON');
    assertNoCanary(`${x}`, 'template');
    let cloned = '';
    try { cloned = JSON.stringify(structuredClone(x)); } catch { /* a throw is fine */ }
    assertNoCanary(cloned, 'structuredClone');
  });
  it('util.inspect(cfg, { showHidden: true, depth: Infinity }) contains no canary', () => {
    assertNoCanary(inspect(loadConfig('web', good({ AUTH_SECRET_FILE: file(CANARIES.secretFile + '\n') })), { showHidden: true, depth: Infinity }), 'inspect');
  });
  it('the source declares a #private field in class Secret', () => {
    const src = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => readFileSync(join(HERE, f), 'utf8')).join('\n');
    expect(src).toMatch(/class Secret\b[\s\S]*?#\w+/);
  });
});

describe('S-9 (a, b)', () => {
  it('(a) PUBLIC_ORIGIN must equal new URL(v).origin: userinfo, trailing slash, default port, upper-case host refused', () => {
    for (const o of ['https://u@app.example.com', 'https://u:p@app.example.com', 'https://app.example.com/', 'https://APP.EXAMPLE.COM', 'https://app.example.com:443']) expect(vars(prod({ PUBLIC_ORIGIN: o })), o).toContain('PUBLIC_ORIGIN');
    expect(vars(prod({ PUBLIC_ORIGIN: 'https://app.example.com:8443' }))).not.toContain('PUBLIC_ORIGIN');
  });
  it('(b) POLY_IMAGE_REVISION set (the release image) refuses APP_ENV=development, naming APP_ENV', () => {
    expect(vars(good({ POLY_IMAGE_REVISION: 'a'.repeat(40) }))).toContain('APP_ENV');
  });
  it('(b) ...and staging and production are accepted with it set', () => {
    for (const mk of [stage, prod]) expect(checkConfig('web', mk({ POLY_IMAGE_REVISION: 'a'.repeat(40) }))).toEqual([]);
  });
  it('(b) without it, development is fine', () => expect(vars(good())).not.toContain('APP_ENV'));
});
