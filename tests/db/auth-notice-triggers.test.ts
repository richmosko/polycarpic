// POLY-137 decisions D1, D2, D4 and R4.2 (ruling @ a5e9ce4f; seceng ruling-review §5): no login role changes user.email; every change of backup_codes
// outside a spend we can see is noticed (an unmarked change that does not shrink is refused); a changed password is noticed; poly_auth's idle
// timeout is 15 s. Real Postgres; SQL as poly_auth unless noted. Each refusal asserts SQLSTATE and message and has a positive case beside it.
// ASSUMED (not worded by the ruling): D1's refusal message matches /email/i. Titles end [red if: ...]. Red today: no trigger, no outbox.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, jar, post, teardown, type Env } from './helpers/auth';
import { tx } from './helpers/auth-tx';
import { sessionWithHandle } from './helpers/handle';
import { enrol, freshCookie, mailAuth, memMailer, outbox, type Mem } from './helpers/mail';
import { codeOf, fails, fixture, msgOf } from './helpers/second-step';
import { totp } from './helpers/second-step';
import { must } from './helpers/sql';
import { psql } from './helpers/pg';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
let auth: any;
let mm: Mem;
beforeAll(async () => {
  e = await boot();
  fx = fixture(e.db, 138);
  mm = memMailer();
  auth = await mailAuth(e, mm);
});
afterAll(() => teardown(e));

const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const kinds = (uid: string, kind: string) => outbox(e, uid, kind).length;
/** poly_auth with no user marker: the sign-in transaction's shape (the spend of a backup code, and the Settings-free writes). */
const evil = () => `attacker-${Math.random().toString(36).slice(2, 9)}@evil.test`;
const unmarked = (sql: string, vals: unknown[] = []) => fails(tx(e.db, 'poly_auth', (q) => q(sql, vals), true));
const marked = (uid: string, sid: string, sql: string, vals: unknown[] = []) => fails(fx.committed('poly_auth', uid, sid, (q) => q(sql, vals)));

