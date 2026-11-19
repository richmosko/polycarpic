// The web-side session functions, re-exported at the root for the in-process tests (POLY-153 R7). The interim /session handler and the
// in-process session loader are gone (R9): the service answers nobody who is signed in; web enters by the handle.
export { HttpError, listSessions, revokeSession, listMySessions, revokeMySession, myLandingEntity, type ShellSession } from './web.ts';
