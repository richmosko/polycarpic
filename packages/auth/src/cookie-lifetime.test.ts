// POLY-152 R7: the cookie-lifetime plugin. Last in plugins[], a match-all matcher, a no-op without newSession/responseHeaders, and
// Max-Age = seconds to created_at + 30 days. Unit tests of the plugin's handler with a fake context; the end-to-end clock tests are in
// tests/db/auth-refresh.test.ts. ASSUMED export: cookieLifetime() returning a BetterAuth plugin.
import { describe, expect, it } from 'vitest';
import { authOptions } from './options.ts';

const load = async () => (await import('./cookie-lifetime.ts')) as unknown as { cookieLifetime: () => { id: string; hooks: { after: { matcher: (c: unknown) => boolean; handler: (c: unknown) => Promise<unknown> }[] } } };
const NOW = Date.now();
const ctxOf = (cookie: string, createdAt: Date) => {
  const responseHeaders = new Headers();
  responseHeaders.append('set-cookie', cookie);
  return { path: '/sign-in/email', context: { responseHeaders, newSession: { session: { createdAt, token: 't' } }, authCookies: { sessionToken: { name: 'better-auth.session_token', attributes: {} } } } };
};

describe('the plugin', () => {
  it('its after-hook matcher accepts every path, including the sentinel path widenTwoFactorMatcher probes [red if: path-specific, which makes startup throw]', async () => {
    const h = (await load()).cookieLifetime().hooks.after;
    expect(h).toHaveLength(2); // POLY-153 R5.1: [lifetime, handle], the handle hook joins the same plugin
    for (const hook of h) for (const p of ['/sign-in/email', '/get-session', '/sign-in/magic-link', '/__qa_sentinel__', '/']) expect(hook.matcher({ path: p }), p).toBe(true);
  });
  it('it is the LAST plugin of authOptions and the service still starts with it [red if: not last]', () => {
    const o: any = authOptions({ secret: 'x'.repeat(40), baseURL: 'https://app.qa.test', tlsMode: 'real-domain', requireClientIp: false, sendMagicLink: async () => {} } as never);
    expect(o.plugins.at(-1).id).toBe('cookie-lifetime');
  });
  it('rewrites the session-token Set-Cookie: Max-Age is the seconds to created_at + 30 days (a 10-day-old row gets ≈ 20 days) [red if: Max-Age stays 604800]', async () => {
    const created = new Date(NOW - 10 * 86400_000);
    const c = ctxOf('better-auth.session_token=v; Max-Age=604800; Path=/; HttpOnly', created);
    await (await load()).cookieLifetime().hooks.after[0]!.handler(c);
    const got = c.context.responseHeaders.getSetCookie();
    expect(got).toHaveLength(1);
    const ma = Number(got[0]!.match(/Max-Age=(\d+)/i)![1]);
    expect(Math.abs(ma - 20 * 86400)).toBeLessThan(5);
    expect(got[0]).toMatch(/Path=\//);
    expect(got[0]).toMatch(/HttpOnly/);
  });
  it('a cookie with no Max-Age (rememberMe false) is left alone; other cookies are untouched [red if: a Max-Age is added]', async () => {
    const c = ctxOf('better-auth.session_token=v; Path=/; HttpOnly', new Date(NOW));
    c.context.responseHeaders.append('set-cookie', 'other=1; Max-Age=60');
    await (await load()).cookieLifetime().hooks.after[0]!.handler(c);
    const got = c.context.responseHeaders.getSetCookie();
    expect(got.find((x) => /session_token/.test(x))).not.toMatch(/Max-Age/i);
    expect(got.find((x) => /^other=/.test(x))).toMatch(/Max-Age=60/);
  });
  it('does nothing when newSession or responseHeaders is absent (/get-session, /sign-in/magic-link) [red if: it throws or adds a cookie]', async () => {
    const h = (await load()).cookieLifetime().hooks.after[0]!;
    await expect(h.handler({ path: '/get-session', context: { newSession: null } })).resolves.not.toThrow();
    const rh = new Headers();
    await expect(h.handler({ path: '/sign-in/magic-link', context: { responseHeaders: rh, newSession: null } })).resolves.not.toThrow();
    expect(rh.getSetCookie()).toEqual([]);
  });
  it('a created_at past the cap yields no Max-Age above zero (never a negative or an enormous value) [red if: Max-Age < 0]', async () => {
    const c = ctxOf('better-auth.session_token=v; Max-Age=604800; Path=/', new Date(NOW - 40 * 86400_000));
    await (await load()).cookieLifetime().hooks.after[0]!.handler(c);
    const m = c.context.responseHeaders.getSetCookie()[0]!.match(/Max-Age=(-?\d+)/i);
    if (m) expect(Number(m[1])).toBeGreaterThanOrEqual(0);
  });
});
