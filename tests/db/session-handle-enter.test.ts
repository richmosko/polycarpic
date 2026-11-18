// POLY-153 R4 (C1, C2), seceng H1 / T1 / T2: app.enter_session(p_handle text) as poly_app. The call is always the canonical
// `SELECT * FROM app.enter_session($1)` in extended mode, with the PLAIN handle. Every refusal asserts the marker table is unchanged
// (a permission error and a guard refusal are both 42501). Titles end [red if: <mutation>]. Red today: no app.enter_session, no
// app.session_handle, no kind 'session'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { ENTER_SESSION, hashHex, hashOf, newHandle, sessionWithHandle } from './helpers/handle';
import { DB_PKG, psql, url } from './helpers/pg';
import { codeOf, fails, fixture, msgOf, pgmod, type Q } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 153); });

const markers = () => must(`SELECT count(*) FROM app.tx_identity WHERE kind = 'session'`, db).rows[0]![0]!;
const asApp = <T>(fn: (q: Q) => Promise<T>, role = 'poly_app') => tx(db, role, fn);
const live = async (o: Parameters<typeof sessionWithHandle>[2] = {}) => { const u = await f.user(); return { u, ...sessionWithHandle(db, u.id, o) }; };
/** The one refusal every unusable handle must give: 42501 `no live session`, never the exact-call message, and no marker written. */
async function refusedAsNoLive(handleOrParam: unknown) {
  const before = markers();
  const x = await asApp(async (q) => { const e = await fails(q(ENTER_SESSION, [handleOrParam])); await q('ROLLBACK'); return e; });
  expect(x, 'must be refused').not.toBeNull();
  expect(codeOf(x)).toBe('42501');
  expect(msgOf(x)).toMatch(/no live session/);
  expect(msgOf(x)).not.toMatch(/on its own/);
  expect(markers()).toBe(before);
}

