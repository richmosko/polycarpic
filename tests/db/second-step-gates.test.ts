// POLY-89c red gate (ruling 89ff3c8d; seceng conditions C-a..C-f). The database guards of R1, R3, R4, R6. Every title ends
// [red if: <mutation>]. A refusal runs as poly_app and as the fixture login role poly_auth (R1.3: the harness creates it
// with poly_app's grants by membership; roles.sql gains it only in POLY-149). A positive path runs as poly_app.
// Each test works in its own rolled-back transaction on unique ids, so none depends on another's rows.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { DB_PKG, server, url } from './helpers/pg';
import { must } from './helpers/sql';

const pgmod = createRequire(join(DB_PKG, 'package.json'))('pg');
const ROLES = ['poly_app', 'poly_auth'] as const;
type Role = (typeof ROLES)[number];
let db: string;
let n = 0;
const uid = (k: number) => `00000000-0000-4000-8000-00000089${String(k).padStart(4, '0')}`;
const SID = '00000000-0000-4000-8000-0000000089e1';
const NO_SESSION = '00000000-0000-4000-8000-0000000089ff';

beforeAll(() => {
  db = cloneMigrated();
  // poly_auth (the stage-2 fixture role) is created once per run in helpers/api.ts setRolePasswords, never here (cluster-wide state)
});
afterAll(() => { /* the cloned database is dropped with the run's server */ });

const codeOf = (x: any): string | undefined => x?.code ?? x?.cause?.code;
const msgOf = (x: any): string => String(x?.cause?.message ?? x?.message ?? x);
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (x) { return x as any; } };

