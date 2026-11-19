// POLY-149e (ruling R5; seceng ruling-review §2.1): the deploy gate behind INFRA §7.1 step 16, infra/postgres/gate-check.{sh,sql}.
// A check that guards a decision is shown to fail: it passes on the migrated, revoked schema, and every line of R5's table has a
// planted fault on a clone that it refuses (exit 1, the broken object named). Needs Postgres (the tests/db harness) and 0016, 0017.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { ROOT, server } from './helpers/pg';
import { must } from './helpers/sql';

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

type Plant = [name: string, sql: string, expected: string];
const TRIGGERS: [string, string][] = [
  ['public.two_factor', 'two_factor_15_lock'], ['public.two_factor', 'two_factor_16_lock_delete'],
  ['public.session', 'session_80_sign_in_record'],
  ['app.sign_in_record', 'sign_in_record_10_immutable'], ['app.sign_in_record', 'sign_in_record_no_truncate'],
];
const LOGINS = ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator'];
const TABLES = ['app.sign_in_record', 'app.second_step_streak'];
const DEFINERS = ['app.guard_second_step_lock()', 'app.record_session_sign_in()'];
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
  // 9. poly_app's EXECUTE set on app is exactly the ten
  ['poly_app EXECUTE on enter_new_user', 'GRANT EXECUTE ON FUNCTION app.enter_new_user(uuid) TO poly_app', 'function app.enter_new_user(uuid): poly_app can execute it'],
  ['a new app function granted to PUBLIC', 'CREATE FUNCTION app.qa_new() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; GRANT EXECUTE ON FUNCTION app.qa_new() TO PUBLIC', 'function app.qa_new(): poly_app can execute it'],
  ['poly_app loses enter_session', 'REVOKE EXECUTE ON FUNCTION app.enter_session(text) FROM poly_app', 'function app.enter_session(text): poly_app cannot execute it'],
  // 10. no login role deletes a user
  ...LOGINS.map((r): Plant => [`${r} DELETE on user`, `GRANT DELETE ON public."user" TO ${r}`, `public."user": ${r} holds DELETE`]),
];

describe('the gate refuses each planted fault: exit 1, the broken object named', () => {
  it.each(plants)('%s', (_name, sql, expected) => {
    const db = cloneMigrated();
    must(sql, db);
    const g = gate(db);
    expect(g.code, g.out).toBe(1);
    expect(g.out).toContain('FAIL');
    expect(g.out).toContain(expected);
    expect(g.out).not.toContain('gate: pass');
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