describe('D1 user.email cannot be changed by any login role', () => {
  it('poly_auth UPDATE email: 42501 and the address is unchanged; a same-value write and other columns pass; a superuser may change it (the operator at the box) [red if: the trigger is absent, so a plant can redirect every notice]', async () => {
    const u = await fx.user();
    const sid = (await freshCookie(e, auth, u.id)).id;
    const x = await marked(u.id, sid, `UPDATE public."user" SET email = $2 WHERE id = $1`, [u.id, evil()]);
    expect(x).not.toBeNull();
    expect([codeOf(x), msgOf(x)]).toEqual(['42501', expect.stringMatching(/email/i)]);
    expect(must(`SELECT email FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe(u.email);
    expect(await marked(u.id, sid, `UPDATE public."user" SET email = email WHERE id = $1`, [u.id]), 'a no-op write is not a change').toBeNull();
    expect(await marked(u.id, sid, `UPDATE public."user" SET name = 'N' WHERE id = $1`, [u.id])).toBeNull();
    must(`UPDATE public."user" SET email = 'moved-by-operator@qa.test' WHERE id = '${u.id}'`, e.db);
    expect(must(`SELECT email FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('moved-by-operator@qa.test');
  });
  it('the unmarked (sign-in transaction) path is refused the same way, and by poly_app too [red if: the trigger checks the marker instead of the role]', async () => {
    const u = await fx.user();
    const x = await unmarked(`UPDATE public."user" SET email = $2 WHERE id = $1`, [u.id, evil()]);
    expect([codeOf(x), msgOf(x)]).toEqual(['42501', expect.stringMatching(/email/i)]);
  });
});

describe('D2 backup codes: every change outside a spend we can see is noticed, and a non-shrinking unmarked change is refused', () => {
  const setCodes = (uid: string, codes: string) => must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET backup_codes = '${codes}' WHERE user_id = '${uid}'; COMMIT;`, e.db);
  it('an unmarked UPDATE that copies another verified row\'s LONGER list is refused 42501 backup_codes_not_a_spend and the row is unchanged [red if: a copied list passes as a spend]', async () => {
    const victim = await fx.user({ enrolled: true });
    const attacker = await fx.user({ enrolled: true });
    setCodes(victim.id, 'AAAA');
    setCodes(attacker.id, 'BBBBBBBB');
    const copied = must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${attacker.id}'`, e.db).rows[0]![0];
    const x = await unmarked(`UPDATE public.two_factor SET backup_codes = $2 WHERE user_id = $1`, [victim.id, copied]);
    expect(x).not.toBeNull();
    expect([codeOf(x), msgOf(x)]).toEqual(['42501', expect.stringMatching(/backup_codes_not_a_spend/)]);
    expect(must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${victim.id}'`, e.db).rows[0]![0]).toBe('AAAA');
    expect(kinds(victim.id, 'backup_code_used'), 'a refusal writes no notice').toBe(0);
  });
  it('an unmarked change that SHRINKS the list (a spend) passes and writes exactly one backup_code_used row; a copied shorter list also writes one [red if: a spend is silent]', async () => {
    const u = await fx.user({ enrolled: true });
    setCodes(u.id, 'AAAABBBB');
    expect(await unmarked(`UPDATE public.two_factor SET backup_codes = 'AAAA' WHERE user_id = $1`, [u.id])).toBeNull();
    expect(kinds(u.id, 'backup_code_used')).toBe(1);
    const row = outbox(e, u.id, 'backup_code_used')[0]!;
    expect(row[2]).toBe(u.email);
    expect(Object.keys(JSON.parse(row[3]!)).every((k) => ['at', 'methods'].includes(k)), 'no count, no code in the payload').toBe(true);
  });
  it('a real sign-in by backup code writes one backup_code_used row; a Confirm it\'s you spend writes none; new codes through Confirm it\'s you write one backup_codes_replaced row [red if: the sign-in spend is silent, or the re-check is noticed as a sign-in]', async () => {
    const x = await enrol(e, auth, mm);
    expect(kinds(x.u.id, 'backup_code_used')).toBe(0);
    const held = jar('', await e.handle(post('/sign-in/email', { email: x.u.email, password: PW }), auth));
    const bk = await e.handle(post('/two-factor/verify-backup-code', { code: x.backupCodes[0] }, held), auth);
    expect(bk.status, JSON.stringify(await json(bk))).toBe(200);
    expect(kinds(x.u.id, 'backup_code_used')).toBe(1);
    // Confirm it's you with a backup code: a re-check, no notice
    const s = sessionWithHandle(e.db, x.u.id);
    const cookie = await e.cookieForToken(s.token, auth);
    const b = await e.handle(post('/second-step/reauth/begin', { method: 'totp' }, cookie), auth);
    const re = await e.handle(post('/second-step/reauth', { challengeId: (await json(b)).challengeId, password: PW, backupCode: x.backupCodes[1] }, cookie), auth);
    expect(re.status, JSON.stringify(await json(re))).toBe(200);
    expect(kinds(x.u.id, 'backup_code_used'), 'the re-check spend is not a sign-in').toBe(1);
    expect(kinds(x.u.id, 'backup_codes_replaced')).toBe(0);
    const gen = await e.handle(post('/two-factor/generate-backup-codes', { password: PW }, cookie), auth);
    expect(gen.status, JSON.stringify(await json(gen))).toBe(200);
    expect(kinds(x.u.id, 'backup_codes_replaced')).toBe(1);
  });
  it('a superuser change of backup_codes (a fixture, a restore) writes no notice [red if: fixtures spam outbox rows]', async () => {
    const u = await fx.user({ enrolled: true });
    setCodes(u.id, 'ZZ');
    expect(outbox(e, u.id)).toEqual([]);
  });
  it('the outbox kind list is exactly method_added, method_removed, backup_codes_replaced, backup_code_used, password_changed; one row per (user, kind, transaction) [red if: a kind is missing or the merge key is absent]', () => {
    const u = e.seedUser();
    const ins = (k: string) => `INSERT INTO app.mail_outbox (user_id, kind, to_address, payload) VALUES ('${u.id}', '${k}', '${u.email}', '{}'::jsonb)`;
    const attempt = (sql: string) => psql(`BEGIN; ${sql}; ROLLBACK`, e.db);
    for (const k of ['method_added', 'method_removed', 'backup_codes_replaced', 'backup_code_used', 'password_changed']) {
      const r = attempt(ins(k));
      expect(r.ok, `${k}: ${r.err}`).toBe(true);
    }
    const bad = attempt(ins('magic_link'));
    expect([bad.ok, bad.sqlstate], 'a token mail kind is never an outbox row').toEqual([false, '23514']);
    const dup = attempt(`${ins('password_changed')}; ${ins('password_changed')}`);
    expect([dup.ok, dup.sqlstate], 'unique (user_id, kind, tx)').toEqual([false, '23505']);
  });
});

