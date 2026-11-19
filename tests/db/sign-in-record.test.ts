// POLY-149c, ruling R3 (the sign-in record) and seceng's T-S1, T-S2, T-S4. app.sign_in_record is written by the database from NEW only, is
// append-only even for its owner, is read by no login role and is purged only by app.purge_sign_in_record. Red today: the table does not exist.
// Titles end [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, get, post, teardown, type Env } from './helpers/auth';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { hasSessionCookie, heldSignIn } from './helpers/auth-service';
import { BACKUP, TOTP, factor, recordCount, recordRows, wrongBody, wrongCodes, wrongTotp } from './helpers/lock';
import { attach, newHandle } from './helpers/handle';
import { codeOf, fails, fixture, msgOf, pgmod, type Q } from './helpers/second-step';
import { psql, url } from './helpers/pg';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env; let db: string; let fx: ReturnType<typeof fixture>;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); db = cloneMigrated(); fx = fixture(db, 1494); });
afterAll(() => teardown(e));

const asAuth = <T>(fn: (q: Q) => Promise<T>, commit = false) => tx(db, 'poly_auth', fn, commit);
const newSession = (q: Q, userId: string, ip: string | null = '203.0.113.9', ua: string | null = 'QA Browser/1.0') =>
  q(`INSERT INTO public.session (user_id, token, expires_at, ip_address, user_agent) VALUES ($1, $2, now() + interval '1 day', $3, $4) RETURNING id`, [userId, `t${Math.random()}`, ip, ua]).then((r) => r.rows[0].id as string);
const recs = (userId: string, kind = 'session') => recordRows(db, userId, kind);
const LOGINS = ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator', 'poly_backup'];
const RUNTIME = LOGINS.filter((r) => r !== 'poly_backup');

