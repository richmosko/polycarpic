// POLY-89c fixtures shared by the second-step suites (ruling 6eed53f8). Marked transactions are the POLY-147 shape: BEGIN, then
// app.enter_session($1) (or enter_auth_session for poly_auth) as its own extended-mode statement, then the test's statements. `poly_auth` is the stage-2
// fixture role created once per run in helpers/api.ts setRolePasswords (R1.3).
import { expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DB_PKG, url } from './pg.ts';
import { must } from './sql.ts';
import { ENTER_SESSION, handleFor, withHandle } from './handle.ts';

export const pgmod = createRequire(join(DB_PKG, 'package.json'))('pg');
export const ROLES = ['poly_auth'] as const; // POLY-149: poly_app holds nothing on the factor tables (pinned by pgTAP 11 and revocation.test.ts)
export type Role = 'poly_app' | 'poly_auth'; // poly_app stays a legal ENTRY role (tenant tables); it just writes no factor table
export type Q = (text: string, values?: unknown[]) => Promise<any>;
export const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (x) { return x as any; } };
export const msgOf = (x: any): string => String(x?.cause?.message ?? x?.message ?? x);
export const codeOf = (x: any): string | undefined => x?.code ?? x?.cause?.code;

/**
 * POLY-152: poly_auth is the real role from roles.sql (harness password set in api.ts setRolePasswords); the `IN ROLE poly_app`
 * fixture of POLY-89c is gone. A marked transaction as poly_auth enters by `app.enter_auth_session(token)` from a live session row
 * (ruling R5, R8); as poly_app it enters by `app.enter_session` with a handle (POLY-149).
 */
/** Enter the marker as `role` for `userId`. poly_auth needs a live session row: `sessionId` names one, or a fresh row is made. */
export async function enterAs(q: Q, db: string, role: Role, userId: string, sessionId: string | null): Promise<void> {
  if (role === 'poly_app') {
    // POLY-149: poly_app enters by handle, as web does. A named session keeps its id; a fresh handle replaces the one it had (superuser fixture).
    await q(ENTER_SESSION, [handleFor(db, userId, sessionId)]);
    return;
  }
  const rows = sessionId ? must(`SELECT token FROM public.session WHERE id = '${sessionId}'`, db).rows : [];
  const token: string = rows[0]?.[0] ?? (sessionId ? `no-such-session-${sessionId}` : must(withHandle(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${userId}', 'tk-auto-${Math.random()}', now() + interval '1 day') RETURNING token`), db).rows[0]![0]!);
  await q('SELECT app.enter_auth_session($1)', [token]);
}
/** A refusal that changed nothing: `snap` is read before and after, and the two must be equal (seceng §5.2: 42501 alone proves nothing). */
export async function refusedUnchanged(snap: () => unknown, attempt: () => Promise<unknown>): Promise<any> {
  const before = JSON.stringify(await snap());
  const x = await fails(attempt());
  expect(x, 'the statement must be refused').not.toBeNull();
  expect(JSON.stringify(await snap()), 'the refusal must leave the row(s) unchanged').toBe(before);
  return x;
}

let counter = 0;
export const uuid = (tag: number, k: number) => `00000000-0000-4000-8000-${String(tag).padStart(6, '0')}${String(k).padStart(6, '0')}`;

export function fixture(db: string, tag: number) {
  const next = () => ++counter + 1000 * (process.pid % 97);
  const user = async (o: { enrolled?: boolean } = {}) => {
    const id = uuid(tag, next());
    const email = `c${id.slice(-8)}@qa.test`;
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${id}', 'C', '${email}', true)`, db);
    await committed('poly_app', id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), $1, 'individual', $2)`, [`P${id}`, id]));
    must(`DELETE FROM public.session WHERE user_id = '${id}'`, db); // the entry above made a session and handle (POLY-149); a fixture user starts with none
    if (o.enrolled) must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${id}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${id}'; COMMIT;`, db);
    return { id, email };
  };
  /** A real session row (superuser fixture); `fresh` stamps recent_auth_at now. */
  const session = (userId: string, fresh = false): string =>
    must(withHandle(`INSERT INTO public.session (user_id, token, expires_at${fresh ? ', recent_auth_at' : ''}) VALUES ('${userId}', 'tk${next()}${Math.random()}', now() + interval '1 day'${fresh ? ', now()' : ''}) RETURNING id`), db).rows[0]![0]!;
  async function run<T>(role: Role, userId: string | null, sessionId: string | null, fn: (q: Q) => Promise<T>, commit: boolean): Promise<T> {
    const c = new pgmod.Client({ connectionString: url(role, db) });
    await c.connect();
    const q: Q = (text, values) => c.query({ text, values, queryMode: 'extended' });
    try {
      await q('BEGIN');
      if (userId) await enterAs(q, db, role, userId, sessionId);
      const r = await fn(q);
      if (commit) await q('COMMIT');
      return r;
    } finally { if (!commit) await c.query('ROLLBACK').catch(() => {}); else await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  }
  const marked = <T>(role: Role, u: string | null, s: string | null, fn: (q: Q) => Promise<T>) => run(role, u, s, fn, false);
  const committed = <T>(role: Role, u: string | null, s: string | null, fn: (q: Q) => Promise<T>) => run(role, u, s, fn, true);
  const one = (sql: string) => must(sql, db).rows[0]?.[0];
  return { user, session, marked, committed, one };
}

export { totp } from './totp.ts';