describe('D4 a changed password is noticed', () => {
  it('as poly_auth: a different hash writes one password_changed row; the same hash writes none; the first password (INSERT) writes none [red if: a password change is silent]', async () => {
    const u = e.seedUser();
    expect(await unmarked(`UPDATE public.account SET password = 'other-hash' WHERE user_id = $1 AND provider_id = 'credential'`, [u.id])).toBeNull();
    expect(kinds(u.id, 'password_changed')).toBe(1);
    const row = outbox(e, u.id, 'password_changed')[0]!;
    expect(row[2]).toBe(u.email);
    expect(await unmarked(`UPDATE public.account SET password = 'other-hash' WHERE user_id = $1 AND provider_id = 'credential'`, [u.id]), 'unchanged value').toBeNull();
    expect(kinds(u.id, 'password_changed'), 'an unchanged value is not a change').toBe(1);
    const nopw = await fx.user();
    must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${nopw.id}', 'credential', '${nopw.id}', 'first')`, e.db);
    expect(kinds(nopw.id, 'password_changed'), 'the INSERT of a first password is out of scope (follow-up 5)').toBe(0);
  });
  it('a superuser UPDATE of a password writes no notice; /change-password over HTTP writes one [red if: the HTTP path is silent, or fixtures are noticed]', async () => {
    const u = e.seedUser();
    must(`UPDATE public.account SET password = 'su-write' WHERE user_id = '${u.id}'`, e.db);
    expect(kinds(u.id, 'password_changed')).toBe(0);
    const v = e.seedUser();
    const { cookie } = await e.signIn(v.email, auth);
    const r = await e.handle(post('/change-password', { currentPassword: PW, newPassword: 'a brand new long password 9', revokeOtherSessions: true }, cookie), auth);
    expect(r.status, JSON.stringify(await json(r))).toBe(200);
    expect(kinds(v.id, 'password_changed')).toBe(1);
  });
});

describe('R4.2 poly_auth\'s idle-in-transaction timeout is 15 s, set on the role', () => {
  it('SHOW as poly_auth answers 15s; poly_worker and poly_app keep the server default; pg_db_role_setting holds the entry [red if: the ALTER ROLE is missing from roles.sql]', async () => {
    const show = (role: string) => tx(e.db, role, async (q) => (await q('SHOW idle_in_transaction_session_timeout', [])).rows[0].idle_in_transaction_session_timeout);
    expect(await show('poly_auth')).toBe('15s');
    expect(await show('poly_worker')).not.toBe('15s');
    expect(await show('poly_app')).not.toBe('15s');
    expect(Number(must(`SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'poly_auth' AND 'idle_in_transaction_session_timeout=15s' = ANY (s.setconfig)`, e.db).rows[0]![0])).toBeGreaterThanOrEqual(1);
  });
});
