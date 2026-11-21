// POLY-149e (ruling R5; seceng ruling-review §2.1): the deploy gate behind INFRA §7.1 step 16, infra/postgres/gate-check.{sh,sql}.
// A check that guards a decision is shown to fail: it passes on the migrated, revoked schema, and every line of R5's table has a
// planted fault on a clone that it refuses (exit 1, the broken object named). Needs Postgres (the tests/db harness) and 0016, 0017.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
// `must` is the psql one (a connection per call, closed): helpers/sql keeps one pg.Client open per database, and one clone per plant
// (over a hundred) exhausted the server's max_connections.
import { must, psql, ROOT, server } from './helpers/pg';

const SCRIPT = join(ROOT, 'infra', 'postgres', 'gate-check.sh');
function gate(db: string) {
  const s = server();
  const cmd = s.container
    ? ['docker', 'exec', '-i', s.container, 'psql', '-U', 'postgres', '-d', db]
    : ['psql', s.superUrl.replace(/\/[^/]*$/, `/${db}`)];
  const r = spawnSync('sh', [SCRIPT, ...cmd], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

describe('the gate passes on the migrated, revoked schema', () => {
  it('exit 0 and exactly one line, `gate: pass`', () => {
    const g = gate(cloneMigrated());
    expect(g.out, g.err).toBe('gate: pass');
    expect(g.code).toBe(0);
  });
  it('poly_backup reads the record through pg_read_all_data and the gate still passes (the one allowed reader)', () => {
    const db = cloneMigrated();
    expect(must(`SELECT has_table_privilege('poly_backup', 'app.sign_in_record', 'SELECT')`, db).rows[0]![0]).toBe('t');
    expect(gate(db).code).toBe(0);
  });
});

type Plant = [name: string, sql: string, expected: string | RegExp];
const TRIGGERS: [string, string][] = [
  ['public.two_factor', 'two_factor_15_lock'], ['public.two_factor', 'two_factor_16_lock_delete'],
  ['public.session', 'session_80_sign_in_record'],
  ['app.sign_in_record', 'sign_in_record_05_refuse'], ['app.sign_in_record', 'sign_in_record_10_immutable'], ['app.sign_in_record', 'sign_in_record_no_truncate'],
  // POLY-150j (ruling Addendum 5): the method-change audit triggers and the step-up triggers
  ['public.two_factor', 'two_factor_80_sync'], ['public.passkey', 'passkey_80_sync'],
  ['public.two_factor', 'two_factor_85_step_up_spent'], ['app.step_up_totp', 'step_up_totp_10_forward'],
  ['app.step_up_pending', 'step_up_pending_resolved'],
  ['public.two_factor', 'two_factor_no_truncate'], ['public.passkey', 'passkey_no_truncate'],
];
const LOGINS = ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator'];
const TABLES = ['app.sign_in_record', 'app.second_step_streak'];
const DEFINERS = ['app.guard_second_step_lock()', 'app.record_session_sign_in()', 'app.sync_second_step()'];
const STEP_UP = 'app.complete_step_up(text,uuid,bigint)';
const plants: Plant[] = [
  // 1. the objects, RLS enabled and forced
  ['app.second_step_streak dropped', 'DROP TABLE app.second_step_streak CASCADE', 'table app.second_step_streak: missing'],
  ['app.sign_in_record dropped', 'DROP TABLE app.sign_in_record CASCADE', 'table app.sign_in_record: missing'],
  ['sign_in_record: FORCE ROW LEVEL SECURITY off', 'ALTER TABLE app.sign_in_record NO FORCE ROW LEVEL SECURITY', 'table app.sign_in_record: row-level security'],
  ['second_step_streak: ROW LEVEL SECURITY off', 'ALTER TABLE app.second_step_streak DISABLE ROW LEVEL SECURITY', 'table app.second_step_streak: row-level security'],
  // 2. the five triggers: dropped, then disabled
  ...TRIGGERS.map(([t, n]): Plant => [`trigger ${n} dropped`, `DROP TRIGGER ${n} ON ${t}`, `trigger ${n} on ${t}: missing`]),
  ...TRIGGERS.map(([t, n]): Plant => [`trigger ${n} disabled`, `ALTER TABLE ${t} DISABLE TRIGGER ${n}`, `trigger ${n} on ${t}: tgenabled = D`]),
  // 3. the two trigger definers: owner, SECURITY DEFINER, EXECUTE
  ...DEFINERS.flatMap((f): Plant[] => [
    [`${f} owned by poly_owner`, `ALTER FUNCTION ${f} OWNER TO poly_owner`, `function ${f}: owner is poly_owner`],
    [`${f} made an invoker`, `ALTER FUNCTION ${f} SECURITY INVOKER`, `function ${f}: not SECURITY DEFINER`],
    [`${f} EXECUTE to poly_worker`, `GRANT EXECUTE ON FUNCTION ${f} TO poly_worker`, `function ${f}: poly_worker can execute it`],
    [`${f} EXECUTE to PUBLIC`, `GRANT EXECUTE ON FUNCTION ${f} TO PUBLIC`, `function ${f}: poly_app can execute it`],
    [`${f} dropped`, `DROP FUNCTION ${f} CASCADE`, `function ${f}: missing`],
  ]),
  // 4. the purge
  ['purge owned by poly_owner', 'ALTER FUNCTION app.purge_sign_in_record() OWNER TO poly_owner', 'purge_sign_in_record(): owner is poly_owner'],
  ['purge made an invoker', 'ALTER FUNCTION app.purge_sign_in_record() SECURITY INVOKER', 'purge_sign_in_record(): not SECURITY DEFINER'],
  ['purge EXECUTE to poly_auth', 'GRANT EXECUTE ON FUNCTION app.purge_sign_in_record() TO poly_auth', 'purge_sign_in_record(): poly_auth can execute it'],
  ['purge EXECUTE to PUBLIC', 'GRANT EXECUTE ON FUNCTION app.purge_sign_in_record() TO PUBLIC', 'purge_sign_in_record(): poly_app can execute it'],
  ['purge EXECUTE revoked from poly_worker', 'REVOKE EXECUTE ON FUNCTION app.purge_sign_in_record() FROM poly_worker', 'purge_sign_in_record(): poly_worker cannot execute it'],
  ['purge dropped', 'DROP FUNCTION app.purge_sign_in_record()', 'purge_sign_in_record(): missing'],
  // 5. no login role writes either table (the five runtime roles and the backup role; table and column level)
  ...TABLES.flatMap((t): Plant[] => [
    ...LOGINS.concat('poly_backup').map((r): Plant => [`${r} INSERT on ${t}`, `GRANT INSERT ON ${t} TO ${r}`, `${t}: ${r} holds INSERT`]),
    [`poly_worker UPDATE on ${t}`, `GRANT UPDATE ON ${t} TO poly_worker`, `${t}: poly_worker holds UPDATE`],
    [`poly_auth column UPDATE on ${t}`, `GRANT UPDATE (user_id) ON ${t} TO poly_auth`, `${t}: poly_auth holds UPDATE`],
    [`poly_operator DELETE on ${t}`, `GRANT DELETE ON ${t} TO poly_operator`, `${t}: poly_operator holds DELETE`],
    [`poly_migrator TRUNCATE on ${t}`, `GRANT TRUNCATE ON ${t} TO poly_migrator`, `${t}: poly_migrator holds TRUNCATE`],
    [`poly_backup DELETE on ${t}`, `GRANT DELETE ON ${t} TO poly_backup`, `${t}: poly_backup holds DELETE`],
  ]),
  // 6. no runtime role reads the record (granted at table, at column, through a membership, through PUBLIC)
  ...LOGINS.map((r): Plant => [`${r} SELECT on sign_in_record`, `GRANT SELECT ON app.sign_in_record TO ${r}`, `app.sign_in_record: ${r} can read it`]),
  ['poly_auth column SELECT on sign_in_record', 'GRANT SELECT (user_id) ON app.sign_in_record TO poly_auth', 'app.sign_in_record: poly_auth can read it'],
  ['SELECT on the record to PUBLIC', 'GRANT SELECT ON app.sign_in_record TO PUBLIC', 'app.sign_in_record: poly_app can read it'],
  // 7. enter_asserted_user is absent
  ['enter_asserted_user recreated', 'CREATE FUNCTION app.enter_asserted_user(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$', 'app.enter_asserted_user(uuid,uuid): exists'],
  // 8. poly_app holds nothing on the six, the handle table, the record, the streak
  ...['public."user"', 'public.session', 'public.account', 'public.verification', 'public.two_factor', 'public.passkey']
    .map((t): Plant => [`poly_app SELECT on ${t}`, `GRANT SELECT ON ${t} TO poly_app`, `${t}: poly_app holds SELECT`]),
  ['poly_app column SELECT on session', 'GRANT SELECT (id) ON public.session TO poly_app', 'public.session: poly_app holds SELECT'],
  ['poly_app UPDATE on two_factor', 'GRANT UPDATE ON public.two_factor TO poly_app', 'public.two_factor: poly_app holds UPDATE'],
  ['poly_app DELETE on passkey', 'GRANT DELETE ON public.passkey TO poly_app', 'public.passkey: poly_app holds DELETE'],
  ['poly_app SELECT on session_handle', 'GRANT SELECT ON app.session_handle TO poly_app', 'app.session_handle: poly_app holds SELECT'],
  ['poly_app SELECT on the streak', 'GRANT SELECT ON app.second_step_streak TO poly_app', 'app.second_step_streak: poly_app holds SELECT'],
  // 9. poly_app's EXECUTE set on app is exactly the eleven
  ['poly_app EXECUTE on enter_new_user', 'GRANT EXECUTE ON FUNCTION app.enter_new_user(uuid) TO poly_app', 'function app.enter_new_user(uuid): poly_app can execute it'],
  ['a new app function granted to PUBLIC', 'CREATE FUNCTION app.qa_new() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; GRANT EXECUTE ON FUNCTION app.qa_new() TO PUBLIC', 'function app.qa_new(): poly_app can execute it'],
  ['poly_app loses enter_session', 'REVOKE EXECUTE ON FUNCTION app.enter_session(text) FROM poly_app', 'function app.enter_session(text): poly_app cannot execute it'],
  ['poly_app loses my_second_step (RC1)', 'REVOKE EXECUTE ON FUNCTION app.my_second_step() FROM poly_app', 'function app.my_second_step(): poly_app cannot execute it'],
  // 12. method changes are audited by the database (Addendum 5)
  ['passkey_80_sync re-pointed at another function', 'DROP TRIGGER passkey_80_sync ON public.passkey; CREATE TRIGGER passkey_80_sync AFTER INSERT OR DELETE ON public.passkey FOR EACH ROW EXECUTE FUNCTION app.guard_second_step_lock()', 'trigger passkey_80_sync on public.passkey: does not run app.sync_second_step()'],
  ['two_factor_80_sync re-pointed at another function', 'DROP TRIGGER two_factor_80_sync ON public.two_factor; CREATE TRIGGER two_factor_80_sync AFTER INSERT OR DELETE ON public.two_factor FOR EACH ROW EXECUTE FUNCTION app.guard_second_step_lock()', 'trigger two_factor_80_sync on public.two_factor: does not run app.sync_second_step()'],
  ...['method_added', 'method_removed'].map((k): Plant => [`sync_second_step body no longer writes ${k}`,
    `UPDATE pg_proc SET prosrc = replace(prosrc, 'second_step.${k}', 'second_step.x') WHERE oid = 'app.sync_second_step()'::regprocedure`,
    `function app.sync_second_step(): its body does not write second_step.${k}`]),
  ...[['public.two_factor', 'two_factor_no_truncate'], ['public.passkey', 'passkey_no_truncate']].flatMap(([t, n]): Plant[] => [
    [`${n} re-pointed at another function`, `DROP TRIGGER ${n} ON ${t}; CREATE TRIGGER ${n} BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION app.guard_second_step_lock()`, `trigger ${n} on ${t}: not BEFORE TRUNCATE FOR EACH STATEMENT running app.refuse_truncate()`],
    [`${n} fired AFTER, not BEFORE`, `DROP TRIGGER ${n} ON ${t}; CREATE TRIGGER ${n} AFTER TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate()`, `trigger ${n} on ${t}: not BEFORE TRUNCATE FOR EACH STATEMENT running app.refuse_truncate()`],
  ]),
  // 13. complete_step_up
  [`${STEP_UP} owned by poly_owner`, `ALTER FUNCTION ${STEP_UP} OWNER TO poly_owner`, `function ${STEP_UP}: owner is poly_owner`],
  [`${STEP_UP} made an invoker`, `ALTER FUNCTION ${STEP_UP} SECURITY INVOKER`, `function ${STEP_UP}: not SECURITY DEFINER`],
  [`${STEP_UP} EXECUTE to poly_worker`, `GRANT EXECUTE ON FUNCTION ${STEP_UP} TO poly_worker`, `function ${STEP_UP}: poly_worker can execute it`],
  [`${STEP_UP} EXECUTE to PUBLIC`, `GRANT EXECUTE ON FUNCTION ${STEP_UP} TO PUBLIC`, `function ${STEP_UP}: poly_app can execute it`],
  [`${STEP_UP} EXECUTE revoked from poly_auth`, `REVOKE EXECUTE ON FUNCTION ${STEP_UP} FROM poly_auth`, `function ${STEP_UP}: poly_auth cannot execute it`],
  [`${STEP_UP} dropped`, `DROP FUNCTION ${STEP_UP}`, `function ${STEP_UP}: missing`],
  ['poly_auth granted UPDATE (recent_auth_at) on session', 'GRANT UPDATE (recent_auth_at) ON public.session TO poly_auth', 'public.session.recent_auth_at: poly_auth holds UPDATE'],
  ['poly_worker granted UPDATE on session (whole table)', 'GRANT UPDATE ON public.session TO poly_worker', 'public.session.recent_auth_at: poly_worker holds UPDATE'],
  // 14. the deferred constraint trigger
  ['step_up_pending_resolved made immediate', `DO $$ DECLARE f regproc; BEGIN SELECT tgfoid::regproc INTO f FROM pg_trigger WHERE tgname = 'step_up_pending_resolved'; DROP TRIGGER step_up_pending_resolved ON app.step_up_pending; EXECUTE format('CREATE CONSTRAINT TRIGGER step_up_pending_resolved AFTER INSERT ON app.step_up_pending FOR EACH ROW EXECUTE FUNCTION %s()', f); END $$`, 'trigger step_up_pending_resolved on app.step_up_pending: not DEFERRABLE INITIALLY DEFERRED'],
  // 10. no login role deletes a user
  ...LOGINS.map((r): Plant => [`${r} DELETE on user`, `GRANT DELETE ON public."user" TO ${r}`, `public."user": ${r} holds DELETE`]),
];


// POLY-137 R3.8, R4.2, R5.3 (ruling @ a5e9ce4f): gate lines 15-24. Each plant breaks exactly one thing on a migrated clone; the gate must exit 1
// and print the broken object. The FAIL wording follows the existing lines' phrasing; the ruling words only line 19 exactly
// (`FAIL mail: <n> notices unsent for over an hour`), so every other expected string is ASSUMED and reconciled here, in one place.
const NEWTBL = ['app.method_hold', 'app.mail_outbox'];
const NEWLOGINS = ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator'];
const DEF137: [sig: string, owner: string, exec: string | null][] = [
  ['app.method_held(text,uuid)', 'poly_govern', 'poly_auth'], ['app.cancel_method_hold(text)', 'poly_govern', 'poly_auth'],
  ['app.claim_mail()', 'poly_govern', 'poly_worker'], ['app.arm_hold_cancel(uuid,bytea)', 'poly_govern', 'poly_worker'],
  ['app.mail_sent(uuid)', 'poly_govern', 'poly_worker'], ['app.mail_failed(uuid,integer)', 'poly_govern', 'poly_worker'],
  ['app.purge_mail_outbox()', 'poly_purge', 'poly_worker'],
  ['app.note_codes_replaced()', 'poly_govern', null], ['app.note_password_changed()', 'poly_govern', null],
];
const TRIG137: [tbl: string, name: string, runs: string][] = [
  ['public.two_factor', 'two_factor_12_method_hold', 'app.guard_method_hold()'], ['public.passkey', 'passkey_12_method_hold', 'app.guard_method_hold()'],
  ['public."user"', 'user_21_email_fixed', 'app.refuse_email_change()'], ['public.two_factor', 'two_factor_84_codes_replaced', 'app.note_codes_replaced()'],
  ['public.account', 'account_80_password_changed', 'app.note_password_changed()'],
];
const plants137: Plant[] = [
  // 15. the two tables
  ...NEWTBL.map((t): Plant => [`${t} dropped`, `DROP TABLE ${t} CASCADE`, `table ${t}: missing`]),
  ...NEWTBL.flatMap((t): Plant[] => [
    [`${t}: FORCE ROW LEVEL SECURITY off`, `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`, `table ${t}: row-level security`],
    [`${t}: ROW LEVEL SECURITY off`, `ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`, `table ${t}: row-level security`],
    ...NEWLOGINS.map((r): Plant => [`${r} SELECT on ${t}`, `GRANT SELECT ON ${t} TO ${r}`, `${t}: ${r} holds SELECT`]),
    ...['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].map((p): Plant => [`poly_auth ${p} on ${t}`, `GRANT ${p} ON ${t} TO poly_auth`, `${t}: poly_auth holds ${p}`]),
    [`poly_worker column UPDATE on ${t}`, `GRANT UPDATE (${t === 'app.method_hold' ? 'usable_at' : 'sent_at'}) ON ${t} TO poly_worker`, `${t}: poly_worker holds UPDATE`],
    [`poly_auth column SELECT on ${t}`, `GRANT SELECT (${t === 'app.method_hold' ? 'cancel_hash' : 'to_address'}) ON ${t} TO poly_auth`, `${t}: poly_auth holds SELECT`],
    [`poly_backup INSERT on ${t}`, `GRANT INSERT ON ${t} TO poly_backup`, `${t}: poly_backup holds INSERT`],
  ]),
  // 16 and 20. the triggers: dropped, disabled, re-pointed
  ...TRIG137.flatMap(([t, n, f]): Plant[] => [
    [`trigger ${n} dropped`, `DROP TRIGGER ${n} ON ${t}`, `trigger ${n} on ${t}: missing`],
    [`trigger ${n} disabled`, `ALTER TABLE ${t} DISABLE TRIGGER ${n}`, `trigger ${n} on ${t}: tgenabled = D`],
    [`trigger ${n} re-pointed at another function`, `DROP TRIGGER ${n} ON ${t}; CREATE TRIGGER ${n} AFTER INSERT ON ${t} FOR EACH ROW EXECUTE FUNCTION app.refuse_truncate()`, `trigger ${n} on ${t}: does not run ${f}`],
  ]),
  ['two_factor_12_method_hold fired AFTER, not BEFORE UPDATE OF the two columns', 'DROP TRIGGER two_factor_12_method_hold ON public.two_factor; CREATE TRIGGER two_factor_12_method_hold AFTER UPDATE OF failed_verification_count, backup_codes ON public.two_factor FOR EACH ROW EXECUTE FUNCTION app.guard_method_hold()', 'trigger two_factor_12_method_hold on public.two_factor: not BEFORE UPDATE OF failed_verification_count, backup_codes'],
  ['two_factor_12_method_hold on every UPDATE (no column list)', 'DROP TRIGGER two_factor_12_method_hold ON public.two_factor; CREATE TRIGGER two_factor_12_method_hold BEFORE UPDATE ON public.two_factor FOR EACH ROW EXECUTE FUNCTION app.guard_method_hold()', 'trigger two_factor_12_method_hold on public.two_factor: not BEFORE UPDATE OF failed_verification_count, backup_codes'],
  ['passkey_12_method_hold fired AFTER, not BEFORE UPDATE OF counter', 'DROP TRIGGER passkey_12_method_hold ON public.passkey; CREATE TRIGGER passkey_12_method_hold AFTER UPDATE OF counter ON public.passkey FOR EACH ROW EXECUTE FUNCTION app.guard_method_hold()', 'trigger passkey_12_method_hold on public.passkey: not BEFORE UPDATE OF counter'],
  // 17. the tripwire: bodies that name the hold and the outbox (the proof is behavioural, R3.10 tests 3, 7, 8)
  ['sync_second_step body no longer names app.method_hold', `UPDATE pg_proc SET prosrc = replace(prosrc, 'app.method_hold', 'app.x') WHERE oid = 'app.sync_second_step()'::regprocedure`, 'function app.sync_second_step(): its body does not mention app.method_hold'],
  ['sync_second_step body no longer names app.mail_outbox', `UPDATE pg_proc SET prosrc = replace(prosrc, 'app.mail_outbox', 'app.x') WHERE oid = 'app.sync_second_step()'::regprocedure`, 'function app.sync_second_step(): its body does not mention app.mail_outbox'],
  ['complete_step_up body no longer names method_hold', `UPDATE pg_proc SET prosrc = replace(prosrc, 'method_hold', 'x') WHERE oid = 'app.complete_step_up(text,uuid,bigint)'::regprocedure`, 'function app.complete_step_up(text,uuid,bigint): its body does not mention method_hold'],
  ['check_factor_removal body no longer names method_hold', `UPDATE pg_proc SET prosrc = replace(prosrc, 'method_hold', 'x') WHERE oid = 'app.check_factor_removal(uuid,text,uuid)'::regprocedure`, 'function app.check_factor_removal(uuid,text,uuid): its body does not mention method_hold'],
  // 18. the nine new definers
  ...DEF137.flatMap(([f, owner, exec]): Plant[] => [
    [`${f} dropped`, `DROP FUNCTION ${f} CASCADE`, `function ${f}: missing`],
    [`${f} owned by poly_owner (not ${owner})`, `ALTER FUNCTION ${f} OWNER TO poly_owner`, `function ${f}: owner is poly_owner`],
    [`${f} made an invoker`, `ALTER FUNCTION ${f} SECURITY INVOKER`, `function ${f}: not SECURITY DEFINER`],
    [`${f} EXECUTE to PUBLIC`, `GRANT EXECUTE ON FUNCTION ${f} TO PUBLIC`, `function ${f}: poly_app can execute it`],
    ...NEWLOGINS.filter((r) => r !== exec && r !== 'poly_app').map((r): Plant => [`${f} EXECUTE to ${r}`, `GRANT EXECUTE ON FUNCTION ${f} TO ${r}`, `function ${f}: ${r} can execute it`]),
    ...(exec ? [[`${f} EXECUTE revoked from ${exec}`, `REVOKE EXECUTE ON FUNCTION ${f} FROM ${exec}`, `function ${f}: ${exec} cannot execute it`] as Plant] : []),
  ]),
  // 19. a notice unsent for over an hour (exact line, ruling R3.8)
  ['an unsent outbox row 2 hours old', `INSERT INTO public."user" (name, email, email_verified) VALUES ('G', 'g@qa.test', true); INSERT INTO app.mail_outbox (user_id, kind, to_address, payload, created_at) SELECT id, 'password_changed', email, '{}'::jsonb, now() - interval '2 hours' FROM public."user" LIMIT 1`, 'FAIL mail: 1 notices unsent for over an hour'],
  // 21. poly_auth's idle timeout: its two plants alter a CLUSTER-wide role setting, so they run serially in gate-check-role-setting.test.ts
  // 22-24. the purges' footprint: a row the purge would have deleted
  ['a tx_identity row 7 hours old, its transaction over', `INSERT INTO app.tx_identity (xid, user_id, kind, created_at) VALUES ('1'::xid8, gen_random_uuid(), 'session', now() - interval '7 hours')`, /tx_identity.*6 hours/],
  ['a sign_in_record row 402 days old', `BEGIN; SET LOCAL session_replication_role = replica; INSERT INTO app.sign_in_record (kind, user_id, session_id, created_at) VALUES ('session', gen_random_uuid(), gen_random_uuid(), now() - interval '402 days'); COMMIT`, /sign_in_record.*401 days/],
  ['a SENT outbox row 32 days old', `INSERT INTO public."user" (name, email, email_verified) VALUES ('G', 'g@qa.test', true); INSERT INTO app.mail_outbox (user_id, kind, to_address, payload, created_at, sent_at) SELECT id, 'password_changed', email, '{}'::jsonb, now() - interval '32 days', now() - interval '32 days' FROM public."user" LIMIT 1`, /mail_outbox.*31 days/],
];
plants.push(...plants137);

describe('the gate refuses each planted fault: exit 1, the broken object named', () => {
  it.each(plants)('%s', (_name, sql, expected) => {
    const db = cloneMigrated();
    must(sql, db);
    const g = gate(db);
    expect(g.code, g.out).toBe(1);
    expect(g.out).toContain('FAIL');
    if (typeof expected === 'string') expect(g.out).toContain(expected); else expect(g.out).toMatch(expected);
    expect(g.out).not.toContain('gate: pass');
  });
});


describe('POLY-137 gate lines 15-24: the positive cases (each fault above is the only thing that differs from a pass)', () => {
  const user = `INSERT INTO public."user" (name, email, email_verified) VALUES ('G', 'g@qa.test', true)`;
  const row = (age: string, sent: boolean) => `INSERT INTO app.mail_outbox (user_id, kind, to_address, payload, created_at${sent ? ', sent_at' : ''}) SELECT id, 'password_changed', email, '{}'::jsonb, now() - interval '${age}'${sent ? `, now() - interval '${age}'` : ''} FROM public."user" LIMIT 1`;
  it('an unsent row 59 minutes old does not fail line 19 [red if: the threshold is not an hour, or any unsent row fails]', () => {
    const db = cloneMigrated();
    must(`${user}; ${row('59 minutes', false)}`, db);
    const g = gate(db);
    expect(g.out, g.err).toBe('gate: pass');
  });
  it('a SENT row 2 hours old does not fail line 19, and a sent row 30 days old does not fail line 24 [red if: a sent notice counts as unsent, or the 31-day line fires early]', () => {
    const db = cloneMigrated();
    must(`${user}; ${row('2 hours', true)}; ${row('30 days', true)}`, db);
    const g = gate(db);
    expect(g.out, g.err).toBe('gate: pass');
  });
  it('poly_backup reads both new tables through pg_read_all_data and the gate still passes (the one allowed reader) [red if: the new tables are not covered by the allowed-reader rule]', () => {
    const db = cloneMigrated();
    for (const t of ['app.method_hold', 'app.mail_outbox']) expect(must(`SELECT has_table_privilege('poly_backup', '${t}', 'SELECT')`, db).rows[0]![0]).toBe('t');
    expect(gate(db).out).toBe('gate: pass');
  });
});

describe('the owner and the record (sign_in_record_05_refuse): an error, not a row count', () => {
  const asOwner = (db: string, sql: string) => psql(`BEGIN; SET LOCAL ROLE poly_owner; ${sql}; ROLLBACK;`, db);
  it('UPDATE and DELETE as poly_owner each raise 42501, on an empty table too', () => {
    const db = cloneMigrated();
    for (const sql of ['UPDATE app.sign_in_record SET kind = kind', 'DELETE FROM app.sign_in_record']) {
      const r = asOwner(db, sql);
      expect(r.sqlstate, `${sql}: ${r.err}${r.out}`).toBe('42501');
    }
  });
  it('with the trigger dropped the same statements succeed as "0 rows": the plant the gate refuses', () => {
    const db = cloneMigrated();
    must('DROP TRIGGER sign_in_record_05_refuse ON app.sign_in_record', db);
    const r = asOwner(db, 'DELETE FROM app.sign_in_record');
    expect(r.sqlstate).not.toBe('42501');
    expect(gate(db).out).toContain('trigger sign_in_record_05_refuse on app.sign_in_record: missing');
  });
});

describe('the script', () => {
  it('exits 1 when psql itself fails (a database that does not exist), never 0', () => {
    const g = gate('poly_gate_check_no_such_db');
    expect(g.code).toBe(1);
    expect(g.out).not.toContain('gate: pass');
  });
  it('exits 2 with no psql command', () => {
    expect(spawnSync('sh', [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
  });
});
