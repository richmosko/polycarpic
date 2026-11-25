// POLY-86 criteria 5, 14 (ruling R6; seceng S2, S7, S12), retargeted by POLY-152 (R1.6) and POLY-153 (R7.2, R8, R9): web enters a transaction
// only by handing Postgres the __Host-poly_handle cookie through withSession; it asks no service who is signed in. The /api/auth tree is
// 404 in web. withSession and provisionPerson are mocked here (their real behaviour is tests/db and packages/db). Titles end [red if: <mutation>].
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  class NoLiveSession extends Error { constructor() { super('no live session'); this.name = 'NoLiveSession'; } }
  return { NoLiveSession, withSession: vi.fn(), provisionPerson: vi.fn(), secondStep: { required: false } };
});
vi.mock('@poly/db', async (orig) => ({ ...((await orig()) as object), withSession: m.withSession, NoLiveSession: m.NoLiveSession }));
vi.mock('@poly/tenancy', async (orig) => ({ ...((await orig()) as object), provisionPerson: m.provisionPerson }));
import { handle } from './hooks.server.ts';

const SHELL = { user: { id: 'u1', name: 'Ada Lovelace', image: null }, expiresAt: '2030-01-01T00:00:00.000Z' };
/** enter_session's row as withSession hands it to fn: flat camelCase (the contract these tests pin; hooks builds locals.session from it). */
const ROW = { userId: 'u1', sessionId: 'sess-1', name: 'Ada Lovelace', image: null, expiresAt: '2030-01-01T00:00:00.000Z' };
const HANDLE = 'h'.repeat(43);
const TX = { execute: vi.fn(async () => ({ rows: [{ r: m.secondStep.required }] })) };
/** withSession(handle, fn) runs fn(tx, shell) like the real one; a handle other than HANDLE is not a live session. */
const live = () => m.withSession.mockImplementation(async (h: string, fn: (tx: unknown, shell: unknown) => unknown) => { if (h !== HANDLE) throw new m.NoLiveSession(); return fn(TX, ROW); });

function run(path: string, init: RequestInit & { method?: string; cookies?: Record<string, string> } = {}) {
  const url = new URL(`https://app.qa.test${path}`);
  const { cookies: jar = {}, ...rest } = init;
  const request = new Request(url, rest);
  const locals: Record<string, unknown> = {};
  const deleted: [string, unknown][] = [];
  const set = vi.fn();
  const event = { url, request, locals, cookies: { get: (n: string) => jar[n], set, delete: (n: string, o: unknown) => { deleted.push([n, o]); } }, getClientAddress: () => '127.0.0.1' };
  const resolve = vi.fn(async () => new Response('<html class="%poly.theme%">ok</html>', { headers: { 'content-type': 'text/html' } }));
  return { locals, resolve, deleted, set, res: (handle as any)({ event, resolve }) as Promise<Response> };
}
/** The handle cookie is cleared on the response or through event.cookies.delete. */
const clearsHandle = (r: Response, deleted: [string, unknown][]) => deleted.some(([n]) => n === '__Host-poly_handle') || r.headers.getSetCookie().some((c) => /^__Host-poly_handle=;/.test(c) && /Max-Age=0/i.test(c));

beforeEach(() => { m.withSession.mockReset(); m.provisionPerson.mockReset().mockResolvedValue(undefined); m.secondStep.required = false; TX.execute.mockClear(); live(); });

describe('/api/auth/* in the handle (S7, R1.6): the whole tree is the service\'s, web answers 404', () => {
  const paths = [
    '/api/auth/get-session', '/api/auth/GET-SESSION', '/api/auth/%2Fget-session', '/api/auth/list-sessions', '/api/auth/two-factor/get-totp-uri',
    '/api/auth/sign-in/email', '/api/auth/callback/google?code=1&state=2', '/api/auth/reset-password/abc123', '/api/auth/no-such-route', '/api/auth/', '/api/auth',
  ];
  for (const p of paths)
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST'])
      it(`${method} ${p} -> 404, no session lookup, no page  [red if: web serves, proxies or session-checks any /api/auth path]`, async () => {
        const { res, resolve } = run(p, { method, ...(method === 'POST' ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}) });
        expect((await res).status).toBe(404);
        expect(m.withSession).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
      });
});

