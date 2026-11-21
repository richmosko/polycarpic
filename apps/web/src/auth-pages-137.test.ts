// POLY-137 (ruling @ a5e9ce4f): R2.5 and R3.7 the three bare public pages, and R8's /API/AUTH row on web. Pure: web's handle with a stub
// resolve, and the page sources read as text. Titles end [red if: <mutation>].
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const route = (p: string) => join(HERE, 'routes', ...p.split('/'));
const read = (p: string) => (existsSync(route(p)) ? readFileSync(route(p), 'utf8') : null);

const run = async (path: string) => {
  const url = new URL(`https://app.qa.test${path}`);
  const resolve = vi.fn(async () => new Response('page', { status: 200 }));
  const setHeaders = vi.fn();
  const event = { url, request: new Request(url), locals: {}, cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() }, setHeaders, getClientAddress: () => '127.0.0.1' };
  const res = await (handle as (a: unknown) => Promise<Response>)({ event, resolve });
  return { res, resolve, setHeaders };
};

const PAGES: [string, string[]][] = [
  ['sign-in/forgot', ['If that address has an account, we have sent it a link. The link works for 15 minutes.', '/api/auth/request-password-reset']],
  ['sign-in/reset', ['Your password is changed and every device is signed out.', 'This link no longer works. Ask for a new one.', '/api/auth/reset-password', 'location.hash', 'replaceState']],
  ['sign-in/cancel-method', ['Cancel the new sign-in method', "Someone added a sign-in method to your account. If it wasn't you, cancel it. This removes the new method and signs your account out on every device.", 'Cancel the new method', 'Cancelled. The new method is removed and every device is signed out. Sign in and change your password now.', 'This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Second step, and change your password if anything there is not yours.', 'Too many tries. Wait a minute and try again.', '/api/auth/second-step/cancel-hold', 'location.hash', 'replaceState']],
];

describe('the pages exist, say what the ruling says, and read their token from the fragment', () => {
  for (const [dir, strings] of PAGES) {
    it(`${dir}/+page.svelte exists and carries its fixed wording and its endpoint  [red if: the page is missing, or says something else]`, () => {
      const src = read(`${dir}/+page.svelte`);
      expect(src, `${dir}/+page.svelte`).not.toBeNull();
      for (const s of strings) expect(src!, s).toContain(s);
    });
  }
  it('neither token page reads the token from the query string or the path, and neither logs it  [red if: a token is read from location.search or console]', () => {
    for (const dir of ['sign-in/reset', 'sign-in/cancel-method']) {
      const src = read(`${dir}/+page.svelte`);
      expect(src, dir).not.toBeNull();
      expect(src!).not.toMatch(/location\.search|searchParams\.get\(\s*['"]token|params\.token|console\./);
    }
  });
  it('the cancel page cancels on a click, never on load: the POST is inside a handler, not a top-level or onMount call  [red if: a GET or a page load cancels (mail scanners open links)]', () => {
    const src = read('sign-in/cancel-method/+page.svelte');
    expect(src).not.toBeNull();
    expect(src!).not.toMatch(/onMount\s*\(/);
    expect(src!).toMatch(/method:\s*['"]POST['"]/);
    expect(read('sign-in/cancel-method/+page.server.ts'), 'a server load could run the cancel on a GET').toBeNull();
    expect(read('sign-in/cancel-method/+server.ts'), 'a GET endpoint could cancel').toBeNull();
  });
  it('/sign-in gains a "Forgot your password?" link to /sign-in/forgot  [red if: reset is wired but unreachable]', () => {
    const src = read('sign-in/+page.svelte')!;
    expect(src).toContain('Forgot your password?');
    expect(src).toContain('/sign-in/forgot');
  });
});

describe('both token pages and the forgot page send Referrer-Policy: no-referrer and Cache-Control: no-store', () => {
  for (const p of ['/sign-in/forgot', '/sign-in/reset', '/sign-in/cancel-method']) {
    it(`${p}: public (no sign-in redirect), no-referrer, no-store  [red if: the page is gated, cached, or leaks the fragment-bearing URL in a Referer]`, async () => {
      const { res, resolve, setHeaders } = await run(p);
      expect(res.status, 'a bare public page is served, not redirected').toBe(200);
      expect(resolve).toHaveBeenCalledTimes(1);
      const seen = new Headers(res.headers);
      for (const c of setHeaders.mock.calls) for (const [k, v] of Object.entries(c[0] as Record<string, string>)) seen.set(k, v);
      const layout = read(`${p.slice(1)}/+page.server.ts`) ?? read(`${p.slice(1)}/+layout.server.ts`) ?? '';
      const viaLoad = (h: string, v: RegExp) => new RegExp(`['"]${h}['"]\\s*:\\s*['"]${v.source}['"]`, 'i').test(layout);
      expect(seen.get('referrer-policy') === 'no-referrer' || viaLoad('referrer-policy', /no-referrer/), 'Referrer-Policy').toBe(true);
      expect(seen.get('cache-control') === 'no-store' || viaLoad('cache-control', /no-store/), 'Cache-Control').toBe(true);
    });
  }
});

describe('R8 /API/AUTH/...: the raw pathname is never taken for the tree, and web never serves or proxies it', () => {
  for (const p of ['/API/AUTH/get-session', '/Api/Auth/list-sessions', '/api/AUTH/sign-in/email', '/API/auth']) {
    it(`${p}: web never resolves it as a page and never reaches BetterAuth (a signed-out caller is sent to sign-in, or gets 404)  [red if: the hook lower-cases and serves it, or passes it through as public]`, async () => {
      const { res, resolve } = await run(p);
      expect(resolve).not.toHaveBeenCalled();
      expect([404, 303]).toContain(res.status);
      if (res.status === 303) expect(res.headers.get('location')).toMatch(/^\/sign-in\?/);
    });
  }
  it('the exact tree stays 404, so the raw-pathname test above is not passing for the wrong reason  [red if: the tree check is lost]', async () => {
    expect((await run('/api/auth/get-session')).res.status).toBe(404);
  });
});