describe('R4 the exact call enters from a live handle', () => {
  it('writes a kind session marker for the row\'s user and session and returns (xid, user_id, session_id, name, image, expires_at) [red if: the definer is absent or writes another kind]', async () => {
    const { u, id, handle } = await live();
    await asApp(async (q) => {
      const r = await q(ENTER_SESSION, [handle]);
      expect(Object.keys(r.rows[0]).sort()).toEqual(['expires_at', 'image', 'name', 'session_id', 'user_id', 'xid']);
      expect(r.rows[0].user_id).toBe(u.id);
      expect(r.rows[0].session_id).toBe(id);
      expect(r.rows[0].name).toBe('C');
      expect(typeof r.rows[0].xid).toBe('string');
      expect((await q('SELECT app.current_user_id() AS u, app.current_session_id() AS s')).rows[0]).toEqual({ u: u.id, s: id });
      expect((await q('SELECT kind FROM app.tx_identity WHERE xid = pg_current_xact_id()')).rows[0].kind).toBe('session');
    });
  });
  it('the kind CHECK accepts session and refuses an unknown kind; audit_membership maps session to actor user [red if: CHECK not widened or mapping absent]', () => {
    expect(must(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'app.tx_identity'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'kind'`, db).rows.map((r) => r[0]).join(' ')).toMatch(/'session'/);
    expect(must(`SELECT pg_get_functiondef('app.audit_membership()'::regprocedure)`, db).rows[0]![0]).toMatch(/'session'/);
    const r = psql(`BEGIN; INSERT INTO app.tx_identity (xid, user_id, kind) VALUES (pg_current_xact_id(), gen_random_uuid(), 'bogus');`, db);
    expect(r.ok).toBe(false);
    expect(r.sqlstate).toBe('23514');
  });
});

describe('H1 a value that is not the plain live handle yields no marker and the one refusal', () => {
  const stored = async () => {
    const l = await live();
    return { ...l, hex: hashHex(l.handle), buf: hashOf(l.handle) };
  };
  it('the stored handle_hash as a bytea parameter [red if: the definer accepts a hash]', async () => {
    const { buf } = await stored();
    const before = markers();
    const x = await asApp(async (q) => { const e = await fails(q(ENTER_SESSION, [buf])); await q('ROLLBACK'); return e; });
    expect(x, 'must be refused').not.toBeNull(); // a raw-bytes text parameter may also be refused by the driver or the encoding check
    expect(msgOf(x)).not.toMatch(/on its own/);
    expect(markers()).toBe(before);
  });
  it('the stored hash as \\x… text [red if: the definer accepts a hash]', async () => { await refusedAsNoLive(`\\x${(await stored()).hex}`); });
  it('the stored hash as bare hex [red if: the definer accepts a hash]', async () => { await refusedAsNoLive((await stored()).hex); });
  it('the stored hash as base64url (43 characters, so it passes the format check and is hashed again) [red if: the definer does not hash the parameter]', async () => {
    const { buf } = await stored();
    const b64 = buf.toString('base64url');
    expect(b64).toHaveLength(43);
    await refusedAsNoLive(b64);
  });
  it('BetterAuth\'s session.token and session.id [red if: the handle is derived from the token or the id]', async () => {
    const { token, id } = await live();
    await refusedAsNoLive(token);
    await refusedAsNoLive(id);
  });
  it('an unknown handle, a revoked (deleted) one, an expired one and one past the 30-day cap [red if: any check is dropped]', async () => {
    await refusedAsNoLive(newHandle());
    const gone = await live();
    must(`DELETE FROM public.session WHERE id = '${gone.id}'`, db);
    await refusedAsNoLive(gone.handle);
    const exp = await live();
    must(`UPDATE public.session SET expires_at = now() - interval '1 hour' WHERE id = '${exp.id}'`, db);
    await refusedAsNoLive(exp.handle);
    const cap = await live({ createdDaysAgo: 31, expiresInDays: 3 });
    await refusedAsNoLive(cap.handle);
  });
  it('malformed values: empty, short, long, outside the alphabet [red if: the format check is absent]', async () => {
    for (const bad of ['', 'a', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, `${'A'.repeat(42)} `]) await refusedAsNoLive(bad);
  });
  it('NULL is refused 22004 and writes no marker [red if: NULL is not checked]', async () => {
    const before = markers();
    const x = await asApp(async (q) => { const e = await fails(q(ENTER_SESSION, [null])); await q('ROLLBACK'); return e; });
    expect(codeOf(x)).toBe('22004');
    expect(markers()).toBe(before);
  });
  it('a hash-valued parameter does not enter even when it is also well formed AND the session exists with that very value stored as the TOKEN [red if: lookup is by hash column equality with the parameter]', async () => {
    const { buf } = await stored();
    const u = await f.user();
    sessionWithHandle(db, u.id, { token: buf.toString('base64url') });
    await refusedAsNoLive(buf.toString('base64url'));
  });
});

describe('the exact-call set (seceng #18 as stage 1)', () => {
  const shapes: [string, (h: string) => [string, unknown[]]][] = [
    ['a trailing clause', (h) => ['SELECT * FROM app.enter_session($1) LIMIT 1', [h]]],
    ['a subquery form', (h) => ['SELECT * FROM (SELECT * FROM app.enter_session($1)) s', [h]]],
    ['the literal form (no bound parameter)', (h) => [`SELECT * FROM app.enter_session('${h}')`, []]],
    ['a CTE form', (h) => ['WITH x AS (SELECT * FROM app.enter_session($1)) SELECT * FROM x', [h]]],
    ['a column-list form', (h) => ['SELECT user_id FROM app.enter_session($1)', [h]]],
  ];
  for (const [name, mk] of shapes) {
    it(`${name} is refused 42501 and writes no marker [red if: the exact-call check is absent]`, async () => {
      const { handle } = await live();
      const before = markers();
      const x = await asApp(async (q) => { const e = await fails(q(...mk(handle))); await q('ROLLBACK'); return e; });
      expect(codeOf(x)).toBe('42501');
      expect(markers()).toBe(before);
    });
  }
  it('a superuser DO … SET LOCAL ROLE poly_app form is refused [red if: current_query() is not compared with the exact text]', async () => {
    const { handle } = await live(); const m0 = markers();
    const r = psql(`BEGIN; SET LOCAL ROLE poly_app; DO $$ BEGIN PERFORM * FROM app.enter_session('${handle}'); END $$; ROLLBACK;`, db);
    expect(r.ok).toBe(false);
    expect(r.sqlstate).toBe('42501');
    expect(markers()).toBe(m0);
  });
  it('a second marker in one transaction is refused and the first stays unique [red if: the marker check is absent]', async () => {
    const a = await live(); const b = await live(); const before = markers();
    await asApp(async (q) => {
      await q(ENTER_SESSION, [a.handle]);
      await q('SAVEPOINT second');
      const x = await fails(q(ENTER_SESSION, [b.handle]));
      expect(codeOf(x)).toBe('42501');
      await q('ROLLBACK TO second'); // the refused statement aborted the transaction; the first marker is still the only one
      expect((await q('SELECT app.current_user_id() AS u')).rows[0].u).toBe(a.u.id);
      expect((await q('SELECT count(*)::int AS n FROM app.tx_identity WHERE xid = pg_current_xact_id()')).rows[0].n).toBe(1);
    });
    expect(markers()).toBe(before);
  });
  it('an entry after a write in the transaction is refused and the write is not kept [red if: the first-write check is absent]', async () => {
    const { u, handle } = await live();
    const x = await asApp(async (q) => {
      await q(`UPDATE public."user" SET name = 'W' WHERE id = $1`, [u.id]);
      return fails(q(ENTER_SESSION, [handle]));
    });
    expect(codeOf(x)).toBe('42501');
    expect(must(`SELECT name FROM public."user" WHERE id = '${u.id}'`, db).rows[0]![0]).toBe('C');
  });
  for (const role of ['poly_worker', 'poly_operator', 'poly_auth']) {
    it(`${role} has no EXECUTE and writes no marker [red if: EXECUTE is granted to ${role}]`, async () => {
      const { handle } = await live(); const m0 = markers();
      const x = await asApp(async (q) => fails(q(ENTER_SESSION, [handle])), role);
      expect(codeOf(x)).toBe('42501');
      expect(msgOf(x)).toMatch(/permission denied/);
      expect(markers()).toBe(m0);
    });
  }
  for (const role of ['poly_app', 'poly_auth']) {
    it(`a two-statement string is refused on ${role}'s plain pool path (simple protocol) [red if: extended mode only is not enforced]`, async () => {
      const { handle } = await live(); const m0 = markers();
      const c = new pgmod.Client({ connectionString: url(role, db) });
      await c.connect();
      try {
        await c.query('BEGIN');
        const x = await fails(c.query(`SELECT * FROM app.enter_session('${handle}'); SELECT 1`));
        expect(x).not.toBeNull();
        await c.query('ROLLBACK').catch(() => {});
      } finally { await c.end(); }
      expect(markers()).toBe(m0);
    });
  }
});

describe('T1 / T2 the slide', () => {
  const row = (id: string) => must(`SELECT extract(epoch FROM expires_at), extract(epoch FROM created_at), coalesce(extract(epoch FROM recent_auth_at)::text, 'null'), extract(epoch FROM updated_at) FROM public.session WHERE id = '${id}'`, db).rows[0]!.map((x) => (x === 'null' ? null : Number(x)));
  it('a session past updateAge slides to least(now + 7 d, created + 30 d); recent_auth_at is untouched and the 0013 trigger does not fire (T1) [red if: the slide writes recent_auth_at or ignores the cap]', async () => {
    const { u, id, handle } = await live({ createdDaysAgo: 25, expiresInDays: 1, fresh: true }); // a stamped session: the 0013 trigger guards recent_auth_at
    const [, created, recent] = row(id) as number[];
    await tx(db, 'poly_app', async (q) => { const r = await q(ENTER_SESSION, [handle]); expect(r.rows[0].user_id).toBe(u.id); }, true);
    const [exp2, , recent2] = row(id) as number[];
    expect(recent2).toBe(recent);
    expect(exp2).toBeLessThanOrEqual(created! + 30 * 86400 + 1);
    expect(exp2).toBeGreaterThan(Date.now() / 1000 + 4 * 86400); // slid out to the cap (about now + 5 d), from now + 1 d
  });
  it('an uncapped session slides to now + 7 days and returns the slid expires_at [red if: nothing slides on web activity]', async () => {
    const { id, handle } = await live({ expiresInDays: 1 });
    const returned = await tx(db, 'poly_app', async (q) => (await q(ENTER_SESSION, [handle])).rows[0].expires_at, true);
    const exp = row(id)[0]!;
    expect(exp).toBeGreaterThan(Date.now() / 1000 + 6.9 * 86400);
    expect(Math.abs(new Date(returned).getTime() / 1000 - exp)).toBeLessThan(2);
  });
  it('a session with more than 6 days left is not written (no slide inside the update window) [red if: every entry rewrites the row]', async () => {
    const { id, handle } = await live({ expiresInDays: 7 });
    const before = must(`SELECT xmin FROM public.session WHERE id = '${id}'`, db).rows[0]![0];
    await tx(db, 'poly_app', async (q) => { await q(ENTER_SESSION, [handle]); }, true);
    expect(must(`SELECT xmin FROM public.session WHERE id = '${id}'`, db).rows[0]![0]).toBe(before);
  });
  it('the slide runs after the marker insert: the entry succeeds as the first write, and a rolled-back entry leaves expires_at unchanged (T2) [red if: slide before the marker or a partial write survives]', async () => {
    const { id, handle } = await live({ expiresInDays: 1 });
    const before = row(id);
    const markersBefore = markers();
    await asApp(async (q) => { await q(ENTER_SESSION, [handle]); }); // asApp rolls back
    expect(row(id)).toEqual(before);
    expect(markers()).toBe(markersBefore);
  });
  it('a capped session is refused and is not deleted by the definer [red if: the definer deletes]', async () => {
    const { id, handle } = await live({ createdDaysAgo: 31, expiresInDays: 3 });
    await refusedAsNoLive(handle);
    expect(must(`SELECT count(*) FROM public.session WHERE id = '${id}'`, db).rows[0]![0]).toBe('1');
  });
});

describe('C2 no column equals a live handle; the cap is one number in three places', () => {
  it('no column of any table in public or app holds the plain handle (scanned as text, per row) [red if: the handle is stored plain anywhere]', async () => {
    const { handle } = await live();
    const tables = must(`SELECT table_schema || '.' || quote_ident(table_name) FROM information_schema.tables WHERE table_schema IN ('public','app') AND table_type = 'BASE TABLE'`, db).rows.map((r) => r[0]!);
    expect(tables).toContain('app.session_handle');
    for (const t of tables) {
      expect(must(`SELECT count(*) FROM ${t} x WHERE x::text LIKE '%' || '${handle}' || '%'`, db).rows[0]![0], t).toBe('0');
    }
    expect(must(`SELECT count(*) FROM app.session_handle WHERE handle_hash = decode('${hashHex(handle)}', 'hex')`, db).rows[0]![0]).toBe('1');
  });
  it('the 30-day cap is the same number in recent-auth.ts, enter_auth_session and enter_session [red if: they drift]', () => {
    expect(readFileSync(join(DB_PKG, '..', 'auth', 'src', 'recent-auth.ts'), 'utf8')).toMatch(/30\s*\*\s*86_?400_?000/);
    for (const fn of ['app.enter_auth_session(text)', 'app.enter_session(text)']) {
      expect(must(`SELECT pg_get_functiondef('${fn}'::regprocedure)`, db).rows[0]![0], fn).toMatch(/interval '30 days'/);
    }
  });
});
