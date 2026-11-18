// The service side of the session lookup (POLY-152 R6.2) and the 30-day cap. apps/auth serves handleSessionRequest on its internal
// listener; web calls it over HTTP through @poly/auth/web. loadSession here is the in-process composition for tests: the same
// service answer, then web's own provisioning and gate, with no HTTP between them.
import { defaultAuth, type AnyAuth } from './handler.ts';
import { cappedOut } from './recent-auth.ts';
import { completeSession, loadSessionFromService, type LoadedSession, type Logger } from './web.ts';

export { HttpError, listSessions, revokeSession, listMySessions, revokeMySession, myLandingEntity, type ShellSession, type LoadedSession, type Identity, type SessionRow } from './web.ts';

const ORIGIN = 'http://auth.in-process';

/**
 * GET /session on the internal listener: the signed cookie is the only input. BetterAuth checks the cookie's HMAC and slides the row
 * (`getSession`), the cap check deletes a row past 30 days. Answers 200 with exactly five keys, or 204. Never a Set-Cookie (R7).
 */
export async function handleSessionRequest(request: Request, given: Promise<AnyAuth> | AnyAuth = defaultAuth()): Promise<Response> {
  // The listener's one route: any other path, method or query string is 404 (a bare '?' parses to an empty search, so the text is tested).
  if (request.method !== 'GET' || request.url.includes('?') || new URL(request.url).pathname !== '/session') {
    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const auth = await given;
  // Only the cookie goes to BetterAuth: no other header of the request can name a user, a session or an address.
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const got = (await auth.api.getSession({ headers })) as null | {
    session: { id: string; token: string; createdAt: Date; expiresAt: Date };
    user: { id: string; name: string; image?: string | null };
  };
  if (!got) return new Response(null, { status: 204 });
  if (cappedOut(got.session.createdAt)) {
    await (await auth.$context).internalAdapter.deleteSession(got.session.token);
    return new Response(null, { status: 204 });
  }
  return Response.json({
    userId: got.user.id,
    sessionId: got.session.id,
    name: got.user.name,
    image: got.user.image ?? null,
    expiresAt: new Date(got.session.expiresAt).toISOString(),
  });
}

/** In-process loader for tests: the service's answer (no HTTP), then web's provisioning and gate. */
export async function loadSession(request: Request, given: Promise<AnyAuth> | AnyAuth = defaultAuth(), logger?: Logger): Promise<LoadedSession | null> {
  const inProcess = (async (_url: unknown, init: RequestInit) => handleSessionRequest(new Request(`${ORIGIN}/session`, { headers: init.headers }), given)) as unknown as typeof fetch;
  const found = await loadSessionFromService(request, { origin: ORIGIN, fetch: inProcess });
  return found ? completeSession(found, logger) : null;
}
