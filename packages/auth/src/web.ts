// @poly/auth/web (POLY-152 R6.2): what apps/web may import. It imports neither better-auth nor @poly/db/auth, and no file outside
// packages/auth/src/web*: web holds no BetterAuth instance and no secret. The session lookup is a call to the sign-in service.
import { sql, withTenant } from '@poly/db';
import { sessionUserId, type SessionUserId } from '@poly/db/session';
import { landingEntity, provisionPerson } from '@poly/tenancy';
import { HttpError, listSessions, revokeSession, type SessionRow } from './web/sessions.ts';

export { HttpError, listSessions, revokeSession, type SessionRow };

export type ShellSession = {
  user: { id: string; name: string; image: string | null };
  expiresAt: string;
};
export interface LoadedSession {
  userId: SessionUserId;
  sessionId: string;
  shell: ShellSession;
  /** app.second_step_required(): the sign-in gate (POLY-89 R4, R5). One answer from the database; nothing here re-derives it. */
  secondStepRequired: boolean;
}
/** What the service's GET /session answers with (R6.2): exactly these five keys. */
export interface ServiceSession {
  userId: string;
  sessionId: string;
  name: string;
  image: string | null;
  expiresAt: string;
}
export interface Logger {
  error(event: string, fields: Record<string, unknown>): void;
}
export interface Identity {
  userId: string;
  sessionId: string;
}

const consoleLogger: Logger = { error: (event, fields) => console.error(JSON.stringify({ event, ...fields })) };
const TIMEOUT_MS = 2000;
const KEYS = ['expiresAt', 'image', 'name', 'sessionId', 'userId'];
/** BetterAuth's own session cookie (any prefix); nothing else of the page request goes to the service. */
const SESSION_COOKIE = /better-auth\.session_token$/;

let origin: string | undefined;
/** Web's start-up hands the service's internal origin over (AUTH_INTERNAL_URL, from loadConfig('web')). */
export function setAuthInternalOrigin(o: string | undefined): void {
  origin = o;
}

const unavailable = () => new HttpError(503, 'auth_unavailable');

/** The call to the service, before web's own provisioning and gate. null: no session. An unreachable or odd answer is a 503, never null. */
export async function loadSessionFromService(request: Request, o: { origin?: string; fetch?: typeof fetch } = {}): Promise<ServiceSession | null> {
  const base = o.origin ?? origin;
  if (!base) throw unavailable();
  const cookie = (request.headers.get('cookie') ?? '')
    .split(/;\s*/)
    .filter((c) => SESSION_COOKIE.test(c.split('=')[0]!))
    .join('; ');
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(`${base}/session`, { method: 'GET', headers: { cookie }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
  } catch {
    throw unavailable();
  }
  if (res.status === 204) return null;
  if (res.status !== 200) throw unavailable();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw unavailable();
  }
  if (!body || typeof body !== 'object' || Object.keys(body).sort().join() !== KEYS.join()) throw unavailable();
  return body as ServiceSession;
}

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

/** What web does with the service's answer: gives the user their own Person on first load (retry once on the race), then the gate. */
export async function completeSession(found: ServiceSession, logger: Logger = consoleLogger): Promise<LoadedSession> {
  const userId = sessionUserId(found.userId);
  const sessionId = found.sessionId;
  const provision = () => withTenant(userId, sessionId, (tx) => provisionPerson(tx));
  try {
    await provision();
  } catch (e) {
    if (!isSelfUniqueRace(e)) {
      logger.error('session.provision_failed', { code: pgError(e)?.code ?? 'unknown', constraint: pgError(e)?.constraint, userId });
      throw e;
    }
    try {
      await provision(); // the whole transaction again, fresh; it finds the winner's Person
    } catch (again) {
      logger.error('session.provision_failed', { code: pgError(again)?.code ?? 'unknown', constraint: pgError(again)?.constraint, userId });
      throw again;
    }
  }
  const gate = await withTenant(userId, sessionId, (tx) => tx.execute<{ r: boolean }>(sql`SELECT app.second_step_required() AS r`));
  return {
    userId,
    sessionId,
    secondStepRequired: gate.rows[0]?.r === true,
    shell: { user: { id: found.userId, name: found.name, image: found.image ?? null }, expiresAt: new Date(found.expiresAt).toISOString() },
  };
}

/** The signed-in user for a page request, or null. */
export async function loadSession(request: Request, logger: Logger = consoleLogger): Promise<LoadedSession | null> {
  const found = await loadSessionFromService(request);
  return found ? completeSession(found, logger) : null;
}

/** Settings → Sessions for the request's identity (apps/web holds no SessionUserId brand). */
export const listMySessions = (who: Identity): Promise<SessionRow[]> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => listSessions(tx));
export const revokeMySession = (who: Identity, id: string): Promise<void> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => revokeSession(tx, id));

/** The entity the signed-in user lands on at "/": the newest one an invitation seated, else their own Person (POLY-87 R3). */
export const myLandingEntity = (who: Identity): Promise<string | null> => withTenant(sessionUserId(who.userId), who.sessionId, (tx) => landingEntity(tx));
