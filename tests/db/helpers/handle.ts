// POLY-153: the session handle in tests. One place builds a session with its handle row (R10), so every fixture that inserts
// public.session commits with its handle (R5.2 refuses a handle-less session at commit, superuser included).
//   app.session_handle (session_id, handle_hash bytea = sha256(utf8(handle))); the plain handle is 43 base64url characters.
import { createHash, randomBytes } from 'node:crypto';
import { must } from './sql';
import type { Q } from './second-step';

export const HANDLE_COOKIE = '__Host-poly_handle';
export const newHandle = (): string => randomBytes(32).toString('base64url');
export const hashOf = (handle: string): Buffer => createHash('sha256').update(handle, 'utf8').digest();
export const hashHex = (handle: string): string => hashOf(handle).toString('hex');

/**
 * Rewrite one `INSERT INTO public.session (cols) VALUES (vals) [ON CONFLICT DO NOTHING] [RETURNING r]` into a single statement that also
 * inserts the handle row (random, unknown handle). One statement, so the deferred check at commit sees both. Superuser fixtures only.
 */
export function withHandle(sql: string): string {
  const m = /^\s*INSERT INTO public\.session\s*(\([^)]*\))\s*VALUES\s*(\(.*?\))(\s+ON CONFLICT DO NOTHING)?(?:\s+RETURNING\s+(.+?))?\s*;?\s*$/s.exec(sql);
  if (!m) throw new Error(`withHandle: not a plain session insert: ${sql.slice(0, 80)}`);
  const [, cols, vals, conflict = '', ret = 'id'] = m;
  return `WITH ins AS (INSERT INTO public.session ${cols} VALUES ${vals}${conflict} RETURNING *), h AS (INSERT INTO app.session_handle (session_id, handle_hash) SELECT id, sha256(convert_to(gen_random_uuid()::text, 'UTF8')) FROM ins) SELECT ${ret} FROM ins`;
}

export type SessionOpts = { fresh?: boolean; recentSecondsAgo?: number; createdDaysAgo?: number; expiresInDays?: number; id?: string; token?: string; handle?: string };
/** A session and its handle row, committed together as superuser. Returns the plain handle and the token. */
export function sessionWithHandle(db: string, userId: string, o: SessionOpts = {}): { id: string; token: string; handle: string } {
  const token = o.token ?? `tk${Math.random().toString(36).slice(2)}${Date.now()}`;
  const handle = o.handle ?? newHandle();
  const cols = ['user_id', 'token', 'expires_at', ...(o.id ? ['id'] : []), ...(o.fresh || o.recentSecondsAgo !== undefined ? ['recent_auth_at'] : []), ...(o.createdDaysAgo !== undefined ? ['created_at'] : [])];
  const vals = [`'${userId}'`, `'${token}'`, `now() + interval '${o.expiresInDays ?? 1} days'`, ...(o.id ? [`'${o.id}'`] : []), ...(o.recentSecondsAgo !== undefined ? [`now() - interval '${o.recentSecondsAgo} seconds'`] : o.fresh ? ['now()'] : []),
    ...(o.createdDaysAgo !== undefined ? [`now() - interval '${o.createdDaysAgo} days'`] : [])];
  const id = must(`WITH ins AS (INSERT INTO public.session (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id),
    h AS (INSERT INTO app.session_handle (session_id, handle_hash) SELECT id, decode('${hashHex(handle)}', 'hex') FROM ins) SELECT id FROM ins`, db).rows[0]![0]!;
  return { id, token, handle };
}
/** Attach a fresh handle to a session created in this poly_auth transaction (the plugin's call). Returns the plain handle. */
export async function attach(q: Q, sessionId: string, handle = newHandle()): Promise<string> {
  await q('SELECT app.attach_session_handle($1, $2)', [sessionId, handle]);
  return handle;
}
/** The handle value a Response sets, or null. */
export function handleOf(res: Response): string | null {
  for (const c of res.headers.getSetCookie()) {
    const kv = c.split(';')[0]!;
    if (kv.startsWith(`${HANDLE_COOKIE}=`)) return kv.slice(HANDLE_COOKIE.length + 1) || null;
  }
  return null;
}
export const handleSetCookie = (res: Response): string | undefined => res.headers.getSetCookie().find((c) => c.startsWith(`${HANDLE_COOKIE}=`));
/** The extended-mode canonical entry call. */
export const ENTER_SESSION = 'SELECT * FROM app.enter_session($1)';

/**
 * POLY-149: a live handle for `userId`, optionally for the named session `sid` (the id a test asserts through current_session_id()).
 * A known session keeps its id and gets a fresh handle (superuser fixture); an unknown one is created. The user row is made if absent.
 */
export function handleFor(db: string, userId: string, sid?: string | null): string {
  must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${userId}', 'T', 'tenant-${userId}@qa.test', true) ON CONFLICT DO NOTHING`, db);
  const owner = sid ? must(`SELECT user_id FROM public.session WHERE id = '${sid}'`, db).rows[0]?.[0] : undefined;
  if (sid && owner === userId) {
    const handle = newHandle();
    must(`UPDATE app.session_handle SET handle_hash = decode('${hashHex(handle)}', 'hex') WHERE session_id = '${sid}'`, db);
    return handle;
  }
  // the named id is free: make it. It names another user's session (suites reuse one SID across users): a fresh id, so the entry is still this user's
  return sessionWithHandle(db, userId, sid && owner === undefined ? { id: sid } : {}).handle;
}
/** The stand-in for the removed asserted-user tenant wrapper: enter by handle (`withSession`); fn gets the transaction. */
export const tenantBy = (m: { withSession: (h: string, fn: (tx: any) => Promise<any>) => Promise<any> }, db: string, sid?: string) =>
  <T>(uid: string, fn: (tx: any) => Promise<T>): Promise<T> => m.withSession(handleFor(db, uid, sid), (tx: any) => fn(tx));