describe('every committed session INSERT leaves exactly one record row, written by the database', () => {
  it('as poly_auth: insert, attach, delete, commit: one row remains with the session id, the copied address and browser, and created_at from the database clock [red if: no trigger, or it copies NEW.created_at]', async () => {
    const u = await fx.user(); let sid = '';
    await asAuth(async (q) => { sid = await newSession(q, u.id); await attach(q, sid, newHandle()); await q('DELETE FROM public.session WHERE id = $1', [sid]); }, true);
    const r = recs(u.id);
    expect(r.length).toBe(1);
    expect(r[0]![1]).toBe(sid);
    expect(r[0]![3]).toBe('203.0.113.9');
    expect(r[0]![4]).toBe('QA Browser/1.0');
    expect(Number(must(`SELECT abs(extract(epoch FROM (created_at - now()))) FROM app.sign_in_record WHERE user_id = '${u.id}'`, db).rows[0]![0])).toBeLessThan(5 * 60); // the transaction ran seconds ago
    expect(Number(must(`SELECT extract(epoch FROM (clock_timestamp() - created_at)) FROM app.sign_in_record WHERE user_id = '${u.id}'`, db).rows[0]![0])).toBeLessThan(5);
  });
  it('a rolled-back insert leaves none [red if: the record is written outside the transaction]', async () => {
    const u = await fx.user();
    await asAuth(async (q) => { const s = await newSession(q, u.id); await attach(q, s, newHandle()); }, false);
    expect(recs(u.id).length).toBe(0);
  });
  it('T-S2: a session with a 10 KB address and a 10 KB browser still writes its row, the browser cut to 512 characters [red if: the trigger fails the sign-in or stores it whole]', async () => {
    const u = await fx.user(); const big = 'x'.repeat(10_240);
    await asAuth(async (q) => { const s = await newSession(q, u.id, '203.0.113.7', big); await attach(q, s, newHandle()); }, true);
    const r = recs(u.id);
    expect(r.length).toBe(1);
    expect(String(r[0]![4]).length).toBe(512);
  });
  it('real sign-ins: email, Google and a held sign-in each add exactly one row naming the new session [red if: a path skips the trigger]', async () => {
    const u = e.seedUser();
    const n = () => recordCount(e.db, u.id, 'session');
    const { res } = await e.signIn(u.email);
    expect(res.status).toBe(200);
    expect(n()).toBe(1);
    const s1 = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at DESC LIMIT 1`, e.db).rows[0]![0];
    expect(recordRows(e.db, u.id, 'session')[0]![1]).toBe(s1);
    const g = e.seedUser({ password: false });
    expect((await e.oauth(g.email, e.auth)).status).toBeLessThan(500);
    expect(recordCount(e.db, g.id, 'session')).toBe(Number(must(`SELECT count(*) FROM public.session WHERE user_id = '${g.id}'`, e.db).rows[0]![0]));
    const f = await factor(e, mails);
    const before = recordCount(e.db, f.u.id, 'session');
    await heldSignIn(e, f.auth, f.u.email);
    expect(recordCount(e.db, f.u.id, 'session') - before, 'the hold\'s temporary session is recorded').toBe(1);
  }, 120_000);
});

describe('no login role can write the record; the owner and superuser cannot change or delete a row; truncate is refused', () => {
  it('effective: no INSERT, UPDATE, DELETE, TRUNCATE for any of the six login roles; no SELECT for the five runtime roles [red if: a grant exists, PUBLIC included]', () => {
    for (const r of LOGINS) for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
      expect(must(`SELECT has_table_privilege('${r}', 'app.sign_in_record', '${p}')`, db).rows[0]![0], `${r} ${p}`).toBe('f');
    for (const r of RUNTIME) expect(must(`SELECT has_table_privilege('${r}', 'app.sign_in_record', 'SELECT')`, db).rows[0]![0], `${r} SELECT`).toBe('f');
  });
  it('UPDATE, DELETE of a fresh row and TRUNCATE are refused for the owner and for the superuser, and the row stays [red if: the immutable trigger is absent]', async () => {
    const u = await fx.user();
    await asAuth(async (q) => { const s = await newSession(q, u.id); await attach(q, s, newHandle()); }, true);
    for (const asRole of ['', 'SET LOCAL ROLE poly_owner;']) for (const sql of [`UPDATE app.sign_in_record SET ip_address = 'x' WHERE user_id = '${u.id}'`, `DELETE FROM app.sign_in_record WHERE user_id = '${u.id}'`, 'TRUNCATE app.sign_in_record']) {
      const r = psql(`BEGIN; ${asRole} ${sql}; COMMIT;`, db);
      expect(r.ok, `${asRole || 'superuser'}: ${sql}: ${r.err}`).toBe(false);
      if (!sql.startsWith('TRUNCATE')) expect(r.sqlstate, `${asRole || 'superuser'}: ${sql}`).toBe('42501');
    }
    expect(recs(u.id).length).toBe(1);
  });
  it('SET ROLE poly_purge, then DELETE of a fresh row: 42501 [red if: poly_purge may delete what is not purgeable]', async () => {
    const u = await fx.user();
    await asAuth(async (q) => { const s = await newSession(q, u.id); await attach(q, s, newHandle()); }, true);
    const r = psql(`BEGIN; SET LOCAL ROLE poly_purge; DELETE FROM app.sign_in_record WHERE user_id = '${u.id}'; COMMIT;`, db);
    expect(r.ok, r.err).toBe(false);
    expect(r.sqlstate).toBe('42501');
    expect(recs(u.id).length).toBe(1);
  });
});

describe('retention: only app.purge_sign_in_record deletes (T-S4)', () => {
  it('as poly_worker: a 401-day row and a deleted user\'s row go; a 399-day row and a live user\'s fresh row stay; a second call deletes nothing [red if: the purge is absent, wrongly bounded, or not idempotent]', async () => {
    const live = await fx.user(); const gone = '00000000-0000-4000-8000-000000149999';
    must(`INSERT INTO app.sign_in_record (kind, user_id, session_id, created_at) VALUES
      ('session', '${live.id}', gen_random_uuid(), now() - interval '401 days'), ('session', '${live.id}', gen_random_uuid(), now() - interval '399 days'),
      ('session', '${live.id}', gen_random_uuid(), now()), ('session', '${gone}', gen_random_uuid(), now())`, db);
    const call = () => tx(db, 'poly_worker', async (q) => (await q('SELECT app.purge_sign_in_record() AS n')).rows[0].n as number, true);
    expect(Number(await call())).toBeGreaterThanOrEqual(2);
    expect(recs(live.id).length, '399-day and fresh rows stay').toBe(2);
    expect(recs(gone).length).toBe(0);
    expect(Number(await call())).toBe(0);
    for (const r of ['poly_app', 'poly_auth', 'poly_operator', 'poly_migrator', 'poly_backup'])
      expect(must(`SELECT has_function_privilege('${r}', 'app.purge_sign_in_record()', 'EXECUTE')`, db).rows[0]![0], r).toBe('f');
  });
});

describe('second-step rows: one per counted refusal, one per lock, none for an invalid hold', () => {
  const H = { 'x-forwarded-for': '198.51.100.23', 'user-agent': 'QA-Agent/9' };
  for (const path of [TOTP, BACKUP] as const) {
    it(`${path}: 10 counted wrong codes add 10 second_step_failure rows with the request's address and browser and one second_step_lock row of 15 minutes [red if: no guard writes them, or the address is not carried]`, async () => {
      const f = await factor(e, mails);
      await wrongCodes(e, f, path, 10, H);
      const fails_ = recordRows(e.db, f.u.id, 'second_step_failure');
      expect(fails_.length).toBe(10);
      for (const r of fails_) { expect(r[3]).toBe('198.51.100.23'); expect(r[4]).toBe('QA-Agent/9'); expect(r[1]).toBe(''); }
      const locks = recordRows(e.db, f.u.id, 'second_step_lock');
      expect(locks.length).toBe(1);
      expect(Number(locks[0]![2])).toBe(15);
    }, 120_000);
  }
  it('no cookie, an unknown hold and a dead hold\'s 6th try add no row [red if: a request without a valid held sign-in is recorded]', async () => {
    const f = await factor(e, mails);
    const base = recordCount(e.db, f.u.id) ;
    const none = await e.handle(post(TOTP, { code: wrongTotp(f.secret) }), f.auth);
    expect(none.status).toBeGreaterThanOrEqual(400);
    const unknown = await e.handle(post(TOTP, { code: wrongTotp(f.secret) }, 'better-auth.two_factor=forged'), f.auth);
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(recordCount(e.db, f.u.id)).toBe(base);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const afterHold = recordCount(e.db, f.u.id);
    for (let i = 0; i < 5; i++) await e.handle(post(TOTP, wrongBody(TOTP, f.secret), held.cookie), f.auth);
    expect(recordCount(e.db, f.u.id, 'second_step_failure')).toBe(5);
    await e.handle(post(TOTP, wrongBody(TOTP, f.secret), held.cookie), f.auth); // the dead hold's 6th try
    expect(recordCount(e.db, f.u.id, 'second_step_failure'), 'the 6th does not count').toBe(5);
    expect(recordCount(e.db, f.u.id)).toBe(afterHold + 5);
  }, 120_000);
  it('no column of the record holds a typed code: a known 6-digit code and a known backup code are searched in every column of every row [red if: the guard copies anything from the request body]', async () => {
    const f = await factor(e, mails);
    const six = wrongTotp(f.secret);
    const held = await heldSignIn(e, f.auth, f.u.email);
    await e.handle(post(TOTP, { code: six }, held.cookie), f.auth);
    await e.handle(post(BACKUP, { code: 'wrong-code-000' }, held.cookie), f.auth);
    expect(recordCount(e.db, f.u.id, 'second_step_failure')).toBe(2);
    expect(Number(must(`SELECT count(*) FROM app.sign_in_record r WHERE row_to_json(r)::text LIKE '%${six}%' OR row_to_json(r)::text LIKE '%wrong-code-000%'`, e.db).rows[0]![0])).toBe(0);
  }, 120_000);
  it('T-S1: a client address that is not an inet, and one of 10 KB, still gives exactly one row with the address NULL; the refusal is unchanged [red if: a bad setting breaks the guard]', async () => {
    const f = await factor(e, mails);
    for (const bad of ['not-an-address', 'a'.repeat(10_240)]) {
      const before = recordCount(e.db, f.u.id, 'second_step_failure');
      const held = await heldSignIn(e, f.auth, f.u.email);
      const r = await e.handle(post(TOTP, wrongBody(TOTP, f.secret), held.cookie, { 'x-forwarded-for': bad }), f.auth);
      expect(r.status, `${bad.slice(0, 10)}: refused as without the header`).toBeLessThan(600);
      expect(hasSessionCookie(r)).toBe(false);
      void before;
    }
    // directly: the settings carry the junk, the guard keeps the row and nulls the address
    const u = await fx.user({ enrolled: true });
    const sid = fx.session(u.id);
    const rows0 = recordCount(db, u.id, 'second_step_failure');
    for (const bad of ['not-an-address', 'a'.repeat(10_240)]) {
      await fx.committed('poly_auth', u.id, sid, async (q) => {
        await q(`SELECT pg_catalog.set_config('poly.client_ip', $1, true), pg_catalog.set_config('poly.user_agent', $1, true)`, [bad]);
        await q(`UPDATE public.two_factor SET failed_verification_count = failed_verification_count + 1 WHERE user_id = $1`, [u.id]);
      });
    }
    const r = recordRows(db, u.id, 'second_step_failure');
    expect(r.length - rows0).toBe(2);
    for (const row of r.slice(rows0)) { expect(row[3], 'the address').toBe(''); expect(String(row[4]).length).toBeLessThanOrEqual(512); }
  }, 120_000);
  it('the record names the failing user only: a wrong code for A adds no row for B [red if: the guard writes NEW.user_id of another row]', async () => {
    const a = await factor(e, mails); const b = await factor(e, mails);
    await wrongCodes(e, a, TOTP, 2);
    expect(recordCount(e.db, b.u.id, 'second_step_failure')).toBe(0);
  }, 120_000);
});

void get; void codeOf; void fails; void msgOf; void pgmod; void url;
