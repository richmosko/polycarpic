// POLY-152 R6.2, seceng E3 / §1.2: the service's internal GET /session. The signed cookie is its only input. Red today: apps/auth does
// not exist. Titles end [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { age, expiresInDays, internal, internalReq, sessionRows, signed } from './helpers/auth-service';
import { tx } from './helpers/auth-tx';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
// the service modules load per call, so a missing apps/auth fails each test (red), and never skips the suite through a failed beforeAll
const I = { handleInternal: async (r: Request, a: any) => (await internal()).handleInternal(r, a), handlePublic: async (r: Request, a: any) => (await internal()).handlePublic(r, a) };
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

async function live() {
  const u = e.seedUser();
  const { cookie } = await e.signIn(u.email);
  const row = e.sessionRow(u.email)!;
  const name = cookie.split('=')[0]!;
  return { u, cookie, token: row[1] as string, sid: row[0] as string, name };
}
const body = async (r: Response) => (await r.clone().json()) as any;

describe('E3 what the listener answers', () => {
  it('a real signed cookie: 200 with exactly {userId, sessionId, name, image, expiresAt}, never the token, and no Set-Cookie [red if: the listener is absent or returns a token or a cookie]', async () => {
    const { u, cookie, token, sid } = await live();
    const r = await I.handleInternal(internalReq(cookie), e.auth);
    expect(r.status).toBe(200);
    const b = await body(r);
    expect(Object.keys(b).sort()).toEqual(['expiresAt', 'image', 'name', 'sessionId', 'userId']);
    expect(b.userId).toBe(u.id);
    expect(b.sessionId).toBe(sid);
    expect(JSON.stringify(b)).not.toContain(token);
    expect(r.headers.getSetCookie()).toEqual([]);
  });
  const bad: [string, (c: Awaited<ReturnType<typeof live>>) => string][] = [
    ['no cookie', () => ''],
    ['a valid token with a wrong-secret signature', (c) => `${c.name}=${encodeURIComponent(signed(c.token, 'another-secret-another-secret-123456'))}`],
    ['an unsigned raw token', (c) => `${c.name}=${encodeURIComponent(c.token)}`],
    ['a bare hex token', (c) => `${c.name}=${Buffer.from(c.token).toString('hex')}`],
    ['an empty signature (token.)', (c) => `${c.name}=${encodeURIComponent(`${c.token}.`)}`],
  ];
  for (const [name, mk] of bad) {
    it(`${name}: 204, and the row is neither deleted nor slid [red if: the service trusts a token without its signature]`, async () => {
      const c = await live();
      age(e, c.u.id, { expiresInDays: 5, updatedDaysAgo: 2 });
      const before = must(`SELECT expires_at, updated_at FROM public.session WHERE id = '${c.sid}'`, e.db).rows[0];
      const r = await I.handleInternal(internalReq(mk(c)), e.auth);
      expect(r.status).toBe(204);
      expect(r.headers.getSetCookie()).toEqual([]);
      expect(must(`SELECT expires_at, updated_at FROM public.session WHERE id = '${c.sid}'`, e.db).rows[0]).toEqual(before);
    });
  }
  it('another token\'s signature on this token: 204 [red if: the HMAC is not bound to the token]', async () => {
    const a = await live();
    const b = await live();
    const sigB = signed(b.token).slice(b.token.length);
    const r = await I.handleInternal(internalReq(`${a.name}=${encodeURIComponent(a.token + sigB)}`), e.auth);
    expect(r.status).toBe(204);
  });
  it('extra headers (x-user-id, x-session-id, authorization) and a query string change nothing: the answer is for the cookie\'s user [red if: any other input names a user]', async () => {
    const a = await live();
    const b = await live();
    const r = await I.handleInternal(internalReq(a.cookie, `/session?userId=${b.u.id}&token=${b.token}`, { headers: { 'x-user-id': b.u.id, 'x-session-id': b.sid, authorization: `Bearer ${b.token}` } }), e.auth);
    expect(r.status).toBe(404); // ruling R6.2: 404 to any query string
    const clean = await I.handleInternal(internalReq(a.cookie, '/session', { headers: { 'x-user-id': b.u.id } }), e.auth);
    expect(clean.status).toBe(200);
    expect((await body(clean)).userId).toBe(a.u.id);
  });
  it('a query string is refused outright: 404 [red if: the listener accepts a query]', async () => {
    const a = await live();
    expect((await I.handleInternal(internalReq(a.cookie, '/session?x=1'), e.auth)).status).toBe(404);
  });
  for (const [m, p] of [['POST', '/session'], ['PUT', '/session'], ['GET', '/'], ['GET', '/api/auth/ok'], ['GET', '/session/'], ['GET', '/session/x'], ['GET', '/SESSION'], ['GET', '/api/session'], ['GET', '/healthz-not']] as const)
    it(`${m} ${p}: 404 [red if: the listener serves any other path or method]`, async () => {
      const a = await live();
      const r = await I.handleInternal(internalReq(a.cookie, p, { method: m }), e.auth);
      expect(r.status).toBe(404);
    });
  it('the public listener serves nothing but /api/auth/*: /session, /, /healthz and /api/authx answer 404; /api/auth/ok answers 200 [red if: the public listener is not path-limited]', async () => {
    for (const p of ['/session', '/', '/api/session', '/api/authx', '/api/auth/../session'])
      expect((await I.handlePublic(new Request(`https://app.qa.test${p}`), e.auth)).status, p).toBe(404);
    expect((await I.handlePublic(new Request('https://app.qa.test/api/auth/ok'), e.auth)).status).toBe(200);
  });
});

