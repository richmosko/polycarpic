// The session handle (POLY-153 R5.1): the second after-hook of the last plugin (cookieLifetime). When BetterAuth issued a session, this
// draws 32 bytes from the CSPRNG, has app.attach_session_handle store their SHA-256 on the request's own transaction, and sets the
// handle as __Host-poly_handle. The handle is never derived from session.token, and it appears only in the Set-Cookie header: not in a
// URL, a body, a log line or an error message. No transaction of ours is a failure, not a fallback. When the session cookie is being
// cleared (sign-out, revoke of the current session), the handle cookie is cleared with it.
import { randomBytes } from 'node:crypto';
import { currentClient } from '@poly/db/auth';

export const HANDLE_COOKIE = '__Host-poly_handle';
const BASE = `${HANDLE_COOKIE}=`;
const ATTRS = 'HttpOnly; Secure; SameSite=Lax';

interface HookCtx {
  context?: {
    responseHeaders?: Headers;
    newSession?: { session?: { id?: string } } | null;
    authCookies?: { sessionToken?: { name?: string } };
  };
}

export async function handleAfter(ctx: HookCtx): Promise<Record<string, never>> {
  const rh = ctx?.context?.responseHeaders;
  const name = ctx?.context?.authCookies?.sessionToken?.name;
  if (!rh || !name) return {};
  const tokenCookie = rh.getSetCookie().find((c) => c.startsWith(`${name}=`));
  const sessionId = ctx?.context?.newSession?.session?.id;
  if (!sessionId) {
    // A cleared session cookie clears the handle with it.
    if (tokenCookie && /;\s*Max-Age=0(;|$)/i.test(tokenCookie)) rh.append('set-cookie', `${BASE}; Path=/; Max-Age=0; ${ATTRS}`);
    return {};
  }
  const cur = currentClient();
  if (!cur) throw new Error('session handle: no request transaction'); // fail closed: a 500, never a session without its handle
  const handle = randomBytes(32).toString('base64url');
  const res = await cur.client.query('SELECT app.attach_session_handle($1, $2)', [sessionId, handle]);
  // The single column is read by position, so no alias is needed in the statement the definer compares.
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || Object.values(row)[0] !== true) return {}; // false: the session already has its handle (refresh)
  const age = tokenCookie ? /;\s*Max-Age=(\d+)/i.exec(tokenCookie) : null;
  rh.append('set-cookie', `${BASE}${handle}; Path=/; ${ATTRS}${age && Number(age[1]) > 0 ? `; Max-Age=${age[1]}` : ''}`);
  return {};
}
