// POLY-86 criteria 5, 14 (ruling R6; seceng S2, S7, S12). The auth half of `handle`, with @poly/auth's two I/O functions mocked and
// the real AUTH_ROUTES in force: the blocked class AND unlisted paths are answered 404 before handleAuthRequest is reached;
// a signed-out page request is redirected; a signed-in one sets locals.session (no token) and forwards only Set-Cookie.
// Titles end with [red if: <mutation>].
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ handleAuthRequest: vi.fn(), loadSession: vi.fn() }));
vi.mock('@poly/auth', async (orig) => ({ ...((await orig()) as object), handleAuthRequest: m.handleAuthRequest, loadSession: m.loadSession }));
import { handle } from './hooks.server.ts';

const SHELL = { user: { id: 'u1', name: 'Ada Lovelace', image: null }, expiresAt: '2030-01-01T00:00:00.000Z' };
const TOKEN = 'tok_SECRET_SESSION_TOKEN';

function run(path: string, init: RequestInit & { method?: string } = {}) {
  const url = new URL(`https://app.qa.test${path}`);
  const request = new Request(url, init);
  const locals: Record<string, unknown> = {};
  const event = { url, request, locals, cookies: { get: () => undefined }, getClientAddress: () => '127.0.0.1' };
  const resolve = vi.fn(async () => new Response('<html class="%poly.theme%">ok</html>', { headers: { 'content-type': 'text/html' } }));
  return { locals, resolve, res: (handle as any)({ event, resolve }) as Promise<Response> };
}

beforeEach(() => {
  m.handleAuthRequest.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  m.loadSession.mockReset().mockResolvedValue(null);
});

describe('/api/auth/* in the handle (S7)', () => {
  const blockedVariants = [
    '/api/auth/get-session', '/api/auth/get-session/', '/api/auth//get-session', '/api/auth/GET-SESSION', '/api/auth/%2Fget-session', '/api/auth/%2fget-session',
    '/api/auth/get-session?disableCookieCache=true', '/api/auth/list-sessions', '/api/auth/list-sessions/', '/api/auth/LIST-SESSIONS', '/api/auth/two-factor/get-totp-uri',
    '/api/auth/get-access-token', '/api/auth/delete-user', '/api/auth/update-session',
  ];
  for (const p of blockedVariants)
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST'])
      it(`${method} ${p} -> 404 without calling handleAuthRequest  [red if: the handle checks the blocked list on the raw path, or only for GET]`, async () => {
        const { res } = run(p, { method, ...(method === 'POST' ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}) });
        expect((await res).status).toBe(404);
        expect(m.handleAuthRequest).not.toHaveBeenCalled();
      });

  for (const p of ['/api/auth/no-such-route', '/api/auth/', '/api/auth', '/api/auth/sign-in/email/extra', '/api/auth/../auth/get-session'])
    it(`unlisted ${p} -> 404 without calling handleAuthRequest  [red if: the handle blocks only the blocked class and lets unlisted paths through to BetterAuth]`, async () => {
      expect((await run(p).res).status).toBe(404);
      expect(m.handleAuthRequest).not.toHaveBeenCalled();
    });

  it('a listed open path reaches handleAuthRequest and its response is returned as is  [red if: the handle swallows or rewrites the auth answer]', async () => {
    const { res } = run('/api/auth/sign-in/email', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const r = await res;
    expect(r.status).toBe(200);
    expect(m.handleAuthRequest).toHaveBeenCalledTimes(1);
    expect(m.handleAuthRequest.mock.calls[0][0]).toBeInstanceOf(Request);
  });

  it('a templated path (/api/auth/callback/google, /api/auth/reset-password/tok) matches its template  [red if: templates are compared literally]', async () => {
    for (const p of ['/api/auth/callback/google?code=1&state=2', '/api/auth/reset-password/abc123']) {
      m.handleAuthRequest.mockClear();
      await run(p).res;
      expect(m.handleAuthRequest, p).toHaveBeenCalledTimes(1);
    }
  });
});

describe('page requests (criterion 14)', () => {
  it('signed out on a page: 303 to /sign-in?next=<path>  [red if: the redirect is missing, or not a 303]', async () => {
    const r = await run('/dashboard').res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2Fdashboard');
  });

  for (const p of ['/sign-in', '/sign-in/anything', '/healthz'])
    it(`signed out on ${p}: not redirected  [red if: a redirect loop on the sign-in page or the health probe]`, async () => {
      const { res, resolve } = run(p);
      expect((await res).status).toBe(200);
      expect(resolve).toHaveBeenCalled();
    });

  it('S12: next=//evil.example never survives: a protocol-relative path becomes /  [red if: next is built from the raw path]', async () => {
    const r = await run('//evil.example/x').res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2F');
  });

  it('signed in: locals.session is exactly the ShellSession projection, the page resolves  [red if: locals.session is unset, or carries token/sessionId/userId]', async () => {
    m.loadSession.mockResolvedValue({ userId: 'u1', sessionId: 'sess-1', shell: SHELL, setCookie: [], token: TOKEN });
    const { res, locals, resolve } = run('/dashboard');
    const r = await res;
    expect(r.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(locals.session).toEqual(SHELL);
    expect(JSON.stringify(locals.session)).not.toContain(TOKEN);
    expect(Object.keys(locals.session as object).sort()).toEqual(['expiresAt', 'user']);
  });

  it('S2: a refreshed Set-Cookie is forwarded; no other auth header is  [red if: the Set-Cookie is dropped (session never refreshes) or the token/session id leaks into a header]', async () => {
    m.loadSession.mockResolvedValue({ userId: 'u1', sessionId: 'sess-1', shell: SHELL, setCookie: ['__Host-better-auth.session_token=new; Path=/; HttpOnly; Secure; SameSite=Lax', 'second=1; Path=/'] });
    const r = await run('/dashboard').res;
    expect(r.headers.getSetCookie()).toEqual(expect.arrayContaining(['__Host-better-auth.session_token=new; Path=/; HttpOnly; Secure; SameSite=Lax', 'second=1; Path=/']));
    const names = [...r.headers.keys()].filter((k) => !['content-type', 'set-cookie'].includes(k));
    expect(names.filter((k) => /auth|session|token|x-/.test(k))).toEqual([]);
    expect([...r.headers.values()].join('\n')).not.toContain('sess-1');
  });

  it('signed out loads no data and sets no session  [red if: locals.session is set for a null session]', async () => {
    const { res, locals } = run('/sign-in');
    await res;
    expect(locals.session ?? null).toBeNull();
  });
});

describe('SvelteKit CSRF (S12)', () => {
  it('csrf.checkOrigin is not turned off in vite.config.ts (Kit 3 config home)  [red if: csrf.checkOrigin: false or trustedOrigins widened there]', () => {
    const cfg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vite.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/checkOrigin\s*:\s*false/);
    expect(cfg).not.toMatch(/trustedOrigins/);
    expect(cfg).toMatch(/'img-src': \['self', 'data:'\]/); // criterion 15: the CSP is not widened
  });
});