describe('page requests (criterion 14, POLY-153 R7.2)', () => {
  it('no handle cookie: 303 to /sign-in?next=<path> and no database call  [red if: the redirect is missing, or web asks anyone else]', async () => {
    const { res } = run('/dashboard');
    const r = await res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2Fdashboard');
    expect(m.withSession).not.toHaveBeenCalled();
  });
  it('R8: a valid BetterAuth session cookie sent to web by hand is ignored: no handle means 303  [red if: web still reads BetterAuth\'s cookie]', async () => {
    for (const name of ['__Secure-better-auth.session_token', '__Host-better-auth.session_token', 'better-auth.session_token']) {
      const { res } = run('/dashboard', { cookies: { [name]: 'tok.sig' }, headers: { cookie: `${name}=tok.sig` } });
      const r = await res;
      expect(r.status, name).toBe(303);
      expect(r.headers.get('location')).toMatch(/^\/sign-in\?/);
    }
    expect(m.withSession).not.toHaveBeenCalled();
  });

  // POLY-161 R6: an exact set, not a prefix. The crawl on the built server (tests/db/web-server.test.ts) is the full proof; this is the fast pin.
  for (const p of ['/api/v1/health', '/sign-in', '/sign-in/cancel-method', '/sign-in/forgot', '/sign-in/reset', '/sign-in/second-step', '/sign-up', '/sign-in/forgot/__data.json', '/sign-up/__data.json'])
    it(`signed out on ${p}: not redirected, and nothing is entered  [red if: a redirect loop on the sign-in page or the health probe]`, async () => {
      const { res, resolve } = run(p);
      expect((await res).status).toBe(200);
      expect(resolve).toHaveBeenCalled();
      expect(m.withSession).not.toHaveBeenCalled();
    });
  // build-review F1: web writes exactly one cookie, ever: the clearing of its own handle on a dead handle. Nothing else, anywhere.
  const CLEAR = '__Host-poly_handle=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
  it('F1: a dead handle gives exactly the one clearing line on the 303, nothing else, and event.cookies.set is never used  [red if: a second Set-Cookie is appended, or any cookie is set through event.cookies]', async () => {
    const { res, set } = run('/dashboard', { cookies: { '__Host-poly_handle': 'z'.repeat(43) } });
    const r = await res;
    expect(r.status).toBe(303);
    expect(r.headers.getSetCookie()).toEqual([CLEAR]);
    expect(set).not.toHaveBeenCalled();
  });
  for (const p of ['/sign-in', '/sign-up', '/api/v1/health', '/sign-in/forgot', '/dashboard', '/nowhere']) {
    it(`F1: signed out on ${p} (no cookie): no Set-Cookie at all and no cookie set  [red if: a cookie is written on a signed-out answer]`, async () => {
      const { res, set } = run(p);
      const r = await res;
      expect(r.headers.getSetCookie()).toEqual([]);
      expect(set).not.toHaveBeenCalled();
    });
  }
  it('F1: a live handle on a signed-in page: no Set-Cookie and no cookie set  [red if: a signed-in page writes a cookie]', async () => {
    const { res, set } = run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } });
    const r = await res;
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });
  for (const p of ['/sign-in/anything', '/sign-in/reset/x', '/sign-in/', '/healthz', '/api/v1/health/__data.json', '/sign-up/x', '/sign-in/anything/__data.json'])
    it(`signed out on ${p}: not public; the guard redirects  [red if: isPublic is a prefix test, or /healthz survived]`, async () => {
      const { res, resolve } = run(p);
      const r = await res;
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toMatch(/^\/sign-in\?next=/);
      expect(resolve).not.toHaveBeenCalled();
    });

  it('S12: next=//evil.example never survives: a protocol-relative path becomes /  [red if: next is built from the raw path]', async () => {
    const r = await run('//evil.example/x').res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2F');
  });

  it('a live handle: ONE withSession(handle) enters; provisionPerson gets the name from the returned row; locals.session is exactly the shell, locals.handle the cookie value, locals.identity is gone  [red if: web reads public."user", loads by cookie, or leaves the identity on locals]', async () => {
    const { res, locals, resolve } = run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } });
    const r = await res;
    expect(r.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(m.withSession).toHaveBeenCalledTimes(1);
    expect(m.withSession.mock.calls[0]![0]).toBe(HANDLE);
    expect(m.provisionPerson).toHaveBeenCalledTimes(1);
    expect(m.provisionPerson.mock.calls[0]![1]).toBe('Ada Lovelace');
    expect(locals.session).toEqual(SHELL);
    expect(Object.keys(locals.session as object).sort()).toEqual(['expiresAt', 'user']);
    expect(locals.handle).toBe(HANDLE);
    expect('identity' in locals).toBe(false);
    expect(JSON.stringify(locals.session)).not.toContain(HANDLE);
  });
  it('a NULL or empty name provisions a Person named Person  [red if: the fallback is lost]', async () => {
    for (const name of [null, '']) {
      m.provisionPerson.mockClear();
      m.withSession.mockImplementation(async (_h: string, fn: (tx: unknown, shell: unknown) => unknown) => fn(TX, { ...ROW, name }));
      await run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } }).res;
      expect(m.provisionPerson.mock.calls[0]![1], String(name)).toBe('Person');
    }
  });
  it('the unique race on a first load is retried once, as before  [red if: the retry was dropped]', async () => {
    const race = Object.assign(new Error('dup'), { code: '23505', constraint: 'entity_self_user_id_unique' });
    m.provisionPerson.mockRejectedValueOnce(race).mockResolvedValue(undefined);
    const r = await run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } }).res;
    expect(r.status).toBe(200);
    expect(m.provisionPerson).toHaveBeenCalledTimes(2);
  });
  it('a second 23505 on entity_self_user_id_unique fails the request after exactly two attempts, and the error carries no handle (was the loadSession failure-shape test; R7.2 moved the retry here)  [red if: an unbounded loop or a swallowed error]', async () => {
    const race = Object.assign(new Error('dup'), { code: '23505', constraint: 'entity_self_user_id_unique' });
    m.provisionPerson.mockRejectedValue(race);
    const { res } = run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } });
    await expect(res).rejects.toThrow('dup');
    expect(m.provisionPerson).toHaveBeenCalledTimes(2);
  });
  it('a 23505 on any other constraint, and any other error, is not retried  [red if: the retry matches on code alone, or on any error]', async () => {
    for (const err of [Object.assign(new Error('dup'), { code: '23505', constraint: 'some_other_unique' }), Object.assign(new Error('other'), { code: 'P0001' })]) {
      m.provisionPerson.mockReset().mockRejectedValue(err);
      await expect(run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } }).res).rejects.toThrow();
      expect(m.provisionPerson).toHaveBeenCalledTimes(1);
    }
  });
  it('NoLiveSession: the handle cookie is cleared and the answer is a 303 to /sign-in  [red if: a dead handle leaves a signed-in-looking browser]', async () => {
    const { res, deleted } = run('/dashboard', { cookies: { '__Host-poly_handle': 'z'.repeat(43) } });
    const r = await res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/^\/sign-in/);
    expect(clearsHandle(r, deleted)).toBe(true);
  });
  it('any other failure of the entry is thrown, never a 503 page and never a redirect (the interim 503 branch is gone)  [red if: a database error reads as signed out or as service-unavailable]', async () => {
    m.withSession.mockRejectedValue(new Error('connection refused'));
    const { res } = run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } });
    await expect(res).rejects.toThrow('connection refused');
  });
  it('web relays no cookie on a live page: no Set-Cookie and no auth header  [red if: the setCookie relay is back]', async () => {
    const r = await run('/dashboard', { cookies: { '__Host-poly_handle': HANDLE } }).res;
    expect(r.headers.getSetCookie()).toEqual([]);
    expect([...r.headers.keys()].filter((k) => /auth|session|token|x-/.test(k))).toEqual([]);
    expect([...r.headers.values()].join('\n')).not.toContain(HANDLE);
  });
  it('signed out loads no data and sets no session  [red if: locals.session is set for no session]', async () => {
    const { res, locals } = run('/sign-in');
    await res;
    expect(locals.session ?? null).toBeNull();
  });
});

