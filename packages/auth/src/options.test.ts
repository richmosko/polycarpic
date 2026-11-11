// POLY-86 criteria 2, 15 (ARCH §2.2 pinned options; ruling R1, R7; seceng S3, S6, S12, S16b). Pure: builds the exported
// configuration and asserts each pinned option on it. Titles end with [red if: <mutation>].
import { describe, expect, it } from 'vitest';
import { authOptions } from './options.ts';

const input = { secret: 'x'.repeat(48), baseURL: 'https://app.qa.test/some/path', tlsMode: 'real-domain' as const, sendMagicLink: async () => {} };
const o: any = authOptions(input);
const plugin = (id: string) => (o.plugins ?? []).find((p: any) => p.id === id);
const hook = async (model: 'user' | 'account', when: 'create' | 'update', data: Record<string, unknown>) => {
  const r = await o.databaseHooks[model][when].before(data, null);
  return (r && typeof r === 'object' && 'data' in r ? r.data : data) as Record<string, unknown>;
};

describe('pinned options (criterion 2)', () => {
  it('account.encryptOAuthTokens is true  [red if: IdP tokens stored in the clear]', () => expect(o.account.encryptOAuthTokens).toBe(true));

  it('account create and update before-hooks drop idToken and keep the rest  [red if: either hook missing or passes idToken through]', async () => {
    for (const when of ['create', 'update'] as const) {
      const out = await hook('account', when, { idToken: 'JWT', accessToken: 'at', providerId: 'google' });
      expect(out, when).not.toHaveProperty('idToken');
      expect(out.accessToken, when).toBe('at');
    }
  });

  it('twoFactor: allowPasswordless, no otpOptions, skipVerificationOnEnable unset, trusted device <= 30 days  [red if: any of these drifts]', () => {
    const t = plugin('two-factor');
    expect(t, 'twoFactor installed').toBeDefined();
    expect(t.options?.allowPasswordless).toBe(true);
    expect(t.options?.otpOptions).toBeUndefined();
    expect(t.options?.skipVerificationOnEnable).toBeUndefined();
    expect(t.options?.trustDeviceMaxAge).toBeLessThanOrEqual(30 * 86400);
    expect(t.options?.trustDeviceMaxAge).toBeGreaterThan(0);
  });

  it('plugins are exactly twoFactor, magicLink, passkey: no bearer, no extras  [red if: bearer or any unreviewed plugin is installed]', () => {
    expect((o.plugins ?? []).map((p: any) => p.id).sort()).toEqual(['magic-link', 'passkey', 'two-factor']);
  });

  it('deleteUser is off; sign-in with password on; a password reset revokes sessions; autoSignInAfterVerification unset  [red if: deleteUser enabled, revokeSessionsOnPasswordReset false, or auto sign-in on verify (H2)]', () => {
    expect(o.user?.deleteUser?.enabled ?? false).toBe(false);
    expect(o.emailAndPassword.enabled).toBe(true);
    expect(o.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
    expect(o.emailVerification?.autoSignInAfterVerification).toBeUndefined();
  });

  it('session: freshAge 30 days, expiresIn 7 days, updateAge 1 day, cookieCache off  [red if: a window drifts or a revoked session survives in a cookie cache]', () => {
    expect(o.session.freshAge).toBe(30 * 86400);
    expect(o.session.expiresIn).toBe(7 * 86400);
    expect(o.session.updateAge).toBe(86400);
    expect(o.session.cookieCache?.enabled ?? false).toBe(false);
  });

  it('recentAuthAt and secondStepAt are additionalFields with input: false  [red if: a request body can set either]', () => {
    expect(o.session.additionalFields.recentAuthAt.input).toBe(false);
    expect(o.user.additionalFields.secondStepAt.input).toBe(false);
  });

  it('S6: rate limiter on, storage memory  [red if: storage is database, so S1 rollbacks erase failed-attempt counters]', () => {
    expect(o.rateLimit?.enabled).toBe(true);
    expect(o.rateLimit?.storage).toBe('memory');
  });

  it("S3/S12: backgroundTasks, disableCSRFCheck and disableOriginCheck unset; trustedOrigins is exactly baseURL's origin  [red if: late work escapes the transaction, or the origin check is relaxed]", () => {
    expect(o.advanced?.backgroundTasks).toBeUndefined();
    expect(o.advanced?.disableCSRFCheck).toBeFalsy();
    expect(o.advanced?.disableOriginCheck).toBeFalsy();
    expect(o.advanced?.crossSubDomainCookies?.enabled ?? false).toBe(false);
    expect(o.trustedOrigins).toEqual(['https://app.qa.test']);
  });

  it('the database is the routing pool, not a pool or dialect we construct  [red if: options.database is a PostgresDialect or a drizzle adapter]', () => {
    expect(typeof o.database?.connect).toBe('function');
    expect(typeof o.database?.query).toBe('function');
  });

  it('there is no test or relaxation switch: the options are identical for a given input regardless of the environment  [red if: authOptions reads process.env (S18)]', () => {
    const snap = () => JSON.stringify(authOptions(input), (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const before = snap();
    process.env.E2E = '1';
    process.env.POLY_TEST = '1';
    try { expect(snap()).toBe(before); } finally { delete process.env.E2E; delete process.env.POLY_TEST; }
  });
});

describe('image rule (criterion 15, S16b)', () => {
  const bad = ['https://evil.example/a.png', '/avatar.png', '/\\evil.example', '//evil.example/a.png', 'data:image/png;base64,AA', 'javascript:alert(1)'];
  for (const when of ['create', 'update'] as const)
    it(`user.${when}.before nulls every image value until upload exists  [red if: a provider picture URL or a path is stored (CSP img-src 'self' blocks it)]`, async () => {
      for (const image of bad) expect((await hook('user', when, { name: 'n', image })).image, image).toBeNull();
      expect((await hook('user', when, { name: 'keep' })).name).toBe('keep');
    });
});
