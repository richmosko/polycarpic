// Settings → Sessions and the step-up check, for web (POLY-152 R6.3). A web-side file: it imports `@poly/db` and `sql` only, never
// better-auth and never `@poly/db/auth` (the boundary test resolves this file's imports transitively). The root of `@poly/auth`
// re-exports listSessions and revokeSession for the in-process tests.
import { sql, type Tx } from '@poly/db';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  current: boolean;
}

const WINDOW_SECONDS = 300;

/** The caller's sessions: never the token. The session table has no RLS, so the filter is explicit. */
export async function listSessions(tx: Tx): Promise<SessionRow[]> {
  const res = await tx.execute<{ id: string; user_agent: string | null; ip_address: string | null; created_at: Date | string; updated_at: Date | string; current: boolean }>(sql`
    SELECT id, user_agent, ip_address, created_at, updated_at,
           (id::text = coalesce(app.current_session_id()::text, '')) AS current
    FROM public.session WHERE user_id = app.current_user_id() ORDER BY created_at`);
  return res.rows.map((r) => ({ id: r.id, userAgent: r.user_agent, ipAddress: r.ip_address, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at), current: r.current }));
}

/** Step-up: a session passes only within 5 minutes of its recent_auth_at, by the database's clock. A stamp in the future, or none, is refused. */
async function requireFresh(tx: Tx, sessionId: string): Promise<void> {
  const res = await tx.execute<{ age: number | null }>(sql`SELECT extract(epoch FROM (now() - recent_auth_at))::float8 AS age FROM public.session WHERE id = ${sessionId}::uuid`);
  const age = res.rows[0]?.age;
  if (age == null || age < 0 || age > WINDOW_SECONDS) throw new HttpError(403, 'step_up_required');
}

/** Revokes by id for the caller. Another session than the current one is a step-up action; the current one is sign-out. */
export async function revokeSession(tx: Tx, id: string): Promise<void> {
  const own = await tx.execute<{ current: boolean }>(sql`
    SELECT (id::text = coalesce(app.current_session_id()::text, '')) AS current
    FROM public.session WHERE id = ${id}::uuid AND user_id = app.current_user_id()`);
  if (own.rows.length === 0) throw new HttpError(404, 'not_found');
  if (!own.rows[0]!.current) {
    const cur = await tx.execute<{ s: string }>(sql`SELECT coalesce(app.current_session_id()::text, '') AS s`);
    await requireFresh(tx, cur.rows[0]!.s);
  }
  await tx.execute(sql`DELETE FROM public.session WHERE id = ${id}::uuid AND user_id = app.current_user_id()`);
}
