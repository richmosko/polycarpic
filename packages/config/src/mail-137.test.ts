// POLY-137 R1.3 (ruling @ a5e9ce4f): RESEND_API_KEY_FILE is required for `auth` and `worker` when APP_ENV is staging or production, and
// stays optional in development; new MAIL_FROM (not a secret) for auth and worker, required whenever the key is set, and must parse as
// `name <addr>` or `addr`. check-config names a missing variable, never a value. Pure. Titles end [red if: <mutation>].
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTRY, checkConfig, loadConfig } from './index.ts';

const dir = mkdtempSync(join(tmpdir(), 'poly137-cfg-'));
let n = 0;
const file = (c: string) => { const p = join(dir, `f${n++}`); writeFileSync(p, c); return p; };
const USER: Record<string, string> = { auth: 'poly_auth', worker: 'poly_worker' };
const env = (svc: string, over: Record<string, string | undefined> = {}) => ({
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '5432', DATABASE_NAME: 'polycarpic', DATABASE_USER: USER[svc], DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: file('pw\n'),
  ...(svc === 'auth' ? { AUTH_SECRET_FILE: file('s'.repeat(48) + '\n') } : {}),
  ...over,
});
const check = (svc: string, over: Record<string, string | undefined> = {}) => (checkConfig as any)(svc, env(svc, over)) as { var: string; fault: string; message?: string }[];
const staging = (over: Record<string, string | undefined> = {}) => ({ APP_ENV: 'staging', TLS_MODE: 'real-domain', PUBLIC_ORIGIN: 'https://staging.qa.test', DATABASE_SSLMODE: 'verify-full', ...over });
const prod = (over: Record<string, string | undefined> = {}) => ({ ...staging(), APP_ENV: 'production', PUBLIC_ORIGIN: 'https://app.qa.test', ...over });
const KEY = () => file('re_key\n');
const FROM = 'polycarpic <no-reply@mail.qa.test>';
const mailFaults = (ps: { var: string }[]) => ps.filter((p) => p.var === 'RESEND_API_KEY_FILE' || p.var === 'MAIL_FROM');

describe('MAIL_FROM is a registry entry for auth and worker only, and not a secret', () => {
  it('MAIL_FROM: services = [auth, worker], not a secret  [red if: the variable is missing, or web may set it, or it is registered as a secret]', () => {
    const r: any = REGISTRY.find((x) => x.var === 'MAIL_FROM');
    expect(r, 'MAIL_FROM in the registry').toBeDefined();
    expect([...r.services].sort()).toEqual(['auth', 'worker']);
    expect(r.secret ?? false).toBe(false);
  });
  it('web given MAIL_FROM is forbidden  [red if: web may carry mail settings]', () => {
    expect(check('web' as any, { MAIL_FROM: FROM, DATABASE_USER: 'poly_app' }).some((p) => p.var === 'MAIL_FROM' && /forbid/i.test(p.fault))).toBe(true);
  });
});

for (const svc of ['auth', 'worker']) {
  for (const [label, mk] of [['staging', staging], ['production', prod]] as const) {
    describe(`${svc} in ${label}: no mail, no start`, () => {
      it('with neither RESEND_API_KEY_FILE nor MAIL_FROM, both are named as faults and loadConfig throws  [red if: a release service can start without a mailer]', () => {
        const ps = mailFaults(check(svc, mk()));
        expect(ps.map((p) => p.var).sort(), JSON.stringify(ps)).toEqual(['MAIL_FROM', 'RESEND_API_KEY_FILE']);
        expect(() => (loadConfig as any)(svc, env(svc, mk()))).toThrow();
      });
      it('with the key but no MAIL_FROM, MAIL_FROM is named (required whenever the key is set)  [red if: the sender address is optional]', () => {
        expect(mailFaults(check(svc, mk({ RESEND_API_KEY_FILE: KEY() }))).map((p) => p.var)).toEqual(['MAIL_FROM']);
      });
      it('with MAIL_FROM but no key, the key is named  [red if: the key is optional in a release]', () => {
        expect(mailFaults(check(svc, mk({ MAIL_FROM: FROM }))).map((p) => p.var)).toEqual(['RESEND_API_KEY_FILE']);
      });
      it('with both, no mail fault, and the config loads (the positive case)  [red if: the check refuses a correct pair]', () => {
        expect(mailFaults(check(svc, mk({ RESEND_API_KEY_FILE: KEY(), MAIL_FROM: FROM })))).toEqual([]);
      });
      it('a refusal names the variable and never a value: the key file content and the address do not appear in any problem  [red if: check-config echoes a value]', () => {
        const ps = check(svc, mk({ RESEND_API_KEY_FILE: file('re_SECRETVALUE\n'), MAIL_FROM: 'not an address <<<' }));
        const text = JSON.stringify(ps);
        expect(text).not.toContain('re_SECRETVALUE');
        expect(text).not.toContain('not an address');
        expect(mailFaults(ps).map((p) => p.var)).toEqual(['MAIL_FROM']);
      });
    });
  }
  describe(`${svc} in development: the mailer stays optional`, () => {
    it('neither variable is a fault  [red if: development is forced to configure mail]', () => {
      expect(mailFaults(check(svc))).toEqual([]);
    });
    it('a key without MAIL_FROM names MAIL_FROM even in development (required whenever the key is set)  [red if: a key is accepted with no sender]', () => {
      expect(mailFaults(check(svc, { RESEND_API_KEY_FILE: KEY() })).map((p) => p.var)).toEqual(['MAIL_FROM']);
    });
  });
  describe(`${svc}: MAIL_FROM must parse as "name <addr>" or "addr"`, () => {
    for (const ok of ['no-reply@mail.qa.test', 'polycarpic <no-reply@mail.qa.test>', 'Poly Carpic <a.b+c@mail.qa.test>']) {
      it(`accepts ${JSON.stringify(ok)}  [red if: a valid sender is refused]`, () => {
        expect(mailFaults(check(svc, { RESEND_API_KEY_FILE: KEY(), MAIL_FROM: ok }))).toEqual([]);
      });
    }
    for (const bad of ['', 'no-at-sign', 'a b@c.test', '<no-reply@mail.qa.test', 'x <a@b.test> trailing', 'a@b.test\nBcc: x@y.test', 'a@b.test, c@d.test']) {
      it(`refuses ${JSON.stringify(bad)}  [red if: a malformed or header-injecting sender is accepted]`, () => {
        expect(mailFaults(check(svc, { RESEND_API_KEY_FILE: KEY(), MAIL_FROM: bad })).map((p) => p.var), bad).toContain('MAIL_FROM');
      });
    }
  });
}
