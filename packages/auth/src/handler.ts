// handleAuthRequest (POLY-86 ruling R4; seceng S1, S14): runs BetterAuth for one /api/auth/* request inside the right
// transaction of ours, and commits only when BetterAuth's answer is a success.
import { withContextFreeTx } from '@poly/db/auth';
import { withTenant } from '@poly/db';
import { sessionUserId } from '@poly/db/session';
import type { createAuth } from './index.ts';
import { matchAuthPath, USER_INSERTING } from './route-policy.ts';
import { cappedOut } from './recent-auth.ts';

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

async function inTransaction(request: Request, auth: AnyAuth, run: <T>(fn: () => Promise<T>) => Promise<T>): Promise<Response> {
  try {
    return await run(async () => {
      const res = await auth.handler(request);
      if (isFailure(res)) throw new RollbackWith(res);
      return res;
    });
  } catch (e) {
    if (e instanceof RollbackWith) return withoutCookies(e.response);
    throw e;
  }
}

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });

export async function handleAuthRequest(request: Request, given: Promise<AnyAuth> | AnyAuth = defaultAuth()): Promise<Response> {
  const route = matchAuthPath(new URL(request.url).pathname);
  if (!route || route.rule.class === 'blocked') return notFound(); // the same answer for an unlisted and a blocked path
  const auth = await given;
  const got = await auth.api.getSession({ headers: request.headers });
  let session = got as null | { session: { id: string; token: string; createdAt: Date }; user: { id: string } };
  const ctx = await auth.$context;
  if (session && cappedOut(session.session.createdAt)) {
    await ctx.internalAdapter.deleteSession(session.session.token);
    session = null;
    const c = ctx.authCookies.sessionToken;
    const attrs = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax', ...(c.attributes.secure ? ['Secure'] : [])];
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'set-cookie': `${c.name}=; ${attrs.join('; ')}` },
    });
  }
  if (session) {
    const { id: sessionId } = session.session;
    return inTransaction(request, auth, (fn) => withTenant(sessionUserId(session!.user.id), sessionId, fn));
  }
  if (USER_INSERTING.has(route.template)) return inTransaction(request, auth, (fn) => withContextFreeTx(fn));
  return auth.handler(request);
}
