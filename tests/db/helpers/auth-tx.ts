// POLY-152: raw extended-mode transactions as a login role, plus the sign-up entry as poly_auth does it. Used by the new
// definer suites; nothing here guesses a BetterAuth name. Every query is extended-mode (POLY-147 R6).
import { url } from './pg';
import { pgmod, type Q } from './second-step';
import { must } from './sql';

export async function tx<T>(db: string, role: string, fn: (q: Q) => Promise<T>, commit = false): Promise<T> {
  const c = new pgmod.Client({ connectionString: url(role, db) });
  await c.connect();
  const q: Q = (text, values) => c.query({ text, values, queryMode: 'extended' });
  try {
    await q('BEGIN');
    const r = await fn(q);
    if (commit) await q('COMMIT');
    return r;
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
}
/** Inside `tx`: insert a user (poly_auth stamps it) and enter as the new user. */
export async function signUpEntry(q: Q, id: string, email = `${id}@qa.test`, name = 'Signup'): Promise<void> {
  await q(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)`, [id, name, email]);
  await q('SELECT app.enter_new_user($1)', [id]);
}
export const count = (db: string, sql: string) => Number(must(`SELECT count(*) FROM (${sql}) q`, db).rows[0]![0]);
export const snapshot = (db: string, sql: string) => JSON.stringify(must(sql, db).rows);
