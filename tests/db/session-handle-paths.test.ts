// POLY-153 R5 (the 13 session paths of the spike's check-handle.mjs), R8 (cookie scope), C4, C5. Each path runs as poly_auth through
// handleAuthRequest (the real transaction wrappers). What each path must do with the handle is the ruling's table. Titles end
// [red if: <mutation>]. Red today: no handle cookie, BetterAuth's cookies are __Host-/Path=/ (real-domain) and no app.session_handle.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { age, hasSessionCookie as hasSession, heldSignIn } from './helpers/auth-service';
import { HANDLE_COOKIE, ENTER_SESSION, handleOf, handleSetCookie } from './helpers/handle';
import { tx } from './helpers/auth-tx';
import { seedInvitation } from './helpers/invitation';
import { codeOf, fails, msgOf, totp } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

const sha = (h: string) => createHash('sha256').update(h, 'utf8').digest('hex');
const rowOf = (handle: string) => must(`SELECT session_id FROM app.session_handle WHERE handle_hash = decode('${sha(handle)}', 'hex')`, e.db).rows[0]?.[0] ?? null;
const handleRows = () => e.count('SELECT 1 FROM app.session_handle');
const latestSession = (email: string) => must(`SELECT s.id FROM public.session s JOIN public."user" u ON u.id = s.user_id WHERE u.email = '${email}' ORDER BY s.created_at DESC LIMIT 1`, e.db).rows[0]?.[0] ?? null;
/** What poly_app's canonical entry does with this plain handle: the session id it enters, or null when refused. */
const enters = (handle: string) => tx(e.db, 'poly_app', async (q) => { const x = await fails(q(ENTER_SESSION, [handle])); if (x) { expect(codeOf(x)).toBe('42501'); expect(msgOf(x)).toMatch(/no live session/); return null; } return (await q('SELECT app.current_session_id() AS s')).rows[0].s as string; });
/** A new sign-in (or sign-up) response: a new handle, whose sha256 maps to the new session, which poly_app's entry yields. */
async function expectNewHandle(res: Response, email: string) {
  expect(res.status).toBeLessThan(400);
  const h = handleOf(res);
  expect(h ?? '', 'a handle cookie must be set').toMatch(/^[A-Za-z0-9_-]{43}$/);
  const sid = latestSession(email);
  expect(rowOf(h!)).toBe(sid);
  expect(await enters(h!)).toBe(sid);
  return h!;
}
const betterAuthCookies = (res: Response) => res.headers.getSetCookie().filter((c) => !c.startsWith(`${HANDLE_COOKIE}=`));

describe('sign-in and sign-up: a new handle for the new session', () => {
  it('email [red if: the plugin does not run on /sign-in/email]', async () => {
    const u = e.seedUser(); const { res } = await e.signIn(u.email);
    await expectNewHandle(res, u.email);
  });
  it('magic-link [red if: the plugin misses /magic-link/verify]', async () => {
    const u = e.seedUser(); const sent: { token: string }[] = [];
    const a = await (async () => { const o: any = e.optionsOf('real-domain', { sendMagicLink: async (m: any) => { sent.push(m); } }); o.rateLimit = { enabled: false }; return e.A.createAuth(o); })();
    await e.handle(post('/sign-in/magic-link', { email: u.email }), a);
    await expectNewHandle(await e.handle(get(`/magic-link/verify?token=${sent[0]!.token}&callbackURL=/`), a), u.email);
  });
  it('oauth-callback [red if: the plugin misses /callback/:id]', async () => {
    const u = e.seedUser({ password: false });
    await expectNewHandle(await e.oauth(u.email, await e.mk()), u.email);
  });
  it('sign-up [red if: the plugin misses /sign-up/email]', async () => {
    const email = `su-${Math.random().toString(36).slice(2)}@qa.test`;
    const invitationToken = seedInvitation({ db: e.db, email, role: 'viewer' });
    await expectNewHandle(await e.handle(post('/sign-up/email', { email, password: PW, name: 'Signup', invitationToken })), email);
  });
  it('passkey-sign-in [red if: the plugin misses /passkey/verify-authentication]', async () => {
    const u = e.seedUser(); const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${u.id}'`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'));
    const opt: any = await g.clone().json();
    await expectNewHandle(await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g))), u.email);
  });
});