/** A user seeded as superuser. `enrolled` sets second_step_at only through a verified two_factor row written by superuser. */
async function seed(o: { enrolled?: boolean; ownPerson?: boolean } = {}): Promise<{ id: string; email: string; person: string | null }> {
  const id = uid(++n + 100 * (process.pid % 90));
  const email = `g${id.slice(-8)}@qa.test`;
  must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${id}', 'G', '${email}', true)`, db);
  let person: string | null = null;
  if (o.ownPerson !== false) {
    // the own Person is created the way provisionPerson does: as poly_app under the marker, committed (seat_creator seats the owner)
    await committed(id, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), $1, 'individual', $2)`, [`P${id}`, id]));
    person = must(`SELECT id FROM public.entity WHERE self_user_id = '${id}'`, db).rows[0]![0]!;
  }
  if (o.enrolled) {
    must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${id}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${id}'; COMMIT;`, db);
  }
  return { id, email, person };
}
/** Marked poly_app transaction that COMMITS (fixtures only). */
async function committed(user: string, fn: (q: (t: string, v?: unknown[]) => Promise<any>) => Promise<unknown>): Promise<void> {
  const c = new pgmod.Client({ connectionString: url('poly_app', db) });
  await c.connect();
  const q = (text: string, values?: unknown[]) => c.query({ text, values, queryMode: 'extended' });
  try { await q('BEGIN'); await q('SELECT app.enter_asserted_user($1, $2)', [user, SID]); await fn(q); await q('COMMIT'); }
  catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; }
  finally { await c.end(); }
}
/** A shared business entity owned by an ENROLLED `owner`; returns its id. */
async function shared(owner: string, name: string): Promise<string> {
  await committed(owner, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_pass_through')`, [name]));
  return must(`SELECT id FROM public.entity WHERE name = '${name}'`, db).rows[0]![0]!;
}

/** One marked transaction as `role`: BEGIN; enter_asserted_user; fn; ROLLBACK. Every query is extended-mode. */
async function marked<T>(role: Role, user: string | null, session: string | null, fn: (q: (t: string, v?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
  const c = new pgmod.Client({ connectionString: url(role, db) });
  await c.connect();
  const q = (text: string, values?: unknown[]) => c.query({ text, values, queryMode: 'extended' });
  try {
    await q('BEGIN');
    if (user) await q('SELECT app.enter_asserted_user($1, $2)', [user, session ?? SID]);
    return await fn(q);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
const mkEntity = (q: (t: string, v?: unknown[]) => Promise<any>, key: string) =>
  q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = $1), $2, $3)`,
    [key, `E${key}${++n}`, ({ person: 'individual', trust: 'trust_grantor', business: 'business_pass_through', household: 'parent_pass_through', holding: 'parent_pass_through' } as Record<string, string>)[key]]);
const REFUSED = /second_step_required/;

describe('C1/C2 the own-Person exemption and the forcing actions (R3 #10, #11; R4)', () => {
  it('C1: a user with only an unshared own Person is not required to enrol, and the own Person is created without a second step [red if: app.second_step_required() is missing or true for the own Person]', async () => {
    const u = await seed({ ownPerson: false });
    await marked('poly_app', u.id, null, async (q) => {
      await q(`INSERT INTO public.entity (type_id, name, tax_classification, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), 'own', 'individual', $1)`, [u.id]);
      expect((await q('SELECT app.second_step_required() AS r')).rows[0].r).toBe(false);
    });
  });
  for (const role of ROLES) {
    for (const key of ['trust', 'business', 'household', 'holding'] as const) {
      it(`C2: ${role} creating a ${key} while unenrolled is refused second_step_required [red if: membership_05_second_step is absent or seat_creator still seats the creator]`, async () => {
        const u = await seed();
        const x = await marked(role, u.id, null, (q) => fails(mkEntity(q, key)));
        expect(msgOf(x)).toMatch(REFUSED);
      });
    }
    it(`C2: ${role} creating a second Person (not the own Person) while unenrolled is refused [red if: the exemption is a type test and not own_person_exempt]`, async () => {
      const u = await seed();
      const x = await marked(role, u.id, null, (q) => fails(mkEntity(q, 'person')));
      expect(msgOf(x)).toMatch(REFUSED);
    });
    it(`C2: ${role} sharing the own Person (first invitation) while unenrolled is refused [red if: invitation_05_second_step is absent]`, async () => {
      const u = await seed();
      const x = await marked(role, u.id, null, (q) => fails(q(
        `INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ($1, 'x@qa.test', 'viewer', $2, decode(repeat('ab', 32), 'hex'), now() + interval '1 day')`, [u.person, u.id])));
      expect(msgOf(x)).toMatch(REFUSED);
    });
    it(`C2: ${role} raising a viewer to manager on a shared entity while unenrolled is refused [red if: membership_05 does not cover UPDATE OF role]`, async () => {
      const owner = await seed({ enrolled: true });
      const v = await seed({ ownPerson: false });
      const ent = await shared(owner.id, `sh${v.id}`);
      must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${owner.id}', 'owner'), ('${ent}', '${v.id}', 'viewer') ON CONFLICT DO NOTHING`, db);
      const x = await marked(role, owner.id, null, (q) => fails(q(`UPDATE public.membership SET role = 'manager' WHERE entity_id = $1 AND user_id = $2`, [ent, v.id])));
      expect(msgOf(x)).toMatch(REFUSED);
    });
  }
  it('C2: an enrolled user creates a Trust and shares the own Person [red if: the refusals are unconditional]', async () => {
    const u = await seed({ enrolled: true });
    await marked('poly_app', u.id, null, async (q) => {
      await mkEntity(q, 'trust');
      // seat_creator seats the creator as owner; nothing here is refused
      await q(`INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ($1, 'x@qa.test', 'viewer', $2, decode(repeat('ac', 32), 'hex'), now() + interval '1 day')`, [u.person, u.id]);
    });
  });
  it('C2: viewing a shared entity never forces enrolment: second_step_required() is false for a viewer-only user [red if: the predicate counts viewer roles]', async () => {
    const owner = await seed({ enrolled: true });
    const v = await seed();
    const ent = await shared(owner.id, `vw${v.id}`);
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${owner.id}', 'owner'), ('${ent}', '${v.id}', 'viewer') ON CONFLICT DO NOTHING`, db);
    await marked('poly_app', v.id, null, async (q) => expect((await q('SELECT app.second_step_required() AS r')).rows[0].r).toBe(false));
  });
  it('C10: the own Person stops being exempt once another user holds a membership or a live invitation on it [red if: own_person_exempt ignores invitations or other members]', async () => {
    const u = await seed({ enrolled: true });
    const other = await seed({ ownPerson: false });
    // enrolled is not the point: the predicate itself is read through second_step_required() for a user with no factor
    const w = await seed();
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${w.person}', '${other.id}', 'viewer')`, db);
    await marked('poly_app', w.id, null, async (q) => expect((await q('SELECT app.second_step_required() AS r')).rows[0].r).toBe(true));
    const z = await seed();
    must(`INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ('${z.person}', 'inv@qa.test', 'manager', '${u.id}', decode(repeat('ad', 32), 'hex'), now() + interval '1 day')`, db);
    await marked('poly_app', z.id, null, async (q) => expect((await q('SELECT app.second_step_required() AS r')).rows[0].r).toBe(true));
  });
  it.todo('C2: accepting an owner or manager invitation seats nothing until enrolment, then app.seat_claimed_invitations() seats it (needs a verified first factor written under a marker; written with the build)');
});

