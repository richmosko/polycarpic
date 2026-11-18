// POLY-153 R5.1: the handle's after-hook, the second hook of the last plugin (cookieLifetime). Unit tests with a fake request context and a
// faked @poly/db/auth currentClient; the end-to-end paths are tests/db/session-handle-paths.test.ts. Titles end [red if: <mutation>].
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authOptions } from './options.ts';

const db = vi.hoisted(() => ({ client: null as null | { kind: string; client: { query: (...a: unknown[]) => Promise<{ rows: { ok: boolean }[] }> } } }));
vi.mock('@poly/db/auth', async (orig) => ({ ...((await orig()) as object), currentClient: () => db.client }));

const load = async () => ((await import('./cookie-lifetime.ts')) as unknown as { cookieLifetime: () => { id: string; hooks: { after: { matcher: (c: unknown) => boolean; handler: (c: unknown) => Promise<unknown> }[] } } }).cookieLifetime();
const SESSION = 'better-auth.session_token';
function ctxOf(sessionCookie: string | null, over: { newSession?: unknown } = {}) {
  const responseHeaders = new Headers();
  if (sessionCookie) responseHeaders.append('set-cookie', sessionCookie);
  return { path: '/sign-in/email', context: { responseHeaders, newSession: 'newSession' in over ? over.newSession : { session: { id: 'sid-1', createdAt: new Date(), token: 't' } }, authCookies: { sessionToken: { name: SESSION, attributes: {} } } } };
}
const queries: { text: string; values: unknown[] }[] = [];
const useDb = (ok = true) => { db.client = { kind: 'withSignInTx', client: { query: async (text: any, values: any) => { queries.push({ text: String(text?.text ?? text), values: values ?? text?.values }); return { rows: [{ ok }] }; } } }; };
const handleCookie = (c: ReturnType<typeof ctxOf>) => c.context.responseHeaders.getSetCookie().find((x) => x.startsWith('__Host-poly_handle='));
beforeEach(() => { queries.length = 0; useDb(); });

describe('the plugin layout', () => {
  it('cookieLifetime carries two after-hooks, [lifetime, handle], both accepting every path (the sentinel included) [red if: one hook, or a path-specific matcher that makes startup throw]', async () => {
    const h = (await load()).hooks.after;
    expect(h).toHaveLength(2);
    for (const hook of h) for (const p of ['/sign-in/email', '/get-session', '/__qa_sentinel__', '/']) expect(hook.matcher({ path: p }), p).toBe(true);
  });
  it('the plugin stays LAST in plugins[] so it sees the final newSession [red if: another plugin is appended after it]', () => {
    const o: any = authOptions({ secret: 'x'.repeat(40), baseURL: 'https://app.qa.test', tlsMode: 'real-domain', requireClientIp: false, sendMagicLink: async () => {} } as never);
    expect(o.plugins.at(-1).id).toBe('cookie-lifetime');
  });
  it('the handle code lives in session-handle.ts and the plugin file wires it [red if: the file does not exist]', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./session-handle.ts', import.meta.url), 'utf8'));
    expect(src).toMatch(/attach_session_handle/);
    expect(src).toMatch(/randomBytes\(32\)/);
    expect(src).toMatch(/base64url/);
  });
});