describe('second factor after a hold: the hold sets no handle and leaves no row; the verify sets one', () => {
  async function enrolled() {
    const auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
    const u = e.seedUser();
    const first = await e.signIn(u.email, auth); // a not-yet-enrolled user signs in straight through
    let cookie = first.cookie; mails.length = 0;
    expect((await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth)).status).toBe(200);
    const code = mails.find((m) => m.email.toLowerCase() === u.email.toLowerCase())!.code;
    expect((await e.handle(post('/second-step/confirm-code', { code }, cookie), auth)).status).toBe(200);
    const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
    const j: any = await en.clone().json();
    const secret = new URL(j.totpURI).searchParams.get('secret')!;
    const ver = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, cookie), auth);
    expect(ver.status).toBe(200);
    return { auth, u, secret, backupCodes: (j.backupCodes ?? []) as string[], firstHandle: handleOf(first.res)!, verifyRes: ver, cookie: jar(cookie, ver) };
  }
  it('totp-first-verify rotation: a new handle for the new session, the old handle refused [red if: the rotation keeps or loses the handle]', async () => {
    const { u, firstHandle, verifyRes } = await enrolled();
    const nh = await expectNewHandle(verifyRes, u.email);
    expect(nh).not.toBe(firstHandle);
    expect(await enters(firstHandle)).toBeNull();
  });
  it('/two-factor/verify-totp after a hold: the held sign-in sets no handle and adds no handle row; the verify sets one [red if: the hold issues a handle]', async () => {
    const { auth, u, secret } = await enrolled();
    const n0 = handleRows();
    const held = await heldSignIn(e, auth, u.email);
    expect(handleOf(held.res)).toBeNull(); // no handle issued; a clearing cookie is allowed (R5.1)
    expect(handleRows()).toBe(n0);
    const r = await e.handle(post('/two-factor/verify-totp', { code: totp(secret, Date.now() + 30_000) }, held.cookie), auth);
    await expectNewHandle(r, u.email);
  });
  it('/two-factor/verify-backup-code after a hold: same [red if: same]', async () => {
    const { auth, u, backupCodes } = await enrolled();
    const n0 = handleRows();
    const held = await heldSignIn(e, auth, u.email);
    expect(handleOf(held.res)).toBeNull(); // no handle issued; a clearing cookie is allowed (R5.1)
    expect(handleRows()).toBe(n0);
    await expectNewHandle(await e.handle(post('/two-factor/verify-backup-code', { code: backupCodes[0] }, held.cookie), auth), u.email);
  });
  it('two-factor-disable rotation: a new handle, the old refused [red if: the rotation keeps or loses the handle]', async () => {
    const { auth, u, cookie, verifyRes } = await enrolled();
    const old = handleOf(verifyRes)!;
    const r = await e.handle(post('/two-factor/disable', { password: PW }, cookie), auth);
    expect(r.status).toBe(200);
    const nh = await expectNewHandle(r, u.email);
    expect(nh).not.toBe(old);
    expect(await enters(old)).toBeNull();
  });
  it('a held sign-in answered with the TOTP hold issues no handle (a clearing cookie is allowed, R5.1) [red if: a hold carries a handle]', async () => {
    const { auth, u } = await enrolled();
    const held = await heldSignIn(e, auth, u.email);
    expect(betterAuthCookies(held.res).some((c) => /two_factor/.test(c))).toBe(true);
    expect(handleOf(held.res)).toBeNull();
  });
  it('a hold clears an EARLIER handle cookie: A signs in, then B\'s sign-in in the same jar stops at the second step; the response clears __Host-poly_handle and the browser jar no longer holds A\'s handle, so web cannot enter [red if: the hold leaves the earlier handle cookie in the browser, which keeps A signed in to web]', async () => {
    const { auth, u: b } = await enrolled();
    const a = e.seedUser();
    const first = await e.signIn(a.email, auth);
    const aHandle = handleOf(first.res)!;
    expect(await enters(aHandle)).toBe(latestSession(a.email));
    const held = await e.handle(post('/sign-in/email', { email: b.email, password: PW }, first.cookie), auth);
    expect(betterAuthCookies(held).some((c) => /two_factor/.test(c)), 'B must be held at the second step').toBe(true);
    expect(hasSession(held)).toBe(false);
    expect(handleSetCookie(held), 'the hold clears the handle cookie').toMatch(/^__Host-poly_handle=;.*Max-Age=0/i);
    // the browser applies the response to its jar: with the handle cookie gone, web has nothing to enter by, so A is signed out of web
    expect(jar(first.cookie, held), 'A\'s browser jar after the hold must hold no handle cookie').not.toContain('__Host-poly_handle');
  });
});

