// @poly/auth/web (POLY-153 R7): what apps/web may import. It imports neither better-auth nor @poly/db/auth, and no file outside
// packages/auth/src/web*: web holds no BetterAuth instance and no secret, and asks nobody who is signed in. It hands Postgres the
// __Host-poly_handle cookie (withSession); the database hashes and checks it in app.enter_session.
import { withSession } from '@poly/db';
import { landingEntity } from '@poly/tenancy';
import { HttpError, listSessions, revokeSession, type SessionRow } from './web/sessions.ts';

export { HttpError, listSessions, revokeSession, type SessionRow };

export type ShellSession = {
  user: { id: string; name: string; image: string | null };
  expiresAt: string;
};
/** Settings → Sessions for the request's handle. */
export const listMySessions = (handle: string): Promise<SessionRow[]> => withSession(handle, (tx) => listSessions(tx));
/** Revokes one of the caller's sessions; answers whether it was the current one (the caller then clears the handle cookie). */
export const revokeMySession = (handle: string, id: string): Promise<{ current: boolean }> =>
  withSession(handle, async (tx, row) => {
    await revokeSession(tx, id);
    return { current: id === row.sessionId };
  });

/** The entity the signed-in user lands on at "/": the newest one an invitation seated, else their own Person (POLY-87 R3). */
export const myLandingEntity = (handle: string): Promise<string | null> => withSession(handle, (tx) => landingEntity(tx));
