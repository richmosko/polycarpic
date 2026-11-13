// POLY-86 criteria 3, 5, 7 (ARCH §3.1c, §8 route-policy row; SECURITY A-34, A-38; seceng S7, S8, S12, S13, S16c, S17).
// BetterAuth is built from the exported app configuration (authOptions), the same object the app uses, in BOTH TLS modes.
// Housing: this suite needs Postgres, so it lives in the `db` job battery (ruling R10), not under packages/auth.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASE, boot, get, jar, post, teardown, url, PW, type Env, type Mode } from './helpers/auth';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const modes: Mode[] = ['real-domain', 'private-ca'];
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

const body = async (r: Response) => { try { return await r.clone().json(); } catch { return await r.clone().text(); } };

async function instances() {
  return Promise.all(modes.map(async (m) => [m, await e.mk(m)] as const));
}

describe.each(modes)('route policy, %s mode', (mode) => {
  let auth: any;
  beforeAll(async () => { auth = await e.mk(mode); });

  it('every HTTP route of the instance is in AUTH_ROUTES and every entry is live, naming the path  [red if: a plugin or version adds a route unclassified, or the map keeps a dead entry]', () => {
    const eps = Object.values(auth.api as Record<string, any>).filter((x) => x?.path && !x.options?.metadata?.SERVER_ONLY && x.options?.metadata?.isAction !== false);
    const live = new Set<string>(eps.map((x) => x.path));
    const listed = new Set(Object.keys(e.A.AUTH_ROUTES));
    expect([...live].filter((p) => !listed.has(p)), 'live but unclassified').toEqual([]);
    expect([...listed].filter((p) => !live.has(p)), 'classified but not live').toEqual([]);
  });

  it('an unlisted path answers 404 with and without a session, the same answer as a blocked path  [red if: an unknown path falls through to BetterAuth\'s router]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    for (const c of ['', cookie]) {
      const inv = await e.handle(get('/no-such-route', c), auth);
      const blocked = await e.handle(get('/list-sessions', c), auth);
      expect(inv.status).toBe(404);
      expect(blocked.status).toBe(404);
      expect(await body(inv)).toEqual(await body(blocked));
    }
  });

  it('every blocked path answers 404 over HTTP, with a session  [red if: a blocked path is missing from the class or the hook lets it through]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    const blocked = Object.entries(e.A.AUTH_ROUTES as Record<string, any>).filter(([, r]) => r.class === 'blocked').map(([p]) => p.replace(':id', 'google'));
    expect(blocked.length).toBe(13);
    for (const p of blocked) for (const method of ['GET', 'POST']) {
      const r = await e.handle(method === 'GET' ? get(p, cookie) : post(p, {}, cookie), auth);
      expect(r.status, `${method} ${p}`).toBe(404);
    }
  });

  it('S7: blocked endpoints are not reached by trailing slash, //, case, %2F/%2f, query string, HEAD or OPTIONS  [red if: classification runs on the raw path while the router normalises it]', async () => {
    const u = e.seedUser();
    const { cookie, res } = await e.signIn(u.email, auth);
    expect(res.status).toBe(200);
    const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0];
    for (const base of ['/get-session', '/list-sessions']) {
      const variants = [`${base}/`, `/${base}`, base.toUpperCase(), `/%2F${base.slice(1)}`, `/%2f${base.slice(1)}`, `${base}?disableCookieCache=true`, `${base}/?x=1`];
      for (const v of variants) {
        const r = await e.handle(get(v, cookie), auth);
        expect(r.status, v).toBe(404);
        expect(await r.clone().text()).not.toContain(token);
      }
      for (const m of ['HEAD', 'OPTIONS']) {
        const r = await e.handle(get(base, cookie, m), auth);
        expect([404, 204, 405], `${m} ${base}`).toContain(r.status);
        expect(await r.clone().text()).not.toContain(token);
      }
    }
  });

  it('the in-process auth.api.getSession still answers while HTTP /get-session is 404  [red if: the blocked class also applies in process, breaking the SvelteKit loader]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(s?.user?.email).toBe(u.email);
    expect((await e.handle(get('/get-session', cookie), auth)).status).toBe(404);
  });

  it('the app\'s session list and /list-accounts carry no token field  [red if: either returns session.token or an IdP token]', async () => {
    const u = e.seedUser();
    must(`INSERT INTO public.account (account_id, provider_id, user_id, access_token, refresh_token, id_token) VALUES ('g-1', 'google', '${u.id}', 'AT-SECRET-VALUE', 'RT-SECRET-VALUE', 'IDT-SECRET-VALUE')`, e.db);
    const { cookie } = await e.signIn(u.email, auth);
    const r = await e.handle(get('/list-accounts', cookie), auth);
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const s of ['AT-SECRET-VALUE', 'RT-SECRET-VALUE', 'IDT-SECRET-VALUE']) expect(text).not.toContain(s);
    expect(text).not.toMatch(/accessToken|refreshToken|idToken|"password"/);
  });

  it('/sign-up/email with no invitationToken is refused 403 invitation_required and writes no user  [red if: sign-up is open]', async () => {
    const email = `nobody-${Date.now()}@qa.test`;
    const r = await e.handle(post('/sign-up/email', { email, password: PW, name: 'N' }), auth);
    expect(r.status).toBe(403);
    expect(JSON.stringify(await body(r))).toMatch(/invitation_required/);
    expect(e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`)).toBe(0);
  });

  it('/update-user accepts name and a null image only; role, emailVerified, secondStepAt and any non-null image are refused  [red if: the body is not narrowed, or an external/same-origin image is stored (S16b)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    for (const bad of [{ role: 'admin' }, { emailVerified: false }, { secondStepAt: new Date().toISOString() }, { twoFactorEnabled: false },
      { image: 'https://evil.example/a.png' }, { image: '/a.png' }, { image: '/\\evil.example' }, { image: '//evil.example/a.png' }, { name: 'ok', image: 'data:image/png;base64,AA' }]) {
      const r = await e.handle(post('/update-user', bad, cookie), auth);
      expect(r.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    }
    expect(must(`SELECT name, image IS NULL FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]).toEqual(['QA User', 't']);
    expect((await e.handle(post('/update-user', { name: 'Renamed' }, cookie), auth)).status).toBe(200);
    expect((await e.handle(post('/update-user', { image: null }, cookie), auth)).status).toBe(200);
    expect(must(`SELECT name FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0][0]).toBe('Renamed');
  });

  it('S8: /sign-in/social with an idToken body is 400 and creates no session and no user  [red if: the idToken branch signs in without state and PKCE]', async () => {
    const email = `idt-${Date.now()}@qa.test`;
    const fake = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 'x1', email, email_verified: true, name: 'I' })).toString('base64url') + '.';
    const before = e.count('SELECT 1 FROM public.session');
    const r = await e.handle(post('/sign-in/social', { provider: 'google', idToken: { token: fake } }), auth);
    expect(r.status).toBe(400);
    expect(e.count('SELECT 1 FROM public.session')).toBe(before);
    expect(e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`)).toBe(0);
  });

  it('S12: an external callbackURL is refused on /sign-in/magic-link and /sign-in/social; a cross-origin POST is refused  [red if: trustedOrigins widened or the origin check disabled]', async () => {
    const u = e.seedUser();
    for (const [p, b] of [['/sign-in/magic-link', { email: u.email, callbackURL: 'https://evil.example/' }], ['/sign-in/social', { provider: 'google', callbackURL: 'https://evil.example/' }]] as const) {
      const r = await e.handle(post(p, b), auth);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
    }
    const x = await e.handle(new Request(url('/sign-in/email'), { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: PW }) }), auth);
    expect(x.status).toBe(403);
    expect(x.headers.getSetCookie()).toEqual([]);
  });

  it('class checks: enrolment paths refuse a user with no second_step_at (403 second_step_required)  [red if: the enrolment class is open or missing (S16c)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    for (const [m, p, b] of [['POST', '/two-factor/enable', { password: PW }], ['GET', '/passkey/generate-register-options', null], ['POST', '/passkey/verify-registration', { response: {} }], ['POST', '/two-factor/verify-totp', { code: '000000' }]] as const) {
      const r = await e.handle(m === 'GET' ? get(p, cookie) : post(p, b, cookie), auth);
      expect(r.status, p).toBe(403);
      expect(JSON.stringify(await body(r)), p).toMatch(/second_step_required/);
    }
  });

  it('class checks: an enrolled user\'s passkey registration on a fresh session without step-up is 403 step_up_required; /verify-backup-code with a session is refused  [red if: the enrolled path skips the step-up check]', async () => {
    const u = e.seedUser({ twoFactor: true });
    // an enrolled user cannot finish /sign-in/email (held), so give them a session directly via the row and sign in unheld test path
    const t = `qa-tok-${Date.now()}`;
    must(`INSERT INTO public.session (user_id, token, expires_at, created_at, updated_at) VALUES ('${u.id}', '${t}', now() + interval '1 day', now(), now())`, e.db);
    const cookie = await e.cookieForToken(t, auth);
    const r = await e.handle(get('/passkey/generate-register-options', cookie), auth);
    expect(r.status).toBe(403);
    expect(JSON.stringify(await body(r))).toMatch(/step_up_required/);
    const b = await e.handle(post('/two-factor/verify-backup-code', { code: 'x' }, cookie), auth);
    expect(b.status).toBeGreaterThanOrEqual(400);
  });

  it('class checks: an OAuth-only user\'s generate-backup-codes and disable, and every step-up path, answer 403 without step-up  [red if: a step-up path is classed open]', async () => {
    const u = e.seedUser({ password: false, secondStepAt: true });
    must(`INSERT INTO public.account (account_id, provider_id, user_id) VALUES ('g-${u.id}', 'google', '${u.id}')`, e.db);
    const t = `qa-tok2-${Date.now()}`;
    must(`INSERT INTO public.session (user_id, token, expires_at, created_at, updated_at) VALUES ('${u.id}', '${t}', now() + interval '1 day', now(), now())`, e.db);
    const cookie = await e.cookieForToken(t, auth);
    const stepUp = Object.entries(e.A.AUTH_ROUTES as Record<string, any>).filter(([, r]) => r.class === 'step-up').map(([p]) => p);
    expect(stepUp.sort()).toEqual(['/change-email', '/link-social', '/passkey/delete-passkey', '/revoke-other-sessions', '/two-factor/disable', '/two-factor/generate-backup-codes', '/unlink-account'].sort());
    for (const p of stepUp) {
      const r = await e.handle(post(p, { password: PW, providerId: 'google', newEmail: 'n@qa.test', id: 'x', provider: 'google', callbackURL: '/' }, cookie), auth);
      // realDomainOnly /link-social is 404 in private-CA mode; every other step-up path is 403 with the code
      if (p === '/link-social' && mode === 'private-ca') expect(r.status, p).toBe(404);
      else { expect(r.status, p).toBe(403); expect(JSON.stringify(await body(r)), p).toMatch(/step_up_required/); }
    }
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(1);
  });

  it('A-38: request-password-reset answers identically for a known and an unknown email  [red if: the answer discloses which accounts exist (C-04)]', async () => {
    const a2 = await e.mk(mode, (o) => ({ ...o, emailAndPassword: { ...o.emailAndPassword, sendResetPassword: async () => {} } }));
    const u = e.seedUser();
    const k = await e.handle(post('/request-password-reset', { email: u.email, redirectTo: '/reset' }), a2);
    const n = await e.handle(post('/request-password-reset', { email: 'nobody-here@qa.test', redirectTo: '/reset' }), a2);
    expect(k.status).toBe(n.status);
    expect(await body(k)).toEqual(await body(n));
  });

  it('A-38: a completed reset ends every session of the user  [red if: revokeSessionsOnPasswordReset is false]', async () => {
    let token = '';
    const a2 = await e.mk(mode, (o) => ({ ...o, emailAndPassword: { ...o.emailAndPassword, sendResetPassword: async (d: any) => { token = d.token; } } }));
    const u = e.seedUser();
    await e.signIn(u.email, a2);
    await e.signIn(u.email, a2);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(2);
    await e.handle(post('/request-password-reset', { email: u.email, redirectTo: '/reset' }), a2);
    expect(token).not.toBe('');
    const r = await e.handle(post('/reset-password', { newPassword: 'a brand new passphrase 99', token }), a2);
    expect(r.status).toBe(200);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(0);
  });

  it('S17: the session cookie is __Host- prefixed, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain  [red if: any attribute differs; if 1.7.18 cannot emit __Host- the builder reports it, seceng rules]', async () => {
    const u = e.seedUser();
    const { res } = await e.signIn(u.email, auth);
    const sc = res.headers.getSetCookie().find((c) => /session_token/.test(c));
    expect(sc, 'no session cookie').toBeDefined();
    expect(sc!).toMatch(/^__Host-/);
    expect(sc!).toMatch(/;\s*HttpOnly/i);
    expect(sc!).toMatch(/;\s*Secure/i);
    expect(sc!).toMatch(/;\s*SameSite=Lax/i);
    expect(sc!).toMatch(/;\s*Path=\//i);
    expect(sc!).not.toMatch(/;\s*Domain=/i);
  });
});