describe('rotations by password change, passkey registration, refresh and sign-out', () => {
  it('change-password with revokeOtherSessions: a new handle for the new session; the other sessions\' handles are refused [red if: a revoked session\'s handle still enters]', async () => {
    const u = e.seedUser(); const a = await e.signIn(u.email); const b = await e.signIn(u.email);
    const ha = handleOf(a.res)!; const hb = handleOf(b.res)!;
    const r = await e.handle(post('/change-password', { currentPassword: PW, newPassword: `${PW} 2`, revokeOtherSessions: true }, a.cookie));
    expect(r.status).toBe(200);
    const nh = await expectNewHandle(r, u.email);
    expect(nh).not.toBe(ha);
    expect(await enters(ha)).toBeNull();
    expect(await enters(hb)).toBeNull();
  });
  it('passkey-register-session (createSession: true) is refused and sets no handle [red if: the route issues a session without a handle]', async () => {
    const u = e.seedUser(); const a = await e.signIn(u.email); const n0 = handleRows();
    const r = await e.handle(post('/passkey/verify-registration', { response: {}, createSession: true }, a.cookie));
    expect(r.status).toBe(400);
    expect(handleSetCookie(r)).toBeUndefined();
    expect(handleRows()).toBe(n0);
  });
  it('refresh: an /api/auth request after updateAge sets no handle cookie and the existing handle still enters [red if: refresh re-issues or loses the handle]', async () => {
    const u = e.seedUser(); const a = await e.signIn(u.email); const h = handleOf(a.res)!;
    age(e, u.id, { updatedDaysAgo: 2 });
    const r = await e.handle(get('/list-accounts', a.cookie));
    expect(r.status).toBe(200);
    expect(handleSetCookie(r)).toBeUndefined();
    expect(await enters(h)).toBe(latestSession(u.email));
  });
  it('sign-out: the handle row is gone in that transaction and the handle cookie is cleared [red if: the handle outlives its session or stays in the browser]', async () => {
    const u = e.seedUser(); const a = await e.signIn(u.email); const h = handleOf(a.res)!;
    const sid = latestSession(u.email);
    const r = await e.handle(post('/sign-out', {}, a.cookie));
    expect(r.status).toBe(200);
    expect(rowOf(h)).toBeNull();
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${sid}'`)).toBe(0);
    expect(handleSetCookie(r)).toMatch(/^__Host-poly_handle=;.*Max-Age=0/i);
    expect(await enters(h)).toBeNull();
  });
});

describe('R5.1 the handle cookie and R8 the cookie scope', () => {
  it('the handle cookie is __Host-poly_handle, Path=/, HttpOnly, Secure, SameSite=Lax, no Domain, with Max-Age equal to the session cookie\'s [red if: any attribute differs]', async () => {
    const u = e.seedUser(); const { res } = await e.signIn(u.email);
    const hc = handleSetCookie(res)!;
    expect(hc).toBeDefined();
    for (const re of [/;\s*Path=\/(;|$)/i, /;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i]) expect(hc).toMatch(re);
    expect(hc).not.toMatch(/;\s*Domain=/i);
    const sc = res.headers.getSetCookie().find((c) => /session_token=[^;]/.test(c))!;
    const maxAge = (c: string) => /max-age=(\d+)/i.exec(c)?.[1];
    expect(maxAge(sc)).toBeDefined();
    expect(maxAge(hc)).toBe(maxAge(sc));
  });
  it('rememberMe:false gives neither cookie a Max-Age [red if: the handle outlives the browser session]', async () => {
    const u = e.seedUser();
    const res = await e.handle(post('/sign-in/email', { email: u.email, password: PW, rememberMe: false }));
    expect(res.status).toBe(200);
    expect(handleSetCookie(res)).toBeDefined();
    for (const c of res.headers.getSetCookie().filter((c) => /session_token=[^;]|poly_handle=[^;]/.test(c))) expect(c).not.toMatch(/max-age/i);
  });
  it('every BetterAuth Set-Cookie on the sign-in, hold, verify and sign-out paths is __Secure-better-auth.* at Path=/api/auth, Secure, HttpOnly, Lax [red if: a cookie keeps the old prefix or Path=/]', async () => {
    const u = e.seedUser(); const a = await e.signIn(u.email);
    const out = await e.handle(post('/sign-out', {}, a.cookie));
    const seen = [...betterAuthCookies(a.res), ...betterAuthCookies(out)];
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) {
      expect(c, c).toMatch(/^__Secure-better-auth\./);
      expect(c, c).toMatch(/;\s*Path=\/api\/auth(;|$)/i);
      expect(c, c).toMatch(/;\s*Secure/i);
      expect(c, c).toMatch(/;\s*HttpOnly/i);
      expect(c, c).toMatch(/;\s*SameSite=Lax/i);
    }
  });
  it('the hold\'s two_factor cookie and the OAuth state cookie carry the same prefix and path [red if: the defaults leak through on a side cookie]', async () => {
    const auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async () => {} }), rateLimit: { enabled: false } });
    const u = e.seedUser({ twoFactor: true });
    const held = await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth);
    const hold = held.headers.getSetCookie().find((c) => /two_factor/.test(c))!;
    expect(hold).toMatch(/^__Secure-better-auth\./);
    expect(hold).toMatch(/;\s*Path=\/api\/auth(;|$)/i);
    const start = await e.handle(post('/sign-in/social', { provider: 'google', callbackURL: '/' }));
    for (const c of start.headers.getSetCookie()) { expect(c).toMatch(/^__Secure-better-auth\./); expect(c).toMatch(/;\s*Path=\/api\/auth(;|$)/i); }
  });
  it('authOptions fixes prefix and attributes itself: an AuthInput cannot change them [red if: they are input-controlled]', async () => {
    const o: any = e.A.authOptions({ ...e.input('real-domain'), advanced: { cookiePrefix: 'evil', defaultCookieAttributes: { path: '/' } } });
    expect(o.advanced.cookiePrefix).toBe('__Secure-better-auth');
    expect(o.advanced.defaultCookieAttributes).toMatchObject({ secure: true, sameSite: 'lax', path: '/api/auth', httpOnly: true });
  });
});