describe('hooks.server.ts source (R7.3, R9)', () => {
  const src = () => readFileSync(new URL('./hooks.server.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('reads only the handle cookie and imports none of the removed names  [red if: loadSession, setAuthInternalOrigin, withTenant, sessionUserId or SESSION_COOKIE remain]', () => {
    for (const re of [/loadSession/, /setAuthInternalOrigin/, /completeSession/, /withTenant/, /sessionUserId/, /SESSION_COOKIE/, /better-auth/, /authInternalOrigin/, /AUTH_INTERNAL/, /locals\.identity/])
      expect(src()).not.toMatch(re);
    expect(src()).toMatch(/__Host-poly_handle/);
    expect(src()).toMatch(/withSession/);
  });
});

describe('SvelteKit CSRF (S12)', () => {
  it('csrf.checkOrigin is not turned off in vite.config.ts (Kit 3 config home)  [red if: csrf.checkOrigin: false or trustedOrigins widened there]', () => {
    const cfg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vite.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/checkOrigin\s*:\s*false/);
    expect(cfg).not.toMatch(/trustedOrigins/);
    const csp = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'csp.ts'), 'utf8');
    expect(csp).toMatch(/'img-src': \['self', 'data:'\]/); // criterion 15: the CSP is not widened (its one home since POLY-161 R15)
    expect(cfg).toMatch(/CSP_DIRECTIVES/);
  });
});
