// Settings → Sessions and the step-up check, for web (POLY-153 R6). A web-side file: it imports `@poly/db` and `sql` only, never
// better-auth and never `@poly/db/auth`, and its SQL names no BetterAuth table: it calls the three definers (app.my_sessions,
// app.recent_auth_ok through revoke_my_session, app.revoke_my_session), each of which requires a marker of kind `session`.
import { sql, type Tx } from '@poly/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface PgLike {
  code?: string;
  message?: string;
  cause?: unknown;
}
/** Drizzle may wrap the pg error: walk .cause for the one carrying the code. */
function pgError(e: unknown): PgLike | null {
  for (let cur: unknown = e, n = 0; cur && typeof cur === 'object' && n < 5; cur = (cur as PgLike).cause, n++) {
    if (typeof (cur as PgLike).code === 'string') return cur as PgLike;
  }
  return null;
}

/** The caller's sessions: never the token and never the handle. The definer scopes them to the marker's user. */
export async function listSessions(tx: Tx): Promise<SessionRow[]> {
  const res = await tx.execute<{ id: string; user_agent: string | null; ip_address: string | null; created_at: Date | string; updated_at: Date | string; current: boolean }>(
    sql`SELECT * FROM app.my_sessions()`,
  );
  return res.rows.map((r) => ({ id: r.id, userAgent: r.user_agent, ipAddress: r.ip_address, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at), current: r.current }));
}

/**
 * Revokes by id for the caller. Another session than the current one is a step-up action; the current one is sign-out. P0002 (not the
 * caller's, or unknown) is 404; 42501 step_up_required is 403. Anything else is thrown as it came.
 */
export async function revokeSession(tx: Tx, id: string): Promise<void> {
  // R8: an id that is not a uuid is a 404, not a 500 from the ::uuid cast. The same pattern as reauth.ts.
  if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(404, 'not_found');
  try {
    await tx.execute(sql`SELECT app.revoke_my_session(${id}::uuid)`);
  } catch (e) {
    const p = pgError(e);
    if (p?.code === 'P0002') throw new HttpError(404, 'not_found');
    if (p?.code === '42501' && /step_up_required/.test(p.message ?? '')) throw new HttpError(403, 'step_up_required');
    throw e;
  }
}
