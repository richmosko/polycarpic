// The session loader, Settings → Sessions and the 30-day cap (POLY-86 ruling R5; seceng S13-S15).
import { sql, withTenant, type Tx } from '@poly/db';
import { sessionUserId, type SessionUserId } from '@poly/db/session';
import { landingEntity, provisionPerson } from '@poly/tenancy';
import { APIError } from 'better-auth/api';
import { defaultAuth, type AnyAuth } from './handler.ts';
import { cappedOut, requireRecentAuth } from './recent-auth.ts';

export type ShellSession = {
  user: { id: string; name: string; image: string | null };
  expiresAt: string;
};
export interface LoadedSession {
  userId: SessionUserId;
  sessionId: string;
  shell: ShellSession;
  /** BetterAuth's own refreshed Set-Cookie headers, and nothing else. */
  setCookie: string[];
}
export interface Logger {
  error(event: string, fields: Record<string, unknown>): void;
}

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

const consoleLogger: Logger = { error: (event, fields) => console.error(JSON.stringify({ event, ...fields })) };

interface PgLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}
/** Drizzle may wrap the pg error: walk .cause for the one carrying the code. */
function pgError(e: unknown): PgLike | null {
  for (let cur: unknown = e, n = 0; cur && typeof cur === 'object' && n < 5; cur = (cur as PgLike).cause, n++) {
    if (typeof (cur as PgLike).code === 'string') return cur as PgLike;
  }
  return null;
}
const isSelfUniqueRace = (e: unknown): boolean => {
  const p = pgError(e);
  return p?.code === '23505' && p.constraint === 'entity_self_user_id_unique';
};

const provision = (userId: SessionUserId, sessionId: string) => withTenant(userId, sessionId, (tx) => provisionPerson(tx));

/** The signed-in user for a page request, or null. Gives the user their own Person on first load (retry once on the race). */
export async function loadSession(request: Request, given: Promise<AnyAuth> | AnyAuth = defaultAuth(), logger: Logger = consoleLogger): Promise<LoadedSession | null> {
  const auth = await given;
  const got = (await auth.api.getSession({ headers: request.headers, returnHeaders: true })) as {
    headers: Headers;
    response: { session: { id: string; token: string; createdAt: Date; expiresAt: Date }; user: { id: string; name: string; image?: string | null } } | null;
  };
  const found = got.response;
  if (!found) return null;
  if (cappedOut(found.session.createdAt)) {
    await (await auth.$context).internalAdapter.deleteSession(found.session.token);
    return null;
  }
  const userId = sessionUserId(found.user.id);
  const sessionId = found.session.id;
  try {
    await provision(userId, sessionId);
  } catch (e) {
    if (!isSelfUniqueRace(e)) {
      logger.error('session.provision_failed', { code: pgError(e)?.code ?? 'unknown', constraint: pgError(e)?.constraint, userId });
      throw e;
    }
    try {
      await provision(userId, sessionId); // the whole transaction again, fresh; it finds the winner's Person
    } catch (again) {
      logger.error('session.provision_failed', { code: pgError(again)?.code ?? 'unknown', constraint: pgError(again)?.constraint, userId });
      throw again;
    }
  }
  return {
    userId,
    sessionId,
    shell: { user: { id: found.user.id, name: found.user.name, image: found.user.image ?? null }, expiresAt: new Date(found.session.expiresAt).toISOString() },
    setCookie: got.headers.getSetCookie(),
  };
}

export interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  current: boolean;
}

/** The caller's sessions: never the token. The session table has no RLS, so the filter is explicit. */
export async function listSessions(tx: Tx): Promise<SessionRow[]> {
  const res = await tx.execute<{ id: string; user_agent: string | null; ip_address: string | null; created_at: Date | string; updated_at: Date | string; current: boolean }>(sql`
    SELECT id, user_agent, ip_address, created_at, updated_at,
           (id::text = coalesce(pg_catalog.current_setting('app.session_id', true), '')) AS current
    FROM public.session WHERE user_id = app.current_user_id() ORDER BY created_at`);
  return res.rows.map((r) => ({ id: r.id, userAgent: r.user_agent, ipAddress: r.ip_address, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at), current: r.current }));
}

/** Revokes by id for the caller. Another session than the current one is a step-up action; the current one is sign-out. */
export async function revokeSession(tx: Tx, id: string): Promise<void> {
  const own = await tx.execute<{ current: boolean }>(sql`
    SELECT (id::text = coalesce(pg_catalog.current_setting('app.session_id', true), '')) AS current
    FROM public.session WHERE id = ${id}::uuid AND user_id = app.current_user_id()`);
  if (own.rows.length === 0) throw new HttpError(404, 'not_found');
  if (!own.rows[0]!.current) {
    const cur = await tx.execute<{ s: string }>(sql`SELECT coalesce(pg_catalog.current_setting('app.session_id', true), '') AS s`);
    try {
      await requireRecentAuth(cur.rows[0]!.s);
    } catch (e) {
      if (e instanceof APIError) throw new HttpError(403, 'step_up_required');
      throw e;
    }
  }
  await tx.execute(sql`DELETE FROM public.session WHERE id = ${id}::uuid AND user_id = app.current_user_id()`);
}

export interface Identity {
  userId: string;
  sessionId: string;
}

/** Settings → Sessions for the request's identity (apps/web holds no SessionUserId brand). */
export const listMySessions = (who: Identity): Promise<SessionRow[]> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => listSessions(tx));
export const revokeMySession = (who: Identity, id: string): Promise<void> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => revokeSession(tx, id));

/** The entity the signed-in user lands on at "/": the newest one an invitation seated, else their own Person (POLY-87 R3). */
export const myLandingEntity = (who: Identity): Promise<string | null> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => landingEntity(tx));
