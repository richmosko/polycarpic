// POLY-152 R7, seceng F2 / F3: a session cookie lives to the 30-day cap, the row is the 7-day idle bound, and the cap's clearing cookie
// carries the path the cookie was set on. Ages are row facts set through SQL (a fake clock would not move Postgres' now()).
// Red today: the cookie is 7 days (Max-Age 604800) and the cap branch hardcodes Path=/.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { age, expiresInDays, internal, internalReq, sessionRows } from './helpers/auth-service';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
// the service modules load per call, so a missing apps/auth fails each test (red), and never skips the suite through a failed beforeAll
const I = { handleInternal: async (r: Request, a: any) => (await internal()).handleInternal(r, a), handlePublic: async (r: Request, a: any) => (await internal()).handlePublic(r, a) };
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

const THIRTY = 30 * 86400;
const sessionCookie = (r: Response) => r.headers.getSetCookie().find((c) => /session_token=/.test(c) && !/session_token=;/.test(c));
const maxAge = (c: string | undefined) => { const m = c?.match(/max-age=(\d+)/i); return m ? Number(m[1]) : null; };

describe('C8 the cookie lives to the cap', () => {
  it('sign in at day 0: Max-Age is within 60 s of 30 days [red if: the cookie keeps BetterAuth\'s 7 days]', async () => {
    const u = e.seedUser();
    const { res } = await e.signIn(u.email);
    const ma = maxAge(sessionCookie(res));
    expect(ma).not.toBeNull();
    expect(Math.abs(ma! - THIRTY)).toBeLessThan(60);
  });
  it('rememberMe: false sets no Max-Age (the dont_remember case stays a session cookie) [red if: the plugin adds a Max-Age to it]', async () => {
    const u = e.seedUser();
    const res = await e.handle(post('/sign-in/email', { email: u.email, password: PW, rememberMe: false }));
    const c = sessionCookie(res);
    expect(c).toBeDefined();
    expect(maxAge(c)).toBeNull();
  });
  it('no Set-Cookie is added on /get-session or /sign-in/magic-link (no newSession) [red if: the plugin handler does not no-op]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const gs = await e.auth.handler(get('/get-session', cookie));
    expect(gs.headers.getSetCookie().filter((c) => /Max-Age=2592/.test(c))).toEqual([]);
    const ml = await e.handle(post('/sign-in/magic-link', { email: u.email }));
    expect(ml.headers.getSetCookie().filter((c) => /session_token/.test(c))).toEqual([]);
  });
});

describe('C8 the day tests (the row is the control)', () => {
  it('a request on day 6 slides expires_at to at least day 13, and a page on day 8 answers 200 with no new cookie [red if: the page path does not slide, or re-issues a cookie]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    age(e, u.id, { createdDaysAgo: 6, expiresInDays: 1, updatedDaysAgo: 5 });
    expect((await I.handleInternal(internalReq(cookie), e.auth)).status).toBe(200);
    expect(expiresInDays(e, u.id)).toBeGreaterThan(6.9);
    age(e, u.id, { createdDaysAgo: 8, updatedDaysAgo: 2 });
    const page = await I.handleInternal(internalReq(cookie), e.auth);
    expect(page.status).toBe(200);
    expect(page.headers.getSetCookie()).toEqual([]);
  });
  it('with no request after day 0, the day-8 page is refused [red if: the idle bound is not enforced]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    age(e, u.id, { createdDaysAgo: 8, expiresInDays: -1 });
    expect((await I.handleInternal(internalReq(cookie), e.auth)).status).toBe(204);
    expect(sessionRows(e, u.id)).toBe(0);
  });
  it('a fresh row\'s Max-Age counts from its own created_at (the true first-verify rotation value is UNMEASURED; the ruling asks the build to record it) [red if: Max-Age is not cap-relative]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    age(e, u.id, { createdDaysAgo: 10, expiresInDays: 1 });
    const r = await e.handle(post('/sign-out', {}, cookie));
    expect(r.status).toBeLessThan(500);
    const fresh = await e.signIn(u.email);
    const created = Number(must(`SELECT extract(epoch FROM (created_at + interval '30 days' - now())) FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at DESC LIMIT 1`, e.db).rows[0]![0]);
    expect(Math.abs(maxAge(sessionCookie(fresh.res))! - created)).toBeLessThan(60);
  });
});

describe('C7 the cap\'s clearing cookie', () => {
  it('carries the Path, Secure, SameSite and HttpOnly BetterAuth set it with, never a literal Path=/ when the cookie was set at /api/auth [red if: handler.ts hardcodes Path=/]', async () => {
    const auth = await e.mk('real-domain', (o) => { o.advanced = { ...(o.advanced ?? {}), defaultCookieAttributes: { ...(o.advanced?.defaultCookieAttributes ?? {}), path: '/api/auth' } }; return o; });
    const u = e.seedUser();
    const { cookie, res } = await e.signIn(u.email, auth);
    const set = sessionCookie(res)!;
    expect(set).toMatch(/Path=\/api\/auth/i);
    age(e, u.id, { createdDaysAgo: 31, expiresInDays: 3 });
    const out = await e.handle(get('/list-accounts', cookie), auth);
    const clear = out.headers.getSetCookie().find((c) => /session_token=;|session_token=($|;)/.test(c) || /max-age=0/i.test(c));
    expect(clear, 'the capped request must clear the cookie').toBeDefined();
    expect(clear).toMatch(/Path=\/api\/auth/i);
    expect(clear).not.toMatch(/Path=\/(;|$)/i);
    for (const attr of ['Secure', 'HttpOnly', 'SameSite']) if (new RegExp(attr, 'i').test(set)) expect(clear, attr).toMatch(new RegExp(attr, 'i'));
    expect(sessionRows(e, u.id)).toBe(0);
  });
});
void jar;
