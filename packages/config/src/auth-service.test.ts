// POLY-152 R1.3, seceng #17: the config registry gains the service `auth`. AUTH_SECRET_FILE and the OAuth client secrets are for `auth`
// alone and forbidden for every other service; RESEND_API_KEY_FILE moves from web to auth (the worker keeps it). Pure unit tests.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTRY, SERVICES, checkConfig, loadConfig } from './index.ts';

const dir = mkdtempSync(join(tmpdir(), 'poly152-cfg-'));
let n = 0;
const file = (c: string) => { const p = join(dir, `f${n++}`); writeFileSync(p, c); return p; };
const USER: Record<string, string> = { web: 'poly_app', auth: 'poly_auth', worker: 'poly_worker', migrate: 'poly_migrator', operator: 'poly_operator' };
const env = (svc: string, over: Record<string, string | undefined> = {}) => ({
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '5432', DATABASE_NAME: 'polycarpic', DATABASE_USER: USER[svc], DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: file('pw\n'),
  ...over,
});
const check = (svc: string, over: Record<string, string | undefined>) => (checkConfig as any)(svc, env(svc, over)) as { var: string; fault: string }[];

describe('R1.3 the auth service in the registry [red if: SERVICES lacks auth]', () => {
  it('SERVICES includes auth', () => { expect([...SERVICES]).toContain('auth'); });
  it('AUTH_SECRET_FILE: required for auth, services = [auth] only', () => {
    const r = REGISTRY.find((x) => x.var === 'AUTH_SECRET_FILE')!;
    expect([...r.services]).toEqual(['auth']);
    expect(r.required).toBe(true);
  });
  it('the OAuth client secrets: services = [auth] only', () => {
    for (const v of ['OAUTH_GOOGLE_SECRET_FILE', 'OAUTH_GITHUB_SECRET_FILE']) expect([...REGISTRY.find((x) => x.var === v)!.services], v).toEqual(['auth']);
  });
  it('RESEND_API_KEY_FILE: auth and worker, not web [red if: web still holds the mailer key]', () => {
    expect([...REGISTRY.find((x) => x.var === 'RESEND_API_KEY_FILE')!.services].sort()).toEqual(['auth', 'worker']);
  });
});

describe('forbidden for every service but auth (loadConfig refuses)', () => {
  for (const svc of ['web', 'worker', 'migrate', 'operator']) {
    for (const v of ['AUTH_SECRET_FILE', 'OAUTH_GOOGLE_SECRET_FILE', 'OAUTH_GITHUB_SECRET_FILE']) {
      it(`${svc} given ${v}: a forbidden fault, loadConfig throws [red if: the var is still allowed for ${svc}]`, () => {
        const problems = check(svc, { [v]: file('x\n') });
        expect(problems.some((p) => p.var === v && /forbid/i.test(p.fault)), JSON.stringify(problems)).toBe(true);
        expect(() => (loadConfig as any)(svc, env(svc, { [v]: file('x\n') }))).toThrow();
      });
    }
  }
  it('web given RESEND_API_KEY_FILE: forbidden', () => {
    expect(check('web', { RESEND_API_KEY_FILE: file('k\n') }).some((p) => p.var === 'RESEND_API_KEY_FILE' && /forbid/i.test(p.fault))).toBe(true);
  });
});

describe('POLY-153 R9: the interim session listener\'s variables are forbidden for web and for auth', () => {
  for (const svc of ['web', 'auth'] as const) {
    for (const v of ['AUTH_INTERNAL_URL', 'AUTH_INTERNAL_HOST', 'AUTH_INTERNAL_PORT']) {
      it(`${svc} given ${v}: a forbidden fault and loadConfig throws [red if: ${v} is still accepted or required]`, () => {
        const over = { ...(svc === 'auth' ? { AUTH_SECRET_FILE: file('s\n') } : {}), [v]: v === 'AUTH_INTERNAL_URL' ? 'http://127.0.0.1:3001' : v === 'AUTH_INTERNAL_PORT' ? '3001' : '127.0.0.1' };
        const problems = check(svc, over);
        expect(problems.some((p) => p.var === v && /forbid/i.test(p.fault)), JSON.stringify(problems)).toBe(true);
        expect(() => (loadConfig as any)(svc, env(svc, over))).toThrow();
      });
    }
  }
  it('auth loads with no AUTH_INTERNAL_* at all [red if: the internal host is still required]', () => {
    expect(check('auth', { AUTH_SECRET_FILE: file('s\n') })).toEqual([]);
  });
});

describe('auth itself', () => {
  it('auth with AUTH_SECRET_FILE and poly_auth\'s password loads; without AUTH_SECRET_FILE it is refused as missing [red if: required is false]', () => {
    expect(check('auth', { AUTH_SECRET_FILE: file('s\n') })).toEqual([]);
    expect(check('auth', {}).some((p) => p.var === 'AUTH_SECRET_FILE')).toBe(true);
  });
  it('auth refuses a database user other than poly_auth, and web refuses poly_auth [red if: the service-to-role pairing is unchecked]', () => {
    expect(check('auth', { AUTH_SECRET_FILE: file('s\n'), DATABASE_USER: 'poly_app' }).length).toBeGreaterThan(0);
    expect(check('web', { DATABASE_USER: 'poly_auth' }).length).toBeGreaterThan(0);
  });
});