describe('C8/§1.1 the idle bound, the cap and the slide, through the internal door', () => {
  it('day 6 of 7: the row slides to at least day 13 (≥ 6.9 days left) [red if: validation does not slide]', async () => {
    const c = await live();
    age(e, c.u.id, { expiresInDays: 1, updatedDaysAgo: 5 });
    expect((await I.handleInternal(internalReq(c.cookie), e.auth)).status).toBe(200);
    expect(expiresInDays(e, c.u.id)).toBeGreaterThan(6.9);
  });
  it('day 8 idle: 204, and the expired row is deleted [red if: an expired row still answers 200]', async () => {
    const c = await live();
    age(e, c.u.id, { createdDaysAgo: 8, expiresInDays: -1 });
    expect((await I.handleInternal(internalReq(c.cookie), e.auth)).status).toBe(204);
    expect(sessionRows(e, c.u.id)).toBe(0);
  });
  it('a session used daily is refused on day 30 and its row deleted (the cap, whatever the slide says) [red if: the cap check is absent from the listener]', async () => {
    const c = await live();
    age(e, c.u.id, { createdDaysAgo: 30, expiresInDays: 3 });
    must(`UPDATE public.session SET created_at = now() - interval '30 days 1 hour' WHERE user_id = '${c.u.id}'`, e.db);
    expect((await I.handleInternal(internalReq(c.cookie), e.auth)).status).toBe(204);
    expect(sessionRows(e, c.u.id)).toBe(0);
  });
  it('day 8 idle through the OTHER door: a direct /api/auth request is refused 401 and the row is deleted too [red if: only the page path enforces the idle bound]', async () => {
    const c = await live();
    age(e, c.u.id, { createdDaysAgo: 8, expiresInDays: -1 });
    const r = await I.handlePublic(new Request('https://app.qa.test/api/auth/list-accounts', { headers: { cookie: c.cookie, origin: 'https://app.qa.test' } }), e.auth);
    expect(r.status).toBe(401);
    expect(sessionRows(e, c.u.id)).toBe(0);
  });
  it('enter_auth_session refuses the expired row in SQL whatever BetterAuth did first [red if: the SQL checks only existence]', async () => {
    const c = await live();
    age(e, c.u.id, { createdDaysAgo: 8, expiresInDays: -1 });
    const x = await tx(e.db, 'poly_auth', async (q) => { try { await q('SELECT app.enter_auth_session($1)', [c.token]); return null; } catch (err) { return err as any; } });
    expect(x?.code).toBe('42501');
    expect(sessionRows(e, c.u.id)).toBe(1); // the refusal deleted nothing
  });
});
