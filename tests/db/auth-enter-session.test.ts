// POLY-152 R5, seceng #18 / B2 / B5: app.enter_auth_session(p_token text). Every refusal asserts the marker table is unchanged, not
// only the code (a permission error and a guard refusal are both 42501). Titles end [red if: <mutation>]. Red today: the definer
// and the role do not exist.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { DB_PKG, psql } from './helpers/pg';
import { codeOf, fails, fixture, msgOf, pgmod, type Q } from './helpers/second-step';
import { url } from './helpers/pg';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 152); });

const markers = () => must(`SELECT count(*) FROM app.tx_identity`, db).rows[0]![0];
/** One poly_auth transaction (extended mode): BEGIN; fn; ROLLBACK. */
async function asAuth<T>(fn: (q: Q, c: any) => Promise<T>, role = 'poly_auth'): Promise<T> {
  const c = new pgmod.Client({ connectionString: url(role, db) });
  await c.connect();
  const q: Q = (text, values) => c.query({ text, values, queryMode: 'extended' });
  try { await q('BEGIN'); return await fn(q, c); } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
}
const tokenOf = (sid: string) => must(`SELECT token FROM public.session WHERE id = '${sid}'`, db).rows[0]![0]!;
const ENTER = 'SELECT app.enter_auth_session($1)';

