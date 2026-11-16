// POLY-89c (ruling 89ff3c8d, R3 #1). The BetterAuth-facing half: hook behaviour measured against the pinned 1.7.18, and
// the HTTP flows. Every title ends [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, post, teardown, type Env } from './helpers/auth';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

describe('C3/C9 the enrolment class and the route policy (R3, R5)', () => {
  const body = async (r: Response) => JSON.stringify(await r.clone().json().catch(() => ({})));
  it('an unenrolled signed-in user with no live grant is refused 403 email_confirmation_required on /two-factor/enable, not the flat second_step_required [red if: routePolicyHook still answers the flat refusal or never calls enrolment_grant_live()]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/two-factor/enable', { password: 'correct horse battery staple 1' }, cookie));
    expect(r.status).toBe(403);
    expect(await body(r)).toContain('email_confirmation_required');
  });
  it('/passkey/verify-registration with createSession is refused 400 before any grant check [red if: the enrolment class does not refuse body.createSession (S16)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/passkey/verify-registration', { response: {}, createSession: true }, cookie));
    expect(r.status).toBe(400);
  });
  it('/two-factor/enable refuses any method other than totp with 400 [red if: method otp is allowed through (S17)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/two-factor/enable', { password: 'correct horse battery staple 1', method: 'otp' }, cookie));
    expect(r.status).toBe(400);
  });
  it('createAuth refuses to start when twoFactor is given otpOptions [red if: the startup refusal is absent (S17)]', async () => {
    await expect(e.mk('real-domain', (o) => {
      const p = o.plugins.find((x: any) => x.id === 'two-factor');
      p.options = { ...(p.options ?? {}), otpOptions: { sendOTP: async () => {} } };
      return o;
    })).rejects.toThrow(/otp/i);
  });
  it('the anchor class exists: /second-step/send-code and /second-step/confirm-code are routes of a fifth class, "anchor", each needing a session [red if: AUTH_ROUTES lacks them]', async () => {
    const u = e.seedUser();
    const anon = await e.handle(post('/second-step/send-code', { password: 'x' }));
    expect(anon.status).toBe(401);
    const { cookie } = await e.signIn(u.email);
    const authed = await e.handle(post('/second-step/confirm-code', { code: '000000' }, cookie));
    expect([200, 400, 403]).toContain(authed.status); // never 404: the route exists
  });
  it.todo('C3: enrolment needs the password plus a confirmed emailed code; a wrong password, a wrong code or an expired code leaves the factor inactive (second_step_at NULL, two_factor_enabled false)');
  it.todo('C4: a new device is held for the factor; a known device within its session is not; step-up routes always prompt; a completed first enrolment counts as the step-up');
  it.todo('C5: a TOTP and a passkey each satisfy the step; Google and GitHub sign-in satisfy neither and never stamp recent_auth_at');
  it.todo('C15: the first TOTP verify can rotate the session: BetterAuth\'s session INSERT (copy of the old row) succeeds because session.create.before strips recentAuthAt, and the new row is stamped');
  it.todo('C1 (e2e, apps/web/tests/e2e): a new user whose only entity is the own Person signs in at /sign-in and reaches /dashboard with no redirect');
  it.todo('C6 (e2e): after reset-mfa a manager signs in and every page redirects to /settings/second-step');
});

describe('R3 #1 the unmeasured claim: userUpdateBefore data replaces BetterAuth\'s update', () => {
  // MEASUREMENT, not a build test. twoFactorEnabled cannot be driven yet (the enrolment class is a flat 403 today), so the
  // same mechanism is measured on /update-user: a patched user.update.before drops `name` (as R3 #1's hook drops
  // twoFactorEnabled) and we read what BetterAuth wrote. Green today means the ruling's claim holds.
  const run = async (shape: (data: any) => any) => {
    const auth = await e.mk('real-domain', (o) => {
      o.databaseHooks.user.update.before = async (data: any) => ({ data: shape(data) });
      return o;
    });
    const u = e.seedUser({ name: 'Before' });
    const { cookie } = await e.signIn(u.email, auth);
    const res = await e.handle(post('/update-user', { name: 'After' }, cookie), auth);
    const row = must(`SELECT name, updated_at FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]!;
    return { status: res.status, name: row[0], updatedAt: row[1] };
  };
  // FINDING (better-auth 1.7.18 db/with-hooks.mjs:56): `actualData = {...actualData, ...result.data}`. The returned data is
  // MERGED over the original, so a hook that merely omits a key does not remove it. The ruling's claim is false as worded.
  it('MEASURED: a hook returning data without a key does NOT remove it; the original value is still written [red if: 1.7.18 stops merging]', async () => {
    const r = await run(() => ({ updatedAt: new Date('2031-01-02T03:04:05Z') }));
    expect(r.name).toBe('After');
  });
  it('MEASURED: a hook returning the key as undefined leaves the column untouched and the route still answers [red if: the adapter writes undefined as NULL or errors]', async () => {
    const r = await run(() => ({ name: undefined, updatedAt: new Date('2031-01-02T03:04:05Z') }));
    expect(r.status).toBe(200);
    expect(r.name).toBe('Before');
    expect(r.updatedAt).toContain('2031-01-02');
  });
});