describe('C7 second_step_at has one writer (R3 #8)', () => {
  it('poly_app holds no UPDATE on user.second_step_at and no function body but app.sync_second_step() assigns it [red if: another definer assigns it or poly_app is granted it]', () => {
    expect(must(`SELECT has_column_privilege('poly_app', 'public.user', 'second_step_at', 'UPDATE')`, db).rows[0]![0]).toBe('f');
    expect(must(`SELECT has_column_privilege('poly_auth', 'public.user', 'second_step_at', 'UPDATE')`, db).rows[0]![0]).toBe('f');
    const writers = must(`SELECT p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'app' AND p.prosrc ~* 'second_step_at\\s*=' ORDER BY 1`, db).rows.map((r) => r[0]);
    expect(writers).toEqual(['sync_second_step']);
  });
  for (const role of ROLES) {
    it(`${role} UPDATE user.second_step_at is refused [red if: the column grant exists]`, async () => {
      const u = await seed();
      const x = await marked(role, u.id, null, (q) => fails(q(`UPDATE public."user" SET second_step_at = now() WHERE id = $1`, [u.id])));
      expect(codeOf(x)).toBe('42501');
    });
  }
  it('sync_second_step sets the column when a verified two_factor row exists and clears it on delete, for the row\'s own user with no marker [red if: sync uses app.current_user_id()]', async () => {
    const u = await seed();
    must(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${u.id}', true)`, db);
    expect(must(`SELECT second_step_at IS NOT NULL FROM public."user" WHERE id = '${u.id}'`, db).rows[0]![0]).toBe('t');
    must(`UPDATE public."user" SET two_factor_enabled = true WHERE id = '${u.id}'`, db);
    must(`BEGIN; DELETE FROM public.two_factor WHERE user_id = '${u.id}'; UPDATE public."user" SET two_factor_enabled = false WHERE id = '${u.id}'; COMMIT;`, db);
    expect(must(`SELECT second_step_at IS NULL FROM public."user" WHERE id = '${u.id}'`, db).rows[0]![0]).toBe('t');
  });
  it('an account row never counts as a second step [red if: sync counts account rows]', async () => {
    const u = await seed();
    must(`INSERT INTO public.account (account_id, provider_id, user_id, updated_at) VALUES ('${u.id}', 'google', '${u.id}', now())`, db);
    expect(must(`SELECT second_step_at IS NULL FROM public."user" WHERE id = '${u.id}'`, db).rows[0]![0]).toBe('t');
  });
});

describe('C14 user.two_factor_enabled is guarded (R3 #2, #9)', () => {
  for (const role of ROLES) {
    it(`${role} bare UPDATE of two_factor_enabled (on or off) is refused [red if: poly_app keeps UPDATE on the column or user_30 is absent]`, async () => {
      const on = await seed();
      const x = await marked(role, on.id, null, (q) => fails(q(`UPDATE public."user" SET two_factor_enabled = true WHERE id = $1`, [on.id])));
      expect(x).not.toBeNull();
      const off = await seed({ enrolled: true });
      const y = await marked(role, off.id, null, (q) => fails(q(`UPDATE public."user" SET two_factor_enabled = false WHERE id = $1`, [off.id])));
      expect(y).not.toBeNull();
    });
    it(`${role} INSERT of a user with two_factor_enabled = true is refused [red if: the INSERT branch of guard_two_factor_flag is absent]`, async () => {
      const x = await marked(role, null, null, (q) => fails(q(`INSERT INTO public."user" (id, name, email, two_factor_enabled) VALUES ($1, 'x', $2, true)`, [uid(900 + ++n), `ins${n}@qa.test`])));
      expect(x).not.toBeNull();
    });
  }
  it('the flag must equal "a verified two_factor row exists" at commit: a verified row inserted without the flip fails at COMMIT [red if: two_factor_91_consistent is absent]', async () => {
    const u = await seed();
    const c = new pgmod.Client({ connectionString: url('poly_app', db) });
    await c.connect();
    try {
      await c.query({ text: 'BEGIN', queryMode: 'extended' });
      await c.query({ text: 'SELECT app.enter_asserted_user($1, $2)', values: [u.id, SID], queryMode: 'extended' });
      const ins = await fails(c.query({ text: `INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', $1, true)`, values: [u.id], queryMode: 'extended' }));
      const commit = ins ?? (await fails(c.query({ text: 'COMMIT', queryMode: 'extended' })));
      expect(commit).not.toBeNull();
    } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  });
  it('set_two_factor_enabled(true) needs an unverified two_factor row of the user and, for a first factor, a live grant; with neither it refuses [red if: app.set_two_factor_enabled is absent]', async () => {
    const u = await seed();
    for (const role of ROLES) {
      const x = await marked(role, u.id, null, (q) => fails(q('SELECT app.set_two_factor_enabled($1)', [true])));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    }
  });
});

describe('C13/R1.2 the session id never proves a session (forge cases)', () => {
  const stepUpAttempt = (q: any, user: string, flip: boolean) => fails(q('SELECT app.set_two_factor_enabled($1)', [flip]));
  for (const role of ROLES) {
    it(`(a) ${role}: marker names another real session of the same user holding no grant and no fresh stamp: turning the flag off is refused [red if: a guard accepts the session id alone]`, async () => {
      const u = await seed({ enrolled: true });
      const s = must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${u.id}', 'tk${n}${Math.random()}', now() + interval '1 day') RETURNING id`, db).rows[0]![0]!;
      const x = await marked(role, u.id, s, (q) => stepUpAttempt(q, u.id, false));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    });
    it(`(b) ${role}: marker names a uuid with no session row: refused [red if: a guard accepts an unknown session id]`, async () => {
      const u = await seed({ enrolled: true });
      const x = await marked(role, u.id, NO_SESSION, (q) => stepUpAttempt(q, u.id, false));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    });
    it(`(c) ${role}: marker names another user's session that holds a fresh stamp: refused [red if: the stamp check omits user_id = app.current_user_id()]`, async () => {
      const victim = await seed({ enrolled: true });
      const attacker = await seed({ enrolled: true });
      const s = must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${victim.id}', 'tk${n}${Math.random()}', now() + interval '1 day') RETURNING id`, db).rows[0]![0]!;
      must(`UPDATE public.session SET recent_auth_at = now() WHERE id = '${s}'`, db);
      const x = await marked(role, attacker.id, s, (q) => stepUpAttempt(q, attacker.id, false));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    });
  }
  it('(d) passes BY DESIGN (seceng C-c, SECURITY R-2): the marker names the victim and the victim\'s own session stamped within 5 minutes, so the step-up check passes; web\'s word until POLY-149 [red if: the check starts demanding a proof only web could give, or the fresh window is not 300 s]', async () => {
    const victim = await seed({ enrolled: true });
    const s = must(`INSERT INTO public.session (user_id, token, expires_at, recent_auth_at) VALUES ('${victim.id}', 'tk${n}${Math.random()}', now() + interval '1 day', now()) RETURNING id`, db).rows[0]![0]!;
    // the stamp is a superuser fixture write; no login role can make it (see the R1.4 grants test)
    const ok = await marked('poly_app', victim.id, s, async (q) => (await fails(q('SELECT app.set_two_factor_enabled($1)', [false]))));
    // allowed to refuse only for the last-method rule, never for freshness
    expect(ok === null || !/does not exist/.test(msgOf(ok))).toBe(true);
    if (ok) expect(msgOf(ok)).not.toMatch(/step.?up|fresh|recent/i);
    // and it is exactly 300 s: a stamp 301 s old does not pass
    must(`UPDATE public.session SET recent_auth_at = now() - interval '301 seconds' WHERE id = '${s}'`, db);
    const stale = await marked('poly_app', victim.id, s, (q) => fails(q('SELECT app.set_two_factor_enabled($1)', [false])));
    expect(stale).not.toBeNull();
    expect(msgOf(stale)).not.toMatch(/does not exist/);
  });
});

describe('R1.1/R1.5 identity from the marker, exact call, no marker refused (C12)', () => {
  const definers = ['app.set_two_factor_enabled', 'app.issue_email_challenge', 'app.confirm_email_challenge', 'app.enrolment_grant_live', 'app.second_step_required'];
  for (const role of ROLES) {
    it(`${role}: every POLY-89 definer a login role may call refuses a transaction with no marker (42501) [red if: a definer falls back to a setting or answers anonymously]`, async () => {
      const calls: [string, unknown[] | undefined][] = [
        ['SELECT app.set_two_factor_enabled($1)', [true]], ['SELECT app.issue_email_challenge($1)', ['first_enrolment']],
        ['SELECT app.confirm_email_challenge($1)', ['123456']], ['SELECT app.enrolment_grant_live()', undefined], ['SELECT app.second_step_required()', undefined],
      ];
      expect(calls.length).toBe(definers.length);
      for (const [sql, vals] of calls) {
        const x = await marked(role, null, null, (q) => fails(q(sql, vals)));
        expect(x, sql).not.toBeNull();
        expect(codeOf(x), sql).toBe('42501');
      }
    });
    it(`${role}: a planted set_config('app.user_id') names nobody; the definer still refuses (no current_setting read) [red if: a definer reads current_setting('app.*')]`, async () => {
      const u = await seed({ enrolled: true });
      const x = await marked(role, null, null, async (q) => { await q(`SELECT set_config('app.user_id', $1, true)`, [u.id]); return fails(q('SELECT app.set_two_factor_enabled($1)', [false])); });
      expect(codeOf(x)).toBe('42501');
    });
    it(`${role}: a definer called with an injected suffix (not its exact parameter-bound call) is refused [red if: the enter_* exact-call check is missing on a POLY-89 definer]`, async () => {
      const u = await seed();
      const x = await marked(role, u.id, null, (q) => fails(q(`SELECT app.issue_email_challenge('first_enrolment') WHERE true`)));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    });
  }
  it('catalog: no POLY-89 function body names poly_app or poly_auth, none reads current_setting(\'app.*\'), and every POLY-89 definer is in definers.json [red if: a guard names a role (R1.3) or reads a setting (R1.1)]', () => {
    const names = ['set_two_factor_enabled', 'guard_two_factor_flag', 'stamp_recent_auth', 'guard_recent_auth', 'guard_two_factor', 'guard_passkey', 'refuse_last_method', 'sync_second_step', 'two_factor_consistent', 'require_second_step_for_role', 'require_enrolled_inviter', 'seat_claimed_invitations', 'own_person_exempt', 'second_step_required', 'issue_email_challenge', 'confirm_email_challenge', 'enrolment_grant_live', 'reset_second_step'];
    const rows = must(`SELECT proname, prosrc FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'app' AND proname = ANY(ARRAY[${names.map((x) => `'${x}'`).join(',')}])`, db).rows;
    expect(rows.map((r) => r[0]).sort()).toEqual([...names].sort());
    for (const [name, src] of rows) {
      expect(src, name).not.toMatch(/poly_app|poly_auth/);
      expect(src, name).not.toMatch(/current_setting\s*\(\s*'app\./);
    }
  });
});

describe('C8 email_challenge and enrolment_grant (R2)', () => {
  it('app.email_challenge has the ruled columns, session_id ON DELETE CASCADE NOT NULL, and poly_app can SELECT only the six listed columns [red if: the table is absent or poly_app can read code_hash]', () => {
    const cols = must(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'email_challenge' ORDER BY 1`, db).rows.map((r) => r[0]);
    expect(cols).toEqual(['attempts', 'code_hash', 'created_at', 'expires_at', 'id', 'purpose', 'session_id', 'used_at', 'user_id'].sort());
    expect(must(`SELECT has_column_privilege('poly_app', 'app.email_challenge', 'code_hash', 'SELECT')`, db).rows[0]![0]).toBe('f');
    expect(must(`SELECT has_column_privilege('poly_app', 'app.email_challenge', 'attempts', 'SELECT')`, db).rows[0]![0]).toBe('t');
    expect(must(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'app.email_challenge'::regclass AND contype = 'f' AND confrelid = 'public.session'::regclass`, db).rows[0]![0]).toBe('c');
  });
  it('app.enrolment_grant: session_id ON DELETE SET NULL, consumed_xid recorded, poly_app holds no privilege, one open grant per user [red if: the table is absent or the index is not partial-unique]', () => {
    expect(must(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'app.enrolment_grant'::regclass AND contype = 'f' AND confrelid = 'public.session'::regclass`, db).rows[0]![0]).toBe('n');
    const cols = must(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'enrolment_grant'`, db).rows.map((r) => r[0]);
    for (const c of ['consumed_xid', 'consumed_by', 'stamped_at', 'revoked_at', 'consumed_at']) expect(cols).toContain(c);
    expect(must(`SELECT has_table_privilege('poly_app', 'app.enrolment_grant', 'SELECT,INSERT,UPDATE,DELETE')`, db).rows[0]![0]).toBe('f');
    expect(must(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'enrolment_grant' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%'`, db).rows[0]![0]).toBe('1');
  });
  for (const role of ROLES) {
    it(`${role}: issue_email_challenge needs a marker that carries a session, and a code is six digits, stored hashed, returned once [red if: issue_email_challenge is absent or stores the code]`, async () => {
      const u = await seed();
      must(`INSERT INTO public.session (id, user_id, token, expires_at) VALUES ('${SID}', '${u.id}', 'tkc${n}${Math.random()}', now() + interval '1 day') ON CONFLICT DO NOTHING`, db);
      const code = await marked(role, u.id, SID, async (q) => (await q(`SELECT app.issue_email_challenge('first_enrolment') AS c`)).rows[0].c);
      expect(code).toMatch(/^\d{6}$/);
    });
  }
  it.todo('C8: 3 sends per 15 minutes and 10 wrong entries in 24 hours return NULL indistinguishably from a send (R2); needs the definer to run');
  it.todo('C8: confirm_email_challenge: 5th wrong entry voids the challenge; single use; expired at 10 minutes; a different marker session refuses; a right code mints one grant and revokes the open one');
});

describe('R3 #3/#6/#5 guards on session, passkey, two_factor (C9, C15)', () => {
  for (const role of ROLES) {
    it(`${role}: a session INSERT that names recent_auth_at is refused by the column grant, and one that omits it gets NULL [red if: poly_app can INSERT recent_auth_at or stamp_recent_auth stamps without a grant]`, async () => {
      const u = await seed({ enrolled: true });
      const named = await marked(role, u.id, null, (q) => fails(q(`INSERT INTO public.session (user_id, token, expires_at, recent_auth_at) VALUES ($1, $2, now() + interval '1 day', now())`, [u.id, `tkn${n}${Math.random()}`])));
      expect(codeOf(named)).toBe('42501');
      const row = await marked(role, u.id, null, async (q) => (await q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING recent_auth_at`, [u.id, `tkm${n}${Math.random()}`])).rows[0]);
      expect(row.recent_auth_at).toBeNull();
    });
    it(`${role}: UPDATE OF session.recent_auth_at is refused [red if: guard_recent_auth is absent]`, async () => {
      const u = await seed();
      const s = must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${u.id}', 'tku${n}${Math.random()}', now() + interval '1 day') RETURNING id`, db).rows[0]![0]!;
      const x = await marked(role, u.id, s, (q) => fails(q(`UPDATE public.session SET recent_auth_at = now() WHERE id = $1`, [s])));
      expect(x).not.toBeNull();
    });
    it(`${role}: the unmarked sliding refresh (UPDATE session SET expires_at, updated_at) still commits and never stamps [red if: a session UPDATE guard needs the marker]`, async () => {
      const u = await seed();
      const s = must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${u.id}', 'tkr${n}${Math.random()}', now() + interval '1 day') RETURNING id`, db).rows[0]![0]!;
      const c = new pgmod.Client({ connectionString: url(role, db) });
      await c.connect();
      try {
        await c.query({ text: `UPDATE public.session SET expires_at = now() + interval '2 days', updated_at = now() WHERE id = $1`, values: [s], queryMode: 'extended' });
      } finally { await c.end(); }
      expect(must(`SELECT recent_auth_at IS NULL FROM public.session WHERE id = '${s}'`, db).rows[0]![0]).toBe('t');
    });
    it(`${role}: a verified two_factor row cannot be flipped to unverified, its secret cannot change, and its user_id cannot change [red if: guard_two_factor is absent]`, async () => {
      const u = await seed({ enrolled: true });
      const t = must(`SELECT id FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]!;
      for (const set of [`verified = false`, `secret = 'x'`, `user_id = '${uid(990)}'`]) {
        const x = await marked(role, u.id, null, (q) => fails(q(`UPDATE public.two_factor SET ${set} WHERE id = $1`, [t])));
        expect(x, set).not.toBeNull();
      }
    });
    it(`${role}: an unmarked INSERT into two_factor or passkey is refused; a marked INSERT with no live grant is refused [red if: guard_two_factor / guard_passkey accept it]`, async () => {
      const u = await seed();
      const a = await marked(role, null, null, (q) => fails(q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s','b',$1,false)`, [u.id])));
      expect(a).not.toBeNull();
      const b = await marked(role, u.id, null, (q) => fails(q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s','b',$1,false)`, [u.id])));
      expect(b).not.toBeNull();
      const c = await marked(role, u.id, null, (q) => fails(q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('k',$1,'c${n}',0,'singleDevice',false)`, [u.id])));
      expect(c).not.toBeNull();
    });
    it(`${role}: another user's passkey cannot be deleted or renamed as SQL (the floor beneath BetterAuth's ownership check) [red if: passkey_20_last_method / passkey_10_guard are absent]`, async () => {
      const victim = await seed({ enrolled: true });
      const attacker = await seed({ enrolled: true });
      const p = must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('k','${victim.id}','cv${n}',0,'singleDevice',false) RETURNING id`, db).rows[0]![0]!;
      const del = await marked(role, attacker.id, null, (q) => fails(q('DELETE FROM public.passkey WHERE id = $1', [p])));
      expect(del).not.toBeNull();
      const ren = await marked(role, attacker.id, null, (q) => fails(q(`UPDATE public.passkey SET name = 'z' WHERE id = $1`, [p])));
      expect(ren).not.toBeNull();
    });
    it(`${role}: an unmarked passkey.counter may rise or stay but never go down, and no other passkey column changes (passkey sign-in carve-out, C-a) [red if: guard_passkey lets the counter fall]`, async () => {
      const u = await seed({ enrolled: true });
      const p = must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('k','${u.id}','cc${n}',5,'singleDevice',false) RETURNING id`, db).rows[0]![0]!;
      const run = async (sql: string) => { const c = new pgmod.Client({ connectionString: url(role, db) }); await c.connect(); try { return await fails(c.query({ text: sql, values: [p], queryMode: 'extended' })); } finally { await c.end(); } };
      expect(await run(`UPDATE public.passkey SET counter = 6 WHERE id = $1`)).toBeNull();
      expect(await run(`UPDATE public.passkey SET counter = 6 WHERE id = $1`)).toBeNull();
      expect(await run(`UPDATE public.passkey SET counter = 1 WHERE id = $1`)).not.toBeNull();
      expect(await run(`UPDATE public.passkey SET public_key = 'z' WHERE id = $1`)).not.toBeNull();
    });
  }
});

describe('C-a sign-in under the carve-out (poly_app, 0013 applied)', () => {
  const unmarked = async (role: Role, sql: string, values: unknown[]) => { const c = new pgmod.Client({ connectionString: url(role, db) }); await c.connect(); try { await c.query({ text: sql, values, queryMode: 'extended' }); } finally { await c.end(); } };
  for (const role of ROLES) {
    it(`${role}: a wrong-code lockout (failed_verification_count, locked_until) on a verified two_factor row commits without a marker [red if: guard_two_factor refuses unmarked sign-in writes or two_factor_91_consistent uses the marker]`, async () => {
      const u = await seed({ enrolled: true });
      await unmarked(role, `UPDATE public.two_factor SET failed_verification_count = 5, locked_until = now() + interval '1 minute' WHERE user_id = $1`, [u.id]);
      expect(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('5');
    });
    it(`${role}: an unmarked update of an UNVERIFIED two_factor row, or of its secret, is refused (the carve-out is verified rows only) [red if: the carve-out ignores verified]`, async () => {
      const u = await seed();
      must(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s','b','${u.id}',false)`, db);
      await expect(unmarked(role, `UPDATE public.two_factor SET failed_verification_count = 1 WHERE user_id = $1`, [u.id])).rejects.toBeTruthy();
      const v = await seed({ enrolled: true });
      await expect(unmarked(role, `UPDATE public.two_factor SET secret = 'x' WHERE user_id = $1`, [v.id])).rejects.toBeTruthy();
    });
  }
  it.todo('C-a: a real TOTP sign-in through /sign-in/email for an enrolled user commits as poly_app (drive with the real handler once enrolment fixtures exist; the SQL halves above are red now)');
  it.todo('D1 (a) backup codes off: /two-factor/verify-backup-code and /two-factor/generate-backup-codes are Blocked, and every backup_codes change on a verified row is refused, marked or not');
  it.todo('D1 (b) backup codes kept: an unmarked backup_codes change on a verified row commits (sign-in consumes one); a marked one needs a fresh step-up; SECURITY R-2 states the copy-a-code bypass');
});

describe('C10 last method and the races (R3 #7, R1.6, C-b)', () => {
  for (const role of ROLES) {
    it(`${role}: removing the last factor of a user who holds manager or owner outside the exemption is refused; a viewer's is refused without a fresh step-up [red if: refuse_last_method is absent]`, async () => {
      const owner = await seed({ enrolled: true });
      const ent = await shared(owner.id, `lm${owner.id}${role}`);
      must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${owner.id}', 'owner') ON CONFLICT DO NOTHING`, db);
      const s = must(`INSERT INTO public.session (user_id, token, expires_at, recent_auth_at) VALUES ('${owner.id}', 'tkl${n}${Math.random()}', now() + interval '1 day', now()) RETURNING id`, db).rows[0]![0]!;
      const x = await marked(role, owner.id, s, (q) => fails(q(`DELETE FROM public.two_factor WHERE user_id = $1`, [owner.id])));
      expect(x).not.toBeNull();
      const viewer = await seed({ enrolled: true });
      const y = await marked(role, viewer.id, null, (q) => fails(q(`DELETE FROM public.two_factor WHERE user_id = $1`, [viewer.id])));
      expect(y).not.toBeNull();
    });
  }
  it('the own-Person user with only an exempt Person may remove the last factor after a fresh step-up, and second_step_at clears [red if: refuse_last_method does not call own_person_exempt]', async () => {
    const u = await seed({ enrolled: true });
    const s = must(`INSERT INTO public.session (user_id, token, expires_at, recent_auth_at) VALUES ('${u.id}', 'tke${n}${Math.random()}', now() + interval '1 day', now()) RETURNING id`, db).rows[0]![0]!;
    await marked('poly_app', u.id, s, async (q) => {
      await q(`DELETE FROM public.two_factor WHERE user_id = $1`, [u.id]);
      await q('SELECT app.set_two_factor_enabled($1)', [false]);
      expect((await q(`SELECT second_step_at IS NULL AS c FROM public."user" WHERE id = $1`, [u.id])).rows[0].c).toBe(true);
    });
  });
  it('race 1 (C-b): a last-factor delete racing a first invitation on the own Person: exactly one commits [red if: refuse_last_method does not lock the user row or reads before its lock]', async () => {
    const u = await seed({ enrolled: true });
    const s = must(`INSERT INTO public.session (user_id, token, expires_at, recent_auth_at) VALUES ('${u.id}', 'tkx${n}${Math.random()}', now() + interval '1 day', now()) RETURNING id`, db).rows[0]![0]!;
    const open = async () => { const c = new pgmod.Client({ connectionString: url('poly_app', db) }); await c.connect(); const q = (t: string, v?: unknown[]) => c.query({ text: t, values: v, queryMode: 'extended' }); await q('BEGIN'); await q('SELECT app.enter_asserted_user($1, $2)', [u.id, s]); return { c, q }; };
    const a = await open();
    const b = await open();
    const outcomes: string[] = [];
    try {
      const del = (async () => { await a.q(`DELETE FROM public.two_factor WHERE user_id = $1`, [u.id]); await a.q('SELECT app.set_two_factor_enabled($1)', [false]); })();
      await del.catch((x) => outcomes.push(`a-refused:${msgOf(x)}`));
      const inv = b.q(`INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ($1, 'r1@qa.test', 'manager', $2, decode(repeat('ae', 32), 'hex'), now() + interval '1 day')`, [u.person, u.id]).catch(() => { outcomes.push('b-refused'); });
      await Promise.race([inv, new Promise((r) => setTimeout(r, 1500))]);
      const ca = await fails(a.q('COMMIT'));
      if (ca) outcomes.push('a-commit-refused');
      await inv;
      const cb = await fails(b.q('COMMIT'));
      if (cb) outcomes.push('b-commit-refused');
    } finally { await a.c.end().catch(() => {}); await b.c.end().catch(() => {}); }
    expect(outcomes.join('|')).not.toMatch(/does not exist/);
    // exactly one of the two stays: either the factor is gone and no invitation exists, or the invitation exists and the factor stays
    const factor = Number(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]);
    const invs = Number(must(`SELECT count(*) FROM public.invitation WHERE email = 'r1@qa.test' AND inviter_user_id = '${u.id}'`, db).rows[0]![0]);
    expect(factor === 0 && invs === 0 ? 'a' : factor === 1 && invs === 1 ? 'b' : `both-or-neither:${factor}/${invs}`).toMatch(/^(a|b)$/);
  });
  it.todo('race 2 (C-b): a last-factor delete racing the creation of a non-Person entity: exactly one commits (same two-connection shape as race 1; needs the build\'s lock order)');
});

describe('C6 reset-mfa (R6; seceng C-f)', () => {
  it('app.reset_second_step is EXECUTE poly_operator only and refuses a user marker [red if: the definer is absent or granted to a runtime role]', () => {
    expect(must(`SELECT has_function_privilege('poly_operator', 'app.reset_second_step(text)', 'EXECUTE')`, db).rows[0]![0]).toBe('t');
    for (const r of ['poly_app', 'poly_worker', 'poly_auth'])
      expect(must(`SELECT has_function_privilege('${r}', 'app.reset_second_step(text)', 'EXECUTE')`, db).rows[0]![0]).toBe('f');
  });
  it.todo('C6/C-f: reset_second_step clears factors, sessions, challenges, grants and trust-device verification rows, sets two_factor_enabled false, writes audit second_step.reset (actor operator) and a notification; upper-case email matches; unknown email raises (CLI exit 2); second_step_at clears; next sign-in meets the gate (run as poly_operator through withOperatorTx once the wrapper exists)');
});

describe('R1.4 grants', () => {
  it('no login role has gained UPDATE on user.two_factor_enabled or session.recent_auth_at, and no role has INSERT on session.recent_auth_at [red if: a grant was added instead of a hook]', () => {
    for (const r of ['poly_app', 'poly_auth'])
      for (const [t, c, p] of [['public.user', 'two_factor_enabled', 'UPDATE'], ['public.session', 'recent_auth_at', 'UPDATE'], ['public.session', 'recent_auth_at', 'INSERT']])
        expect(must(`SELECT has_column_privilege('${r}', '${t}', '${c}', '${p}')`, db).rows[0]![0], `${r} ${p} ${t}.${c}`).toBe('f');
  });
  it('two_factor.verified is NOT NULL DEFAULT false [red if: the 0004 default (true) is still in force]', () => {
    const r = must(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'two_factor' AND column_name = 'verified'`, db).rows[0]!;
    expect(r[0]).toBe('NO');
    expect(r[1]).toBe('false');
  });
});
