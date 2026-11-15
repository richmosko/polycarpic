// The sign-in service (POLY-148): a second Node process that serves /api/auth/* behind Caddy, as poly_auth, from this workspace's
// @poly/auth, unchanged. The only things added here, each a named deviation in the record:
//  - the outbound fetch to Google's hosts is pointed at the fake Google (README),
//  - rate limiting off, requireClientIp false, plain HTTP origin (README),
//  - cookies: __Secure- prefix and Path=/api/auth (the cookie-scope item),
//  - handle-plugin.ts, the second cookie (the hashed-handle item).
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const IDP = new Set(['accounts.google.com', 'oauth2.googleapis.com', 'openidconnect.googleapis.com', 'www.googleapis.com']);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init?: unknown) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const u = new URL(raw);
  if (IDP.has(u.hostname)) {
    const to = `http://127.0.0.1:${process.env.IDP_PORT ?? 58488}${u.pathname}${u.search}`;
    return realFetch(typeof input === 'string' || input instanceof URL ? to : new Request(to, input as Request), init as RequestInit);
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

const { authOptions, createAuth, handleAuthRequest } = await import(pathToFileURL(path.join(root, 'packages/auth/src/index.ts')).href);
// The same better-auth instance @poly/auth loads, so createAuthMiddleware and the endpoint context are the same classes.
const baFrom = createRequire(path.join(root, 'packages/auth/package.json'));
const { createAuthMiddleware } = await import(pathToFileURL(baFrom.resolve('better-auth/api')).href);
const { handlePlugin } = await import('./handle-plugin.ts');

const ORIGIN = `http://127.0.0.1:${process.env.CADDY_PORT ?? 58480}`;
const MAIL = `http://127.0.0.1:${process.env.MAIL_PORT ?? 58489}/mail`;
const options = authOptions({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: ORIGIN,
  tlsMode: 'real-domain',
  requireClientIp: false,
  google: { clientId: 'qa-google', clientSecret: 'qa-google-secret' },
  sendMagicLink: async (m: { email: string; url: string; token: string }) => {
    await realFetch(MAIL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: m.email, url: m.url, token: m.token }) });
  },
});
const opts = options as unknown as { rateLimit: unknown; advanced: Record<string, unknown> & { defaultCookieAttributes: Record<string, unknown> }; plugins: unknown[]; database: { query: (q: string, v?: unknown[]) => Promise<{ rows: unknown[] }> } };
opts.rateLimit = { enabled: false };
if (process.env.POLY148_COOKIE_SCOPE !== 'host') {
  // path-scoped: a __Host- cookie must be Path=/, so the prefix changes with the path
  opts.advanced.cookiePrefix = '__Secure-better-auth';
  opts.advanced.defaultCookieAttributes = { ...opts.advanced.defaultCookieAttributes, path: '/api/auth' };
}
// Last in the array: plugin after-hooks run after options.hooks.after, and twoFactor's hold runs before this one, so a held sign-in has no newSession here.
opts.plugins.push(handlePlugin({ createAuthMiddleware, query: (q, v) => opts.database.query(q, v), cookieName: process.env.POLY148_HANDLE_COOKIE ?? '__Host-poly_handle', option: process.env.POLY148_OPTION ?? '1' }));
const auth = createAuth(options as never);

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  try {
    if (!(url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/'))) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not found"}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    headers.set('x-forwarded-for', headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1');
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
    const r = await handleAuthRequest(new Request(new URL(req.url ?? '/', ORIGIN), { method: req.method, headers, body }), auth);
    const out: Record<string, string | string[]> = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const sc = r.headers.getSetCookie();
    if (sc.length) out['set-cookie'] = sc;
    res.writeHead(r.status, out).end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'application/json' }).end('{"message":"error"}');
  }
}).listen(Number(process.env.SERVICE_PORT), '127.0.0.1');
