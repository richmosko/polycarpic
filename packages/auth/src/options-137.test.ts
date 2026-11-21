// POLY-137 (ruling @ a5e9ce4f) pinned options: R1.5 the mailer seam, R2.1 reset wiring, R3.4/RC6 accountLockout, R4.1 the limiter list,
// R1.9 disableSignUp. Pure: builds authOptions and reads it. Titles end [red if: <mutation>].
import { describe, expect, it } from 'vitest';
import { authOptions } from './options.ts';

const base = { secret: 'x'.repeat(48), baseURL: 'https://app.qa.test/', tlsMode: 'real-domain' as const, requireClientIp: true };
const mailer = { send: async () => {} };
const withMailer: any = authOptions({ ...base, mailer } as any);
const noMailer: any = authOptions({ ...base } as any);
const plugin = (o: any, id: string) => (o.plugins ?? []).find((p: any) => p.id === id);

describe('R4.1 C-04 limited list (5 per 60 s each)', () => {
  for (const p of ['/callback/*', '/magic-link/verify', '/reset-password', '/second-step/cancel-hold', '/request-password-reset', '/sign-in/magic-link', '/second-step/send-code']) {
    it(`${p} is limited to 5 a minute  [red if: the route is missing from LIMITED, or the wildcard is written as a template]`, () => {
      expect(withMailer.rateLimit.customRules[p], p).toEqual({ window: 60, max: 5 });
    });
  }
  it('the callback rule is the wildcard, never the template /callback/:id, which BetterAuth would never match  [red if: the template key is used]', () => {
    expect(Object.keys(withMailer.rateLimit.customRules)).not.toContain('/callback/:id');
  });
  it('/change-password keeps BetterAuth\'s built-in special rule: it is not on our list  [red if: the route is added to LIMITED and the 3-per-10-s rule is lost]', () => {
    expect(Object.keys(withMailer.rateLimit.customRules)).not.toContain('/change-password');
  });
});

describe('R2.1 password reset wiring', () => {
  it('the reset token lives 900 seconds (the library default is 3600)  [red if: the option is unset]', () => {
    expect(withMailer.emailAndPassword.resetPasswordTokenExpiresIn).toBe(900);
  });
  it('every session is revoked on reset  [red if: revokeSessionsOnPasswordReset is dropped]', () => {
    expect(withMailer.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
  });
  it('sendResetPassword is set when a mailer is given and unset when none is  [red if: the sender is always set, or never wired]', () => {
    expect(typeof withMailer.emailAndPassword.sendResetPassword).toBe('function');
    expect(noMailer.emailAndPassword.sendResetPassword, 'R1.4: RESET_PASSWORD_DISABLED with no mailer').toBeUndefined();
  });
});

describe('R1.5 the one seam into BetterAuth', () => {
  it('AuthInput takes `mailer`; the magic-link plugin gets a sender built from it  [red if: authOptions still demands sendMagicLink]', () => {
    const m = plugin(withMailer, 'magic-link');
    expect(typeof m.options?.sendMagicLink).toBe('function');
  });
  it('with no mailer the magic-link sender throws "mailer not configured" (development only)  [red if: it silently succeeds]', async () => {
    const m = plugin(noMailer, 'magic-link');
    await expect(m.options.sendMagicLink({ email: 'a@qa.test', token: 't', url: 'https://x/y' })).rejects.toThrow(/mailer not configured/);
  });
  it('an input that still carries the removed fields is not what the code reads: sendMagicLink / sendSecondStepCode on the input are ignored  [red if: the old injection points are still honoured]', async () => {
    const seen: unknown[] = [];
    const o: any = authOptions({ ...base, sendMagicLink: async (m: unknown) => { seen.push(m); }, sendSecondStepCode: async (m: unknown) => { seen.push(m); } } as any);
    await expect(plugin(o, 'magic-link').options.sendMagicLink({ email: 'a@qa.test', token: 't', url: 'u' })).rejects.toThrow(/mailer not configured/);
    expect(seen).toEqual([]);
  });
});

describe('R3.4 / RC6 the method hold depends on accountLockout', () => {
  it('the two-factor plugin does not disable accountLockout  [red if: accountLockout: {enabled: false} would switch off the hold on TOTP and backup-code sign-in]', () => {
    const t = plugin(withMailer, 'two-factor');
    expect(t.options?.accountLockout?.enabled !== false, 'the method hold (POLY-137 R3.4) needs accountLockout').toBe(true);
  });
});

describe('R1.9 magic link: sign-up is off, as defence in depth', () => {
  it('magicLink({ disableSignUp: true })  [red if: a magic link can still create a user]', () => {
    expect(plugin(withMailer, 'magic-link').options?.disableSignUp).toBe(true);
  });
});