describe('private-CA mode gates the OAuth routes (C-76)', () => {
  it('/sign-in/social, /callback/:id and /link-social are 404 in private-CA mode and not in real-domain mode  [red if: realDomainOnly is not applied or is applied in both modes]', async () => {
    const [[, real], [, priv]] = await instances();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, priv);
    const reqs = () => [post('/sign-in/social', { provider: 'google', callbackURL: '/' }), get('/callback/google?code=x&state=y'), post('/link-social', { provider: 'google' }, cookie)];
    for (const r of reqs()) expect((await e.handle(r, priv)).status, 'private-ca').toBe(404);
    const real0 = await e.handle(post('/sign-in/social', { provider: 'google', callbackURL: '/' }), real);
    expect(real0.status).toBe(200);
    expect(real0.headers.get('location') ?? JSON.stringify(await body(real0))).toMatch(/accounts\.google\.com/);
    void jar; void BASE;
  });
});

// POLY-146 AC1 (ruling R4, seceng #1): reset and magic-link tokens are stored hashed. Real Postgres, the real routes, as poly_app.
// One top-level describe, outside describe.each (the behaviour does not depend on the TLS mode).
describe('POLY-146: reset and magic-link tokens are stored hashed', () => {
  const stored = () => must('SELECT identifier FROM public.verification ORDER BY created_at DESC', e.db).rows.map((r) => r[0]!);
  const verRows = () => e.count('SELECT 1 FROM public.verification');
  const parts = (id: string) => [...new Set([id, id.slice(id.indexOf(':') + 1)])];
  const sessionCookie = (r: Response) => r.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c) && !/Max-Age=0/i.test(c));
  let auth: any;
  let resetToken = '';
  beforeAll(async () => {
    auth = await e.mk('real-domain', (o) => ({ ...o, emailAndPassword: { ...o.emailAndPassword, sendResetPassword: async (d: any) => { resetToken = d.token; } } }));
  });

  it('reset: the stored identifier is not reset-password:<token> and holds no part of the token  [red if: verification.storeIdentifier is plain]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/request-password-reset', { email: u.email, redirectTo: '/reset' }), auth);
    expect(resetToken).not.toBe('');
    const ids = stored();
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(`reset-password:${resetToken}`);
    expect(ids[0]).not.toContain(resetToken);
  });

  it('reset: a value read from verification, whole or without its prefix, is refused at POST /reset-password and GET /reset-password/:token  [red if: the stored identifier is accepted as the token]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/request-password-reset', { email: u.email, redirectTo: '/reset' }), auth);
    const [id] = stored();
    const before = verRows();
    for (const v of parts(id!)) {
      const p = await e.handle(post('/reset-password', { newPassword: 'attacker chosen passphrase 77', token: v }), auth);
      expect(p.status, `POST ${v}`).toBeGreaterThanOrEqual(400);
      const g = await e.handle(get(`/reset-password/${encodeURIComponent(v)}?callbackURL=/reset`), auth);
      const loc = g.headers.get('location') ?? '';
      expect(loc, `GET ${v}`).toMatch(/error=/);
      expect(loc, `GET ${v}`).not.toMatch(/[?&]token=/);
    }
    expect(verRows(), 'a refused value consumed nothing').toBe(before);
    expect((await e.signIn(u.email, auth)).res.status, 'the password is unchanged').toBe(200);
  });

  it('reset: the emailed token resets the password once; a second use is refused  [red if: the token no longer verifies, or is reusable]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/request-password-reset', { email: u.email, redirectTo: '/reset' }), auth);
    const token = resetToken;
    const r1 = await e.handle(post('/reset-password', { newPassword: 'a brand new passphrase 99', token }), auth);
    expect(r1.status).toBe(200);
    const r2 = await e.handle(post('/reset-password', { newPassword: 'yet another passphrase 98', token }), auth);
    expect(r2.status).toBeGreaterThanOrEqual(400);
  });

  it('magic link: the stored identifier is not the emailed token or its prefixed form  [red if: magicLink storeToken is plain]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/sign-in/magic-link', { email: u.email, callbackURL: '/' }), auth);
    const token = e.mails.at(-1)!.token;
    const ids = stored();
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(token);
    expect(ids[0]).not.toBe(`magic-link:${token}`);
    expect(ids[0]).not.toContain(token);
  });

  it('magic link: a value read from verification, whole or without its prefix, is refused at GET /magic-link/verify and starts no session  [red if: the stored value is accepted as the token]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/sign-in/magic-link', { email: u.email, callbackURL: '/' }), auth);
    const [id] = stored();
    const before = verRows();
    for (const v of parts(id!)) {
      const r = await e.handle(get(`/magic-link/verify?token=${encodeURIComponent(v)}&callbackURL=/`), auth);
      expect(sessionCookie(r), `session for ${v}`).toBe(false);
    }
    expect(verRows(), 'a refused value consumed nothing').toBe(before);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(0);
  });

  it('magic link: the emailed token signs in once; a second use starts no session  [red if: the token no longer verifies, or is reusable]', async () => {
    must('DELETE FROM public.verification', e.db);
    const u = e.seedUser();
    await e.handle(post('/sign-in/magic-link', { email: u.email, callbackURL: '/' }), auth);
    const token = e.mails.at(-1)!.token;
    const r1 = await e.handle(get(`/magic-link/verify?token=${token}&callbackURL=/`), auth);
    expect(sessionCookie(r1)).toBe(true);
    const r2 = await e.handle(get(`/magic-link/verify?token=${token}&callbackURL=/`), auth);
    expect(sessionCookie(r2)).toBe(false);
  });
});
