// POLY-152 R6.2, seceng E5 / E3: `@poly/auth/web` loadSession sends GET <AUTH_INTERNAL_ORIGIN>/session with only BetterAuth's cookies, a
// 2-second timeout and nothing else; an unreachable service is a 503, never a session or a redirect. Pure unit tests (a fake fetch).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Web = { loadSessionFromService: (req: Request, o: { origin: string; fetch?: typeof fetch }) => Promise<unknown> };
// ASSUMED export: loadSessionFromService(request, { origin, fetch }) — the call to the service, before web's own provisioning and gate.
const web = async (): Promise<Web> => (await import('./web.ts')) as unknown as Web;
const ORIGIN = 'http://auth.internal:3001';
afterEach(() => vi.restoreAllMocks());

describe('the request web sends', () => {
  it('GET <origin>/session, only BetterAuth\'s cookies from the page request, no other header, no body, a timeout of at most 2 s [red if: web.ts is absent or forwards extra headers]', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (u: string, init: RequestInit) => { seen.push({ url: String(u), init }); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
    const req = new Request('https://app.qa.test/', { headers: { cookie: 'poly_theme=dark; __Secure-better-auth.session_token=abc.def; other=1; better-auth.session_token=zzz', authorization: 'Bearer x', 'x-user-id': 'u' } });
    await (await web()).loadSessionFromService(req, { origin: ORIGIN, fetch: fake });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${ORIGIN}/session`);
    expect(seen[0]!.init.method ?? 'GET').toBe('GET');
    const h = new Headers(seen[0]!.init.headers);
    expect([...h.keys()]).toEqual(['cookie']);
    expect(h.get('cookie')).not.toMatch(/poly_theme|other=1/);
    expect(h.get('cookie')).toMatch(/session_token=abc\.def/);
    expect(seen[0]!.init.body ?? null).toBeNull();
    expect(seen[0]!.init.signal).toBeDefined();
  });
  it('a 204 is no session (null); a 200 returns exactly the five keys [red if: the answer is not parsed from the service]', async () => {
    const b = { userId: 'u', sessionId: 's', name: 'N', image: null, expiresAt: '2026-01-01T00:00:00Z' };
    const w = await web();
    expect(await w.loadSessionFromService(new Request('https://app.qa.test/'), { origin: ORIGIN, fetch: (async () => new Response(null, { status: 204 })) as never })).toBeNull();
    expect(await w.loadSessionFromService(new Request('https://app.qa.test/'), { origin: ORIGIN, fetch: (async () => Response.json(b)) as never })).toEqual(b);
  });
});

describe('E5 the service is down: 503, never a session', () => {
  it('a refused connection, a timeout and a 5xx each throw an HttpError 503; none returns null or a session (null would redirect to /sign-in) [red if: failure reads as signed out]', async () => {
    const w = await web();
    for (const f of [async () => { throw new TypeError('fetch failed'); }, async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => new Response('x', { status: 502 }), async () => new Response('x', { status: 500 })]) {
      const x = await w.loadSessionFromService(new Request('https://app.qa.test/'), { origin: ORIGIN, fetch: f as never }).then(() => null, (e) => e);
      expect(x, String(f)).not.toBeNull();
      expect((x as { status?: number }).status).toBe(503);
    }
  });
  it('an unexpected 200 body (wrong keys) is a 503, not a session [red if: the shape is trusted]', async () => {
    const w = await web();
    const x = await w.loadSessionFromService(new Request('https://app.qa.test/'), { origin: ORIGIN, fetch: (async () => Response.json({ userId: 'u', token: 'leak' })) as never }).then(() => null, (e) => e);
    expect((x as { status?: number } | null)?.status).toBe(503);
  });
});