describe('the handle hook', () => {
  it('with a new session and a transaction: one SELECT app.attach_session_handle($1, $2) with the session id and a 43-character base64url value, then a __Host- cookie [red if: the value is not 32 CSPRNG bytes, or is derived from the token]', async () => {
    const c = ctxOf(`${SESSION}=v; Max-Age=604800; Path=/api/auth; HttpOnly`);
    await (await load()).hooks.after[1]!.handler(c);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.text.replace(/\s+/g, ' ').trim()).toMatch(/^SELECT app\.attach_session_handle\(\$1, \$2\)( AS \w+)?;?$/); // the exact call the definer compares
    expect(queries[0]!.values[0]).toBe('sid-1');
    expect(queries[0]!.values[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(queries[0]!.values[1]).not.toBe('t');
    const hc = handleCookie(c)!;
    expect(hc).toBe(`__Host-poly_handle=${queries[0]!.values[1]}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${/Max-Age=(\d+)/.exec(c.context.responseHeaders.getSetCookie().find((x) => x.startsWith(`${SESSION}=`))!)![1]}`);
  });
  it('two calls give two different values [red if: the value is constant or time-seeded]', async () => {
    const a = ctxOf(`${SESSION}=v; Max-Age=100; Path=/api/auth`); const b = ctxOf(`${SESSION}=v; Max-Age=100; Path=/api/auth`);
    await (await load()).hooks.after[1]!.handler(a); await (await load()).hooks.after[1]!.handler(b);
    expect(queries[0]!.values[1]).not.toBe(queries[1]!.values[1]);
  });
  it('the handle cookie has Max-Age only when the session cookie has a positive one, and then the same value [red if: rememberMe:false gives the handle a lifetime]', async () => {
    const without = ctxOf(`${SESSION}=v; Path=/api/auth; HttpOnly`);
    await (await load()).hooks.after[1]!.handler(without);
    expect(handleCookie(without)).toBeDefined();
    expect(handleCookie(without)).not.toMatch(/Max-Age/i);
    const withAge = ctxOf(`${SESSION}=v; Max-Age=1234; Path=/api/auth`);
    await (await load()).hooks.after[1]!.handler(withAge);
    expect(handleCookie(withAge)).toMatch(/Max-Age=1234$/);
  });
  it('the lifetime hook runs first and the handle hook copies the rewritten Max-Age (the 30-day-cap rule) [red if: the handle outlives the cap]', async () => {
    const created = new Date(Date.now() - 10 * 86400_000);
    const c = ctxOf(`${SESSION}=v; Max-Age=604800; Path=/api/auth`, { newSession: { session: { id: 'sid-1', createdAt: created, token: 't' } } });
    const [lifetime, handle] = (await load()).hooks.after;
    await lifetime!.handler(c);
    await handle!.handler(c);
    const left = Number(/Max-Age=(\d+)/.exec(handleCookie(c)!)![1]);
    expect(Math.abs(left - 20 * 86400)).toBeLessThan(120);
  });
  it('attach answered false (a refresh: the session keeps its handle): no cookie is set [red if: refresh re-issues a handle]', async () => {
    useDb(false);
    const c = ctxOf(`${SESSION}=v; Max-Age=100; Path=/api/auth`);
    await (await load()).hooks.after[1]!.handler(c);
    expect(handleCookie(c)).toBeUndefined();
  });
  it('no newSession (get-session, a hold, a failed sign-in): no query and no cookie [red if: the hook runs without a session]', async () => {
    const c = ctxOf(null, { newSession: null });
    await (await load()).hooks.after[1]!.handler(c);
    expect(queries).toEqual([]);
    expect(handleCookie(c)).toBeUndefined();
  });
  it('no request transaction: the hook throws (a 500, fail closed) and sets nothing; the error message carries no handle [red if: it skips the attach, falls back to a pool or swallows the failure]', async () => {
    db.client = null;
    const c = ctxOf(`${SESSION}=v; Max-Age=100; Path=/api/auth`);
    const x = await (await load()).hooks.after[1]!.handler(c).then(() => null, (e: unknown) => e);
    expect(x, 'must throw').not.toBeNull();
    expect(String((x as Error).message)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(handleCookie(c)).toBeUndefined();
  });
  it('the database failing leaves no cookie and the error carries no handle [red if: the cookie is appended before the attach, or the value is echoed in the error]', async () => {
    db.client = { kind: 'withSignInTx', client: { query: async () => { throw new Error('qa: forced handle insert failure'); } } };
    const c = ctxOf(`${SESSION}=v; Max-Age=100; Path=/api/auth`);
    const x = await (await load()).hooks.after[1]!.handler(c).then(() => null, (e: unknown) => e);
    expect(x).not.toBeNull();
    expect(handleCookie(c)).toBeUndefined();
    expect(String((x as Error).message)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
  it('a session-token clearing cookie (Max-Age=0: sign-out, revoke of the current session) appends the handle clearing cookie and attaches nothing [red if: sign-out leaves the handle cookie]', async () => {
    const c = ctxOf(`${SESSION}=; Max-Age=0; Path=/api/auth; HttpOnly`, { newSession: null });
    await (await load()).hooks.after[1]!.handler(c);
    expect(queries).toEqual([]);
    expect(handleCookie(c)).toBe('__Host-poly_handle=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  });
});
