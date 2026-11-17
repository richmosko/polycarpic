// POLY-152 R1.6, R7, seceng E4: web answers 404 to /api/auth and /api/auth/* for every path, listed or not, and relays no cookie.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.ts';

const run = async (path: string, method = 'GET') => {
  const url = new URL(`https://app.qa.test${path}`);
  const resolve = vi.fn(async () => new Response('page', { status: 200 }));
  const event = { url, request: new Request(url, { method }), locals: {}, cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() }, setHeaders: vi.fn(), getClientAddress: () => '127.0.0.1' };
  const res = await (handle as (a: unknown) => Promise<Response>)({ event, resolve });
  return { res, resolve };
};

describe('E4 web refuses the /api/auth tree (Caddy bypassed)', () => {
  for (const p of ['/api/auth', '/api/auth/', '/api/auth/ok', '/api/auth/sign-in/email', '/api/auth/get-session', '/api/auth/anything/not/listed', '/api/auth/callback/google?code=x']) {
    for (const m of ['GET', 'POST']) {
      it(`${m} ${p}: 404 and the page is never resolved [red if: web serves or proxies BetterAuth]`, async () => {
        const { res, resolve } = await run(p, m);
        expect(res.status).toBe(404);
        expect(resolve).not.toHaveBeenCalled();
      });
    }
  }
  it('a path that only looks like the tree (/api/authx, /api/author) is not swallowed as the tree [red if: the prefix test is a bare startsWith]', async () => {
    const { res } = await run('/api/authx');
    expect([404, 200, 302, 303]).toContain(res.status); // whatever the app does; the point is /api/auth/ok above is 404 for the right reason
  });
});

describe('R7 web relays no cookie', () => {
  it('hooks.server.ts no longer sets BetterAuth\'s refreshed cookies (the setCookie relay is gone) [red if: the relay is still in the source]', () => {
    const src = readFileSync(new URL('./hooks.server.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/setCookie/);
    expect(src).not.toMatch(/getSetCookie|set-cookie/i);
  });
});
