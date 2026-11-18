// POLY-86 criteria 5, 14 (ruling R6; seceng S2, S7, S12), retargeted by POLY-152 (R1.6, R6.2, R7): web holds no BetterAuth. The whole
// /api/auth tree is 404 in web (the sign-in service serves it); page requests ask the service through @poly/auth/web's loadSession,
// which is mocked here; web relays no cookie. Titles end with [red if: <mutation>].
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  class HttpError extends Error { status: number; code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code; } }
  return { loadSession: vi.fn(), HttpError };
});
vi.mock('@poly/auth/web', async (orig) => ({ ...((await orig()) as object), loadSession: m.loadSession, HttpError: m.HttpError, setAuthInternalOrigin: () => {} }));
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

beforeEach(() => { m.loadSession.mockReset().mockResolvedValue(null); });

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
        expect(m.loadSession).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
      });
});

describe('page requests (criterion 14)', () => {
  it('signed out on a page: 303 to /sign-in?next=<path>  [red if: the redirect is missing, or not a 303]', async () => {
    const r = await run('/dashboard').res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2Fdashboard');
  });

  for (const p of ['/sign-in', '/sign-in/anything', '/healthz'])
    it(`signed out on ${p}: not redirected, and the service is not asked  [red if: a redirect loop on the sign-in page or the health probe]`, async () => {
      const { res, resolve } = run(p);
      expect((await res).status).toBe(200);
      expect(resolve).toHaveBeenCalled();
      expect(m.loadSession).not.toHaveBeenCalled();
    });

  it('S12: next=//evil.example never survives: a protocol-relative path becomes /  [red if: next is built from the raw path]', async () => {
    const r = await run('//evil.example/x').res;
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/sign-in?next=%2F');
  });

  it('signed in: locals.session is exactly the ShellSession projection, the page resolves  [red if: locals.session is unset, or carries token/sessionId/userId]', async () => {
    m.loadSession.mockResolvedValue({ userId: 'u1', sessionId: 'sess-1', shell: SHELL, secondStepRequired: false, token: TOKEN });
    const { res, locals, resolve } = run('/dashboard');
    const r = await res;
    expect(r.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(locals.session).toEqual(SHELL);
    expect(JSON.stringify(locals.session)).not.toContain(TOKEN);
    expect(Object.keys(locals.session as object).sort()).toEqual(['expiresAt', 'user']);
  });

  it('R7: web relays no cookie: even if the session loader offered one, the answer has no Set-Cookie and no auth header  [red if: the setCookie relay is back]', async () => {
    m.loadSession.mockResolvedValue({ userId: 'u1', sessionId: 'sess-1', shell: SHELL, secondStepRequired: false, setCookie: ['__Host-better-auth.session_token=new; Path=/; HttpOnly'] });
    const r = await run('/dashboard').res;
    expect(r.headers.getSetCookie()).toEqual([]);
    expect([...r.headers.keys()].filter((k) => /auth|session|token|x-/.test(k))).toEqual([]);
    expect([...r.headers.values()].join('\n')).not.toContain('sess-1');
  });

  it('E5: an unreachable service (HttpError 503) answers 503 with retry-after, never a redirect to /sign-in and never a session  [red if: failure reads as signed out]', async () => {
    m.loadSession.mockRejectedValue(new m.HttpError(503, 'auth_unavailable'));
    const { res, locals, resolve } = run('/dashboard');
    const r = await res;
    expect(r.status).toBe(503);
    expect(r.headers.get('location')).toBeNull();
    expect(locals.session ?? null).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
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
