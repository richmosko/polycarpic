// POLY-147 ruling R6: identity in a psql script is the definer's exact call, bound with \bind (a call with literals is
// refused by the exact-call check). psql >= 16 is required; global-setup.ts checks it. Output goes to /dev/null so the
// returned xid never lands in a test's rows. Each call sits on its own lines because \g takes the rest of its line.
// psql has no NULL parameter, so a null argument is tested through node-pg, not here.
import { sessionWithHandle } from './handle';
export const SID = '00000000-0000-4000-8000-0000000005e1';
/** POLY-149: the canonical entry by handle. The session and its handle are made here (superuser), so `db` is needed. */
export const asUserSql = (uid: string, db: string): string =>
  `\nSELECT * FROM app.enter_session($1) \\bind '${sessionWithHandle(db, uid).handle}' \\g /dev/null\n`;
/** POLY-149: a poly_auth transaction's entry (enter_auth_session) from a live session made here, for scripts run as poly_auth. */
export const asAuthSql = (uid: string, db: string): string =>
  `\nSELECT app.enter_auth_session($1) \\bind '${sessionWithHandle(db, uid).token}' \\g /dev/null\n`;
export const asJobSql = (job: string, entity: string, connection: string): string =>
  `\nSELECT app.enter_job($1, $2, $3) \\bind '${job}' '${entity}' '${connection}' \\g /dev/null\n`;
export const newUserSql = (uid: string): string => `\nSELECT app.enter_new_user($1) \\bind '${uid}' \\g /dev/null\n`;