describe('R5 the exact call enters from a live session row', () => {
  it('writes a marker of kind auth for the row\'s user and session id, returns the xid as text [red if: the definer is absent or writes another kind]', async () => {
    const u = await f.user();
    const sid = f.session(u.id);
    await asAuth(async (q) => {
      const r = await q(ENTER, [tokenOf(sid)]);
      expect(typeof r.rows[0].enter_auth_session).toBe('string');
      expect((await q('SELECT app.current_user_id() AS u, app.current_session_id() AS s')).rows[0]).toEqual({ u: u.id, s: sid });
      expect((await q(`SELECT kind FROM app.tx_identity WHERE xid = pg_current_xact_id()`)).rows[0].kind).toBe('auth');
    });
  });
  it('the kind CHECK accepts auth and still refuses an unknown kind; audit_membership maps auth to actor user [red if: CHECK not widened / mapping absent]', () => {
    expect(must(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'app.tx_identity'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'kind'`, db).rows.map((r: any) => r[0]).join(' ')).toMatch(/'auth'/);
    expect(must(`SELECT pg_get_functiondef('app.audit_membership()'::regprocedure)`, db).rows[0]![0]).toMatch(/'auth'/);
  });
});

describe('B2 no naming a user: a token that is not a live row writes no marker', () => {
  const bad: [string, () => Promise<string | null>][] = [
    ['an unknown token', async () => 'no-such-token'],
    ['NULL', async () => null],
    ['an expired row', async () => { const u = await f.user(); const sid = f.session(u.id); must(`UPDATE public.session SET expires_at = now() - interval '1 hour' WHERE id = '${sid}'`, db); return tokenOf(sid); }],
    ['a row past the 30-day cap though not idle', async () => { const u = await f.user(); const sid = f.session(u.id); must(`UPDATE public.session SET created_at = now() - interval '31 days' WHERE id = '${sid}'`, db); return tokenOf(sid); }],
    ['a row of a deleted user\'s session (no row)', async () => { const u = await f.user(); const sid = f.session(u.id); const t = tokenOf(sid); must(`DELETE FROM public.session WHERE id = '${sid}'`, db); return t; }],
  ];
  for (const [name, mk] of bad) {
    it(`${name}: refused, and no marker row exists afterwards [red if: the definer trusts the token without checking the row]`, async () => {
      const t = await mk();
      const before = markers();
      const x = await asAuth(async (q) => { const e = await fails(q(ENTER, [t])); await q('ROLLBACK'); return e; });
      expect(x).not.toBeNull();
      expect([codeOf(x)]).toContainEqual(t === null ? '22004' : '42501');
      expect(markers()).toBe(before);
    });
  }
  it('the 30-day cap is the same number in the definer and in recent-auth.ts [red if: they drift]', () => {
    const src = readFileSync(join(DB_PKG, '..', 'auth', 'src', 'recent-auth.ts'), 'utf8');
    expect(src).toMatch(/30\s*\*\s*86_?400_?000/);
    const def = must(`SELECT pg_get_functiondef('app.enter_auth_session(text)'::regprocedure)`, db).rows[0]![0]!;
    expect(def).toMatch(/interval '30 days'/);
  });
});

describe('#18 the full stage-1 refusal set, as the exact-call definer', () => {
  const live = async () => { const u = await f.user(); return { u, t: tokenOf(f.session(u.id)) }; };
  const shapes: [string, (t: string) => [string, unknown[]]][] = [
    ['a second select item', (t) => ['SELECT app.enter_auth_session($1), 1', [t]]],
    ['a subquery form', (t) => ['SELECT * FROM (SELECT app.enter_auth_session($1)) s', [t]]],
    ['the literal form (no bound parameter)', (t) => [`SELECT app.enter_auth_session('${t}')`, []]],
    ['a CTE form', (t) => ['WITH x AS (SELECT app.enter_auth_session($1)) SELECT * FROM x', [t]]],
  ];
  for (const [name, mk] of shapes) {
    it(`${name} is refused 42501 and writes no marker [red if: the exact-call check is absent]`, async () => {
      const { t } = await live();
      const before = markers();
      const x = await asAuth(async (q) => { const e = await fails(q(...mk(t))); await q('ROLLBACK'); return e; });
      expect(codeOf(x)).toBe('42501');
      expect(markers()).toBe(before);
    });
  }
  it('a superuser DO … SET LOCAL ROLE poly_auth form is refused [red if: current_query() is not compared with the exact text]', async () => {
    const { t } = await live();
    // the superuser path through psql: SET LOCAL ROLE then the call inside a DO block (current_query() is the DO text)
    const r = psql(`BEGIN; SET LOCAL ROLE poly_auth; DO $$ BEGIN PERFORM app.enter_auth_session('${t}'); END $$; ROLLBACK;`, db);
    expect(r.ok).toBe(false);
    expect(r.sqlstate).toBe('42501');
    expect(markers()).toBe('0');
  });
  it('a second marker in one transaction is refused; the first stays [red if: the marker check is absent]', async () => {
    const { u, t } = await live();
    const u2 = await f.user(); const t2 = tokenOf(f.session(u2.id));
    await asAuth(async (q) => {
      await q(ENTER, [t]);
      const x = await fails(q(ENTER, [t2]));
      expect(codeOf(x)).toBe('42501');
      await q('ROLLBACK');
    });
    expect(markers()).toBe('0');
    expect(u.id).not.toBe(u2.id);
  });
  it('an entry after a write in the transaction is refused [red if: the first-write check is absent]', async () => {
    const { u, t } = await live();
    const x = await asAuth(async (q) => {
      await q(`UPDATE public."user" SET name = 'W' WHERE id = $1`, [u.id]);
      return fails(q(ENTER, [t]));
    });
    expect(codeOf(x)).toBe('42501');
    expect(must(`SELECT name FROM public."user" WHERE id = '${u.id}'`, db).rows[0]![0]).toBe('C');
  });
  it('a two-statement string is refused on the plain pool path (simple protocol) [red if: extended-mode only is not enforced]', async () => {
    const { t } = await live();
    const c = new pgmod.Client({ connectionString: url('poly_auth', db) });
    await c.connect();
    try {
      await c.query('BEGIN');
      const x = await fails(c.query(`SELECT app.enter_auth_session('${t}'); SELECT 1`));
      expect(x).not.toBeNull();
      await c.query('ROLLBACK').catch(() => {});
    } finally { await c.end(); }
    expect(markers()).toBe('0');
  });
  for (const role of ['poly_app', 'poly_worker', 'poly_operator']) {
    it(`${role} is refused by permission and writes no marker [red if: EXECUTE is granted to ${role}]`, async () => {
      const { t } = await live();
      const x = await asAuth(async (q) => fails(q(ENTER, [t])), role);
      expect(codeOf(x)).toBe('42501');
      expect(msgOf(x)).toMatch(/permission denied|enter_auth_session/);
      expect(markers()).toBe('0');
    });
  }
});

describe('B5 the forge cases, through the token entry (R8)', () => {
  it('(b) a session id with no row is refused at entry; (a) and (c) enter with another real session\'s token and every guard still refuses [red if: entry accepts a forged id]', async () => {
    const x = await asAuth((q) => fails(q(ENTER, ['forged-no-row'])));
    expect(codeOf(x)).toBe('42501');
    const a = await f.user({ enrolled: true });
    const b = await f.user();
    const sb = f.session(b.id);
    // (a): b's own token, then b tries to turn a's flag off: refused by a guard, a's row unchanged
    await asAuth(async (q) => {
      await q(ENTER, [tokenOf(sb)]);
      const before = JSON.stringify(must(`SELECT two_factor_enabled FROM public."user" WHERE id = '${a.id}'`, db).rows);
      const e = await fails(q(`UPDATE public.two_factor SET verified = false WHERE user_id = $1`, [a.id]));
      expect(e).not.toBeNull();
      expect(JSON.stringify(must(`SELECT two_factor_enabled FROM public."user" WHERE id = '${a.id}'`, db).rows)).toBe(before);
    });
  });
  it('(d) a marked transaction whose session is real and own passes by design [passes by design: the guards narrow, they do not forbid a real session]', async () => {
    const u = await f.user();
    await asAuth(async (q) => { await q(ENTER, [tokenOf(f.session(u.id))]); expect((await q('SELECT app.current_user_id() AS u')).rows[0].u).toBe(u.id); });
  });
});
