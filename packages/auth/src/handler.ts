// handleAuthRequest (POLY-86 ruling R4; seceng S1, S14): runs BetterAuth for one /api/auth/* request inside the right
// transaction of ours, and commits only when BetterAuth's answer is a success.
import { isIP } from 'node:net';
import { withAuthSession, withContextFreeTx, withSignInTx, type ClientMeta } from '@poly/db/auth';
import type { createAuth } from './index.ts';
import { matchAuthPath, USER_INSERTING } from './route-policy.ts';
import { cappedOut } from './recent-auth.ts';
import { COMMIT_HEADER } from './anchor.ts';
import { HANDLE_COOKIE } from './session-handle.ts';

export type AnyAuth = Awaited<ReturnType<typeof createAuth>>;

let app: Promise<AnyAuth> | AnyAuth | undefined;
/** The app's own instance, set once at startup by apps/web. */
export function setDefaultAuth(auth: Promise<AnyAuth> | AnyAuth): void {
  app = auth;
}
export function defaultAuth(): Promise<AnyAuth> | AnyAuth {
  if (!app) throw new Error('auth: no default instance; call setDefaultAuth at startup');
  return app;
}

class RollbackWith extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super('rollback');
    this.response = response;
  }
}

/** A failure BetterAuth reports as a Response: status >= 400, or a redirect to its error page / an ?error= query. */
function isFailure(res: Response): boolean {
  if (res.status >= 400) return true;
  if (res.status >= 300) {
    const loc = res.headers.get('location');
    if (loc) {
      const u = new URL(loc, 'http://x');
      return u.pathname.endsWith('/error') || u.searchParams.has('error');
    }
  }
  return false;
}

function withoutCookies(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.delete('set-cookie');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Drops the internal header from every answer; it never leaves the process. */
function withoutCommitHeader(res: Response): Response {
  if (!res.headers.has(COMMIT_HEADER)) return res;
  const headers = new Headers(res.headers);
  headers.delete(COMMIT_HEADER);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** The paths that create a session on a single factor and have no handle yet: one transaction for every row (R9). */
const SIGN_IN_TX = new Set(['/sign-in/email', '/passkey/verify-authentication', '/two-factor/verify-totp', '/two-factor/verify-backup-code']);
/** The second-step paths also commit a refusal below 500: the wrong-code count and the lockout survive a refused code (R9). */
const COMMITS_REFUSAL = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

async function inTransaction(request: Request, auth: AnyAuth, run: <T>(fn: () => Promise<T>) => Promise<T>, contextFree = false): Promise<Response> {
  // The header commits only the wrong-code answer of /second-step/confirm-code, a 403 (it records the attempt). Anywhere else it is
  // ignored: a failure rolls back as before.
  const template = matchAuthPath(new URL(request.url).pathname)?.template;
  const keeps = (res: Response): boolean =>
    (res.headers.has(COMMIT_HEADER) && res.status === 403 && template === '/second-step/confirm-code') ||
    (template !== undefined && COMMITS_REFUSAL.has(template) && res.status >= 400 && res.status < 500);
  try {
    const res = await run(async () => {
      const res = await auth.handler(request);
      if (isFailure(res) && !keeps(res)) throw new RollbackWith(res);
      return res;
    });
    return withoutCommitHeader(res);
  } catch (e) {
    if (e instanceof RollbackWith) return withoutCommitHeader(withoutCookies(e.response));
    // R5.2: a session that would commit without its handle is refused by the database at COMMIT. Nothing of the answer survives: a 5xx, no cookie.
    if ((e as { code?: string }).code === '23514') {
      console.error(JSON.stringify({ event: 'session_handle_missing', path: template }));
      return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    // A refusal the database raises at COMMIT (the stamp check, C32) surfaces after BetterAuth answered 200: the same 403.
    if (contextFree && (e as { code?: string }).code === '42501') {
      return new Response(JSON.stringify({ code: 'invitation_required', message: 'invitation_required' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    throw e;
  }
}

/** S19: exactly one X-Forwarded-For entry and it is an IP; anything else never reaches the limiter's shared bucket. */
const clientIpResolved = (request: Request): boolean => {
  const v = request.headers.get('x-forwarded-for');
  // BetterAuth's check is zod's; node's isIP also takes a zone id (fe80::1%eth0). Only address characters pass, so ours is never looser.
  return v !== null && /^[0-9a-fA-F:.]+$/.test(v.trim()) && isIP(v.trim()) !== 0;
};

/** The address (the single forwarded entry, when it is an address) and browser the sign-in service passes to the database (POLY-149 R3). */
const clientMeta = (request: Request): ClientMeta => ({
  ip: clientIpResolved(request) ? request.headers.get('x-forwarded-for')!.trim() : null,
  userAgent: request.headers.get('user-agent'),
});

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });

/** The cap's clearing cookie carries the path, Secure, SameSite and HttpOnly BetterAuth set the cookie with, never a literal Path=/ (C7). */
function clearingCookie(c: { name: string; attributes: { path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string } }): string {
  const a = c.attributes;
  const same = a.sameSite ? a.sameSite[0]!.toUpperCase() + a.sameSite.slice(1).toLowerCase() : 'Lax';
  const parts = [`${c.name}=`, `Path=${a.path ?? '/'}`, ...(a.domain ? [`Domain=${a.domain}`] : []), 'Max-Age=0', ...(a.httpOnly === false ? [] : ['HttpOnly']), `SameSite=${same}`, ...(a.secure ? ['Secure'] : [])];
  return parts.join('; ');
}

/** Every /api/auth answer is `no-store` whatever BetterAuth sent: enable returns the key and the codes, and a refusal is not for a cache either (POLY-150 R10). */
export async function handleAuthRequest(request: Request, given: Promise<AnyAuth> | AnyAuth = defaultAuth()): Promise<Response> {
  const res = await handleAuthRequestInner(request, given);
  if (res.headers.get('cache-control')?.toLowerCase() === 'no-store') return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handleAuthRequestInner(request: Request, given: Promise<AnyAuth> | AnyAuth): Promise<Response> {
  const route = matchAuthPath(new URL(request.url).pathname);
  if (!route || route.rule.class === 'blocked') return notFound(); // the same answer for an unlisted and a blocked path
  const auth = await given;
  const ctx = await auth.$context;
  if ((ctx.options as { requireClientIp?: boolean }).requireClientIp && !clientIpResolved(request)) {
    console.error(JSON.stringify({ event: 'client_ip_unresolved', path: route.template }));
    return new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  const got = await auth.api.getSession({ headers: request.headers });
  let session = got as null | { session: { id: string; token: string; createdAt: Date }; user: { id: string } };
  if (session && cappedOut(session.session.createdAt)) {
    await ctx.internalAdapter.deleteSession(session.session.token);
    session = null;
    // The session cookie and the handle cookie are cleared together; the session row's delete took the handle row by cascade.
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', clearingCookie(ctx.authCookies.sessionToken));
    headers.append('set-cookie', `${HANDLE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers,
    });
  }
  if (session) {
    const token = session.session.token;
    return inTransaction(request, auth, (fn) => withAuthSession(token, fn, clientMeta(request)));
  }
  if (USER_INSERTING.has(route.template)) return inTransaction(request, auth, (fn) => withContextFreeTx(fn, clientMeta(request)), true);
  if (SIGN_IN_TX.has(route.template)) return inTransaction(request, auth, (fn) => withSignInTx(fn, clientMeta(request)));
  return auth.handler(request);
}
