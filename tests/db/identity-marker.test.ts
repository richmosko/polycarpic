// POLY-147 red gate (ruling 2027afdb): the identity marker, its definers, and the three guards. Every test names, in its title,
// the mutation that turns it red. Raw role sessions are node-pg clients in extended mode, so a definer's own check is what
// answers (not a wrapper). The wrappers (withTenant, withSystem, withContextFreeTx, withOperatorTx, the routing pool) are
// driven through the real packages. Each test builds on its own rolled-back transaction or on unique ids, so none depends
// on another's rows.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloneMigrated, dbEnv } from './helpers/api';
import { DB_PKG, psql, server, url } from './helpers/pg';
import { must } from './helpers/sql';

const pgmod = createRequire(join(DB_PKG, 'package.json'))('pg');
const U = '00000000-0000-4000-8000-0000000147b1';
const V = '00000000-0000-4000-8000-0000000147b2'; // the victim: no test ever enters V through a wrapper
const W = '00000000-0000-4000-8000-0000000147b3';
const S = '00000000-0000-4000-8000-0000000147c1';
const E = '00000000-0000-4000-8000-0000000147e1';
const NOT_ALONE = 'an identity definer must be called on its own';
const HAS_ID = 'this transaction already has an identity';
const FIRST_WRITE = 'the identity marker must be the first write of its transaction';
let db: string;
let dbm: any;
let dba: any;
let dbs: any;
let dbo: any;
let pool: any; // createRoutingPool()

const codeOf = (x: any): string | undefined => x?.code ?? x?.cause?.code;
const msgOf = (x: any): string => String(x?.cause?.message ?? x?.message ?? x);
async function open(role: string | null = null): Promise<any> {
  const c = new pgmod.Client({ connectionString: role ? url(role, db) : server().superUrl.replace(/\/[^/]*$/, `/${db}`) });
  await c.connect();
  return c;
}
/** Always extended: with values or not, so `current_query()` is the statement text the client sent. */
const q = (c: any, text: string, values?: unknown[]) => c.query({ text, values, queryMode: 'extended' });
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (x) { return x as any; } };
const markers = (userId: string) => Number(must(`SELECT count(*) FROM app.tx_identity WHERE user_id = '${userId}'`, db).rows[0]![0]);
const ins = (id: string) => `INSERT INTO public."user" (id, name, email) VALUES ('${id}', 'N', '${id}@qa.test')`;
const uid = () => crypto.randomUUID();
const jobTargets = (body: string) => must(`CREATE OR REPLACE FUNCTION app.job_targets(job text) RETURNS TABLE (entity_id uuid, principal_user_id uuid, connection_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ ${body} $$`, db);

/** Runs `fn` on a client of `role` inside BEGIN ... ROLLBACK. */
async function inTx<T>(role: string | null, fn: (c: any) => Promise<T>): Promise<T> {
  const c = await open(role);
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}

beforeAll(async () => {
  db = cloneMigrated();
  must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${U}', 'U', 'u147@qa.test', true), ('${V}', 'V', 'v147@qa.test', true), ('${W}', 'W', 'w147@qa.test', true)`, db);
  jobTargets(`select '${E}'::uuid, '${U}'::uuid, null::uuid where job = 'qa_job'
    union all select '${E}'::uuid, '${U}'::uuid, null::uuid where job = 'qa_two'
    union all select '${E}'::uuid, '${V}'::uuid, null::uuid where job = 'qa_two'
    union all select '${E}'::uuid, null::uuid, null::uuid where job = 'qa_nullp'`);
  vi.resetModules();
  dbm = await import('../../packages/db/src/index.ts');
  await dbm.close();
  dbm.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
  dba = await import('../../packages/db/src/auth.ts');
  dbs = await import('../../packages/db/src/session.ts');
  dbo = await import('../../packages/db/src/operator.ts');
  const { createRoutingPool } = await import('../../packages/auth/src/routing-pool.ts');
  pool = createRoutingPool();
});
afterAll(async () => { await dbm?.close?.(); await dba?.close?.(); });

const tenant = <T>(id: string, fn: (tx: any) => Promise<T>) => dbm.withTenant(dbs.sessionUserId(id), S, fn);
const system = <T>(job: string, fn: (tx: any) => Promise<T>) => dbm.withSystem(job, { entityId: E, connectionId: null }, fn);
const rows = async (tx: any, text: string) => (await dba.clientOf(tx).query(text)).rows;
const raw = (text: string) => dbm.sql.raw(text);

// ---------------------------------------------------------------- R2: the exact-call check
describe('R2 the exact-call check: an identity definer answers only its own call, and every refusal is 42501 with the exact message', () => {
  const A = (c: any) => q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, S]);
  it('the canonical call succeeds and writes kind web  [red if: the definers are absent]', async () => {
    const r = await inTx('poly_app', async (c) => {
      await A(c);
      return (await q(c, `SELECT user_id::text, kind FROM app.tx_identity WHERE xid = pg_current_xact_id_if_assigned()`)).rows[0];
    });
    expect(r).toEqual({ user_id: V, kind: 'web' });
  });
  const variants: [string, (c: any) => Promise<unknown>][] = [
    ['a second select item beside the call', (c) => q(c, 'SELECT app.enter_asserted_user($1, $2), 1', [V, S])],
    ['the call wrapped in a subselect', (c) => q(c, 'SELECT * FROM (SELECT app.enter_asserted_user($1, $2)) s', [V, S])],
    ['the literal form', (c) => q(c, `SELECT app.enter_asserted_user('${V}', '${S}')`)],
    ['an alias on the result', (c) => q(c, 'SELECT app.enter_asserted_user($1, $2) AS x', [V, S])],
    ['one space fewer after the comma', (c) => q(c, 'SELECT app.enter_asserted_user($1,$2)', [V, S])],
  ];
  for (const [name, run] of variants) {
    it(`asserted_user refuses ${name}, and no marker results  [red if: the exact-call check is missing or loose]`, async () => {
      const before = markers(V);
      const x = await inTx('poly_app', (c) => fails(run(c)));
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(msgOf(x)).toContain(NOT_ALONE);
      expect(markers(V)).toBe(before);
    });
  }
  it('a DO block run by the superuser that switches to poly_app and performs the call is refused  [red if: the check reads anything but the client statement]', async () => {
    const c = await open();
    try {
      await c.query('BEGIN');
      const x = await fails(c.query(`DO $$BEGIN SET LOCAL ROLE poly_app; PERFORM app.enter_asserted_user('${V}', '${S}'); END$$`));
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(msgOf(x)).toContain(NOT_ALONE);
    } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
    expect(markers(V)).toBe(0);
  });
  it('enter_job refuses the same shapes as poly_worker, and its canonical call succeeds (kind system:qa_job)  [red if: enter_job lacks the check]', async () => {
    const ok = await inTx('poly_worker', async (c) => {
      await q(c, 'SELECT app.enter_job($1, $2, $3)', ['qa_job', E, null]);
      return (await q(c, `SELECT user_id::text, kind FROM app.tx_identity WHERE xid = pg_current_xact_id_if_assigned()`)).rows[0];
    });
    expect(ok).toEqual({ user_id: U, kind: 'system:qa_job' });
    for (const run of [
      (c: any) => q(c, 'SELECT app.enter_job($1, $2, $3), 1', ['qa_job', E, null]),
      (c: any) => q(c, `SELECT app.enter_job('qa_job', '${E}', NULL)`),
      (c: any) => q(c, 'SELECT * FROM (SELECT app.enter_job($1, $2, $3)) s', ['qa_job', E, null]),
    ]) {
      const x = await inTx('poly_worker', (c) => fails(run(c)));
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(msgOf(x)).toContain(NOT_ALONE);
    }
  });
  it('enter_new_user refuses the same shapes as poly_app, and its canonical call succeeds after the user insert  [red if: enter_new_user lacks the check]', async () => {
    const id = uid();
    await inTx('poly_app', async (c) => {
      await c.query(ins(id));
      await q(c, 'SELECT app.enter_new_user($1)', [id]);
      expect((await q(c, 'SELECT app.current_user_id()::text AS u')).rows[0].u).toBe(id);
    });
    for (const run of [
      (c: any, i: string) => q(c, 'SELECT app.enter_new_user($1), 1', [i]),
      (c: any, i: string) => q(c, `SELECT app.enter_new_user('${i}')`),
      (c: any, i: string) => q(c, 'SELECT * FROM (SELECT app.enter_new_user($1)) s', [i]),
    ]) {
      const i = uid();
      const x = await inTx('poly_app', async (c) => { await c.query(ins(i)); return fails(run(c, i)); });
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(msgOf(x)).toContain(NOT_ALONE);
    }
  });
  it('a null argument is refused 22004 identity is required, and a bad job name 22023  [red if: the argument checks are missing]', async () => {
    const x = await inTx('poly_app', (c) => fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, null])));
    expect(codeOf(x), msgOf(x)).toBe('22004');
    expect(msgOf(x)).toContain('identity is required');
    const y = await inTx('poly_app', (c) => fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [null, S])));
    expect(codeOf(y)).toBe('22004');
    const z = await inTx('poly_worker', (c) => fails(q(c, 'SELECT app.enter_job($1, $2, $3)', ['Bad-Name', E, null])));
    expect(codeOf(z), msgOf(z)).toBe('22023');
    expect(msgOf(z)).toContain('invalid job name');
  });
});

describe('R2 the query_to_xml route: one fragment on an unmarked path cannot mark a victim and read as them', () => {
  const frag = `SELECT 1 WHERE app.enter_asserted_user('${V}', '${S}') IS NOT NULL AND query_to_xml('SELECT count(*) FROM public.entity', true, false, '') IS NOT NULL`;
  // R11: the built-in's EXECUTE may refuse the fragment before the exact-call check runs, so either message is accepted; no marker either way.
  const either = (x: any) => expect([NOT_ALONE, 'permission denied for function query_to_xml'].some((m) => msgOf(x).includes(m)), msgOf(x)).toBe(true);
  it("through BetterAuth's plain pool (outside any transaction), the fragment is refused and no marker results  [red if: neither the exact-call check nor the R11 revoke exists]", async () => {
    const x = await fails(pool.query(frag));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    either(x);
    expect(markers(V)).toBe(0);
  });
  it('inside withContextFreeTx before any insert, the same refusal  [red if: neither the exact-call check nor the R11 revoke exists]', async () => {
    const x = await fails(dba.withContextFreeTx(async () => { const l = await pool.connect(); try { await l.query(frag); } finally { l.release(); } }));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    either(x);
    expect(markers(V)).toBe(0);
  });
  it('R11: query_to_xml as poly_app is refused 42501 permission denied for function query_to_xml  [red if: the REVOKE from PUBLIC is missing from roles.sql]', async () => {
    const x = await inTx('poly_app', (c) => fails(q(c, `SELECT query_to_xml('SELECT 1', true, false, '')`)));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(msgOf(x)).toContain('permission denied for function query_to_xml');
  });
});

// ---------------------------------------------------------------- the refusals, per criterion (iii) and the interim definer
describe('(iii) every enter_* refuses when a marker already exists; the interim definer refuses an assigned xid', () => {
  it('each definer after a marker: asserted and job say already has an identity, new_user says a user is already in context  [red if: a definer skips the marker-exists check]', async () => {
    const c = await open();
    const attempt = async (setup: (c: any) => Promise<void>, role: string, text: string, values: unknown[]) => {
      await c.query('BEGIN');
      try {
        await setup(c);
        await c.query(`SET LOCAL ROLE ${role}`);
        return await fails(q(c, text, values));
      } finally { await c.query('ROLLBACK'); }
    };
    try {
      const mark = async (cc: any) => { await cc.query(`INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), '${U}', NULL, 'web')`); };
      const a = await attempt(mark, 'poly_app', 'SELECT app.enter_asserted_user($1, $2)', [V, S]);
      expect(codeOf(a), msgOf(a)).toBe('42501');
      expect(msgOf(a)).toContain(HAS_ID);
      const j = await attempt(mark, 'poly_worker', 'SELECT app.enter_job($1, $2, $3)', ['qa_job', E, null]);
      expect(codeOf(j), msgOf(j)).toBe('42501');
      expect(msgOf(j)).toContain(HAS_ID);
      const id = uid();
      const n = await attempt(async (cc) => { await cc.query(ins(id)); await mark(cc); }, 'poly_app', 'SELECT app.enter_new_user($1)', [id]);
      expect(codeOf(n), msgOf(n)).toBe('42501');
      expect(msgOf(n)).toContain('a user is already in context');
    } finally { await c.end(); }
  });
  it('a second enter through the real definers in one transaction: asserted then asserted  [red if: the marker-exists check or the primary key is missing]', async () => {
    const x = await inTx('poly_app', async (c) => { await q(c, 'SELECT app.enter_asserted_user($1, $2)', [U, S]); return fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, S])); });
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(msgOf(x)).toContain(HAS_ID);
  });
  it('INSERT, UPDATE and DELETE on the marker table are refused 42501 for poly_app and poly_worker  [red if: any runtime role holds a write grant]', async () => {
    for (const role of ['poly_app', 'poly_worker']) {
      for (const text of [
        `INSERT INTO app.tx_identity (xid, user_id, kind) VALUES (pg_current_xact_id(), '${V}', 'web')`,
        `UPDATE app.tx_identity SET user_id = '${V}'`,
        'DELETE FROM app.tx_identity',
      ]) {
        const x = await inTx(role, (c) => fails(c.query(text)));
        expect(codeOf(x), `${role}: ${text}`).toBe('42501');
      }
    }
  });
  it('the interim definer refuses after a write: an INSERT first, then enter_asserted_user, is 42501 first-write  [red if: the xid-assigned check is missing]', async () => {
    const id = uid();
    const ctl = await inTx('poly_app', async (c) => { await q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, S]); return 'ok'; });
    expect(ctl).toBe('ok');
    const x = await inTx('poly_app', async (c) => { await c.query(ins(id)); return fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, S])); });
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(msgOf(x)).toContain(FIRST_WRITE);
  });
});

// ---------------------------------------------------------------- guard (ii): the marker is the first statement; savepoints cannot take it
describe('(ii) the marker survives any later savepoint rollback', () => {
  it('a routing-pool BEGIN ... ROLLBACK (a savepoint) after the marker leaves current_user_id() in place  [red if: the marker is written after BEGIN of a savepoint, or the wrapper sends something first]', async () => {
    const got = await tenant(U, async (tx) => {
      const l = await pool.connect();
      try {
        await l.query('BEGIN');
        await l.query('SELECT 1');
        await l.query('ROLLBACK');
        return (await l.query('SELECT app.current_user_id()::text AS u')).rows[0].u;
      } finally { l.release(); }
    });
    expect(got).toBe(U);
  });
  it('a drizzle tx.transaction that throws leaves current_user_id() in place  [red if: the marker is written inside a savepoint]', async () => {
    const got = await tenant(U, async (tx) => {
      await fails(tx.transaction(async (sp: any) => { await sp.execute(raw('SELECT 1')); throw new Error('boom'); }));
      return (await rows(tx, 'SELECT app.current_user_id()::text AS u'))[0].u;
    });
    expect(got).toBe(U);
  });
  it('the marker row is the transaction\'s first write: its xid is the one withTenant\'s first statement assigned  [red if: another statement runs between BEGIN and the marker]', async () => {
    const r = await tenant(U, async (tx) => (await rows(tx, `SELECT (xid = pg_current_xact_id()) AS same, kind FROM app.tx_identity WHERE xid = pg_current_xact_id_if_assigned()`))[0]);
    expect(r).toEqual({ same: true, kind: 'web' });
  });
});

describe('(ii, sign-up) rolling back to BetterAuth\'s savepoint takes the marker and the user, and no later definer can mark anyone', () => {
  const setup = async (c: any, id: string) => {
    await c.query('SAVEPOINT ba_1');
    await c.query(ins(id));
    await q(c, 'SELECT app.enter_new_user($1)', [id]);
    await c.query('ROLLBACK TO SAVEPOINT ba_1');
  };
  it('enter_new_user for that id, and for an existing id, then enter_asserted_user, each 42501 with the ruled message; current_user_id() is null  [red if: the marker or the user row survives the rollback]', async () => {
    const existing = uid();
    must(ins(existing), db);
    const id = uid();
    const a = await inTx('poly_app', async (c) => { await setup(c, id); return fails(q(c, 'SELECT app.enter_new_user($1)', [id])); });
    expect(codeOf(a), msgOf(a)).toBe('42501');
    expect(msgOf(a)).toContain('not a user created by this transaction');
    const b = await inTx('poly_app', async (c) => { await setup(c, uid()); return fails(q(c, 'SELECT app.enter_new_user($1)', [existing])); });
    expect(codeOf(b), msgOf(b)).toBe('42501');
    expect(msgOf(b)).toContain('not a user created by this transaction');
    const d = await inTx('poly_app', async (c) => { await setup(c, uid()); return fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [existing, S])); });
    expect(codeOf(d), msgOf(d)).toBe('42501');
    expect(msgOf(d)).toContain(FIRST_WRITE);
    const n = await inTx('poly_app', async (c) => { await setup(c, uid()); return (await q(c, 'SELECT app.current_user_id()::text AS u')).rows[0].u; });
    expect(n).toBeNull();
  });
  it('with RELEASE instead, the marker stays: a second enter_new_user and enter_asserted_user are refused  [red if: RELEASE drops the marker]', async () => {
    const id = uid();
    const run = async (again: (c: any) => Promise<unknown>) => inTx('poly_app', async (c) => {
      await c.query('SAVEPOINT ba_1'); await c.query(ins(id)); await q(c, 'SELECT app.enter_new_user($1)', [id]); await c.query('RELEASE SAVEPOINT ba_1');
      return fails(again(c));
    });
    const a = await run((c) => q(c, 'SELECT app.enter_new_user($1)', [id]));
    expect(codeOf(a), msgOf(a)).toBe('42501');
    expect(msgOf(a)).toContain('a user is already in context');
    const b = await run((c) => q(c, 'SELECT app.enter_asserted_user($1, $2)', [id, S]));
    expect(codeOf(b), msgOf(b)).toBe('42501');
    expect(msgOf(b)).toContain(HAS_ID);
  });
});

// ---------------------------------------------------------------- the marker table as a reader sees it
describe('K1 readers see only their own transaction\'s row; the read side never assigns an id', () => {
  it('a committed marker is invisible to an unmarked poly_app transaction, a marked one sees one row, and so does a marked worker  [red if: the read policy is USING (true)]', async () => {
    await tenant(W, async () => {}); // commits one marker row
    expect(markers(W)).toBeGreaterThanOrEqual(1);
    const unmarked = await inTx('poly_app', async (c) => Number((await q(c, 'SELECT count(*) AS n FROM app.tx_identity')).rows[0].n));
    expect(unmarked).toBe(0);
    const marked = await tenant(W, async (tx) => Number((await rows(tx, 'SELECT count(*) AS n FROM app.tx_identity'))[0].n));
    expect(marked).toBe(1);
    const worker = await system('qa_job', async (tx) => Number((await rows(tx, 'SELECT count(*) AS n FROM app.tx_identity'))[0].n));
    expect(worker).toBe(1);
  });
  it('BEGIN READ ONLY, a forged setting: current_user_id() is NULL with no error, and no transaction id was assigned  [red if: the body calls pg_current_xact_id(), or reads the setting]', async () => {
    const c = await open('poly_app');
    try {
      await c.query('BEGIN READ ONLY');
      await q(c, `SELECT set_config('app.user_id', '${U}', true)`);
      expect((await q(c, 'SELECT app.current_user_id() IS NULL AS n')).rows[0].n).toBe(true);
      expect((await q(c, 'SELECT pg_current_xact_id_if_assigned() IS NULL AS n')).rows[0].n).toBe(true);
    } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  });
});

// ---------------------------------------------------------------- the wrappers, and each definer's kind
describe('J1/J3 the wrappers write the marker, each definer its own kind', () => {
  it('withTenant kind is web; withSystem kind is system:qa_job with the principal from job_targets  [red if: a wrapper or definer takes the kind from the caller, or withSystem names a user]', async () => {
    expect(await tenant(U, async (tx) => (await rows(tx, `SELECT user_id::text u, session_id::text s, kind FROM app.tx_identity WHERE xid = pg_current_xact_id_if_assigned()`))[0])).toEqual({ u: U, s: S, kind: 'web' });
    expect(await system('qa_job', async (tx) => (await rows(tx, `SELECT user_id::text u, session_id::text s, kind FROM app.tx_identity WHERE xid = pg_current_xact_id_if_assigned()`))[0])).toEqual({ u: U, s: null, kind: 'system:qa_job' });
  });
  it('zero rows, two rows, or a null principal from job_targets is NoPrincipalError and the callback never runs  [red if: enter_job takes the first row, or the P0002 is not rethrown]', async () => {
    for (const job of ['qa_none', 'qa_two', 'qa_nullp']) {
      let ran = false;
      const x = await fails(system(job, async () => { ran = true; }));
      expect(x?.name, `${job}: ${msgOf(x)}`).toBe('NoPrincipalError');
      expect(ran).toBe(false);
    }
  });
  it('the worker can no longer name a user: its only identity entry is enter_job  [red if: poly_worker still holds an enter_* other than enter_job]', async () => {
    const x = await inTx('poly_worker', (c) => fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [U, S])));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(msgOf(x)).toMatch(/permission denied/);
  });
  it('audit_membership labels the actor from the marker kind and ignores a forged app.actor in a marked transaction  [red if: the trigger still reads app.actor first]', () => {
    const seat = (kind: string) => psql(`BEGIN;
      INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), '${U}', NULL, '${kind}');
      SELECT set_config('app.actor', 'forged', true);
      INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ('${E}', (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-147-${kind.replace(/\W/g, '')}', 'business_pass_through') ON CONFLICT DO NOTHING;
      INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${E}', '${W}', 'viewer') ON CONFLICT DO NOTHING;
      SELECT actor FROM public.audit_event WHERE subject_user_id = '${W}' AND kind = 'membership.created'; ROLLBACK;`, db);
    const job = seat('system:qa_job');
    expect(job.ok, job.err).toBe(true);
    expect(job.rows.flat()).toContain('system:qa_job');
    const web = seat('web');
    expect(web.ok, web.err).toBe(true);
    expect(web.rows.flat()).toContain('user');
  });
});

// ---------------------------------------------------------------- S6 and S1: one statement cannot leave the transaction
describe('S6 the commit check, and S1 a statement cannot leave the transaction', () => {
  it('a COMMIT sent through tx.execute makes withTenant reject with IdentityMarkerLost; the next INSERT was refused and current_user_id() read null  [red if: the wrapper does not check the marker before COMMIT]', async () => {
    let afterCommit: unknown = 'not run';
    let insertCode: string | undefined;
    const x = await fails(tenant(U, async (tx) => {
      await tx.execute(raw('COMMIT'));
      afterCommit = (await rows(tx, 'SELECT app.current_user_id()::text AS u'))[0].u;
      insertCode = codeOf(await fails(tx.execute(raw(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-147-s6', 'business_pass_through')`))));
    }));
    expect(x?.name, msgOf(x)).toBe('IdentityMarkerLost');
    expect(msgOf(x)).toContain('the transaction that carried the identity marker has ended');
    expect(afterCommit).toBeNull();
    expect(insertCode).toBe('42501');
    expect(Number(must(`SELECT count(*) FROM public.entity WHERE name = 'qa-147-s6'`, db).rows[0]![0])).toBe(0);
  });
  it('the same for withSystem  [red if: the check is only in withTenant]', async () => {
    const x = await fails(system('qa_job', async (tx) => { await tx.execute(raw('COMMIT')); }));
    expect(x?.name, msgOf(x)).toBe('IdentityMarkerLost');
  });
  it('happy path: nothing is thrown when the transaction that carried the marker commits  [red if: the check compares the wrong id]', async () => {
    await expect(tenant(U, async (tx) => rows(tx, 'SELECT 1'))).resolves.toBeDefined();
    await expect(system('qa_job', async (tx) => rows(tx, 'SELECT 1'))).resolves.toBeDefined();
  });
  it('S1(a) DO $$BEGIN COMMIT; END$$ inside a drizzle savepoint is refused 42501 (no plpgsql for poly_app); the user is still in context afterwards  [red if: poly_app can run DO]', async () => {
    const got = await tenant(U, async (tx) => {
      const x = await fails(tx.transaction(async (sp: any) => { await sp.execute(raw('DO $$BEGIN COMMIT; END$$')); }));
      return { code: codeOf(x), user: (await rows(tx, 'SELECT app.current_user_id()::text AS u'))[0].u };
    });
    expect(got).toEqual({ code: '42501', user: U });
  });
  it('S1(b) PREPARE TRANSACTION is refused, the whole transaction rolls back, nothing is parked, and a later read gets null, never another user  [red if: max_prepared_transactions is raised]', async () => {
    let code: string | undefined;
    let after: unknown = 'not run';
    const x = await fails(tenant(U, async (tx) => {
      code = codeOf(await fails(tx.execute(raw("PREPARE TRANSACTION 'qa_147_x'"))));
      after = (await rows(tx, 'SELECT app.current_user_id()::text AS u'))[0].u;
    }));
    expect(x, 'withTenant must reject').not.toBeNull();
    expect(code, 'observed SQLSTATE of the refused PREPARE (ruling: 55000, unmeasured)').toBe('55000');
    expect(after).toBeNull();
    expect(must('SELECT count(*) FROM pg_prepared_xacts', db).rows[0]![0]).toBe('0');
  });
});

// ---------------------------------------------------------------- K4: the purge
describe('K4 the purge removes old markers of finished transactions and never an in-progress one', () => {
  const old = (user: string) => must(`INSERT INTO app.tx_identity (xid, user_id, kind, created_at) VALUES (pg_current_xact_id(), '${user}', 'web', now() - interval '2 hours')`, db);
  it('a committed marker older than the cut-off is purged, a recent one is kept  [red if: the purge ignores age, or deletes everything]', async () => {
    const X = uid();
    must(`INSERT INTO public."user" (id, name, email) VALUES ('${X}', 'X', '${X}@qa.test')`, db);
    old(X);
    const recent = uid();
    must(`INSERT INTO public."user" (id, name, email) VALUES ('${recent}', 'R', '${recent}@qa.test')`, db);
    must(`INSERT INTO app.tx_identity (xid, user_id, kind) VALUES (pg_current_xact_id(), '${recent}', 'web')`, db);
    expect(markers(X)).toBe(1);
    const c = await open('poly_worker');
    let purged: number;
    try { purged = Number((await q(c, 'SELECT app.purge_tx_identity() AS n')).rows[0].n); } finally { await c.end(); }
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(markers(X)).toBe(0);
    expect(markers(recent)).toBe(1);
  });
  it('a transaction left open past the cut-off keeps its marker through a purge, and a second marker stays impossible  [red if: age alone is enough to delete]', async () => {
    const c = await open();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO app.tx_identity (xid, user_id, kind, created_at) VALUES (pg_current_xact_id(), '${U}', 'web', now() - interval '2 hours')`);
      await c.query('SET LOCAL ROLE poly_worker');
      await q(c, 'SELECT app.purge_tx_identity() AS n');
      await c.query('RESET ROLE');
      expect(Number((await c.query('SELECT count(*) AS n FROM app.tx_identity WHERE xid = pg_current_xact_id()')).rows[0].n)).toBe(1);
      await c.query('SET LOCAL ROLE poly_app');
      const a = await fails(q(c, 'SELECT app.enter_asserted_user($1, $2)', [V, S]));
      expect(codeOf(a), msgOf(a)).toBe('42501');
    } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  });
  it('the purge is callable by poly_worker alone: poly_app is refused 42501  [red if: EXECUTE goes to PUBLIC]', async () => {
    const x = await inTx('poly_app', (c) => fails(q(c, 'SELECT app.purge_tx_identity()')));
    expect(codeOf(x)).toBe('42501');
  });
});

// ---------------------------------------------------------------- guard (i): extended mode on every path
describe('(i) every poly_app and poly_worker query is extended: a two-statement string is refused 42601 on all three paths', () => {
  const two = ['SELECT 1; SELECT 2', 'SELECT 1; COMMIT; BEGIN; SELECT 1'];
  for (const s of two) {
    it(`(a) the wrappers: ${JSON.stringify(s)} through withTenant, withSystem and withOperatorTx  [red if: a pool still sends simple-protocol queries]`, async () => {
      const t = await fails(tenant(U, (tx) => tx.execute(raw(s))));
      expect(codeOf(t), msgOf(t)).toBe('42601');
      const w = await fails(system('qa_job', (tx) => tx.execute(raw(s))));
      expect(codeOf(w), msgOf(w)).toBe('42601');
      const o = await fails(dbo.withOperatorTx((tx: any) => tx.execute(raw(s))));
      expect(codeOf(o), msgOf(o)).toBe('42601');
    });
    it(`(b) the routing-pool handle inside withTenant: ${JSON.stringify(s)} is refused, and after a savepoint rollback the marker is still in place  [red if: the handle sends simple queries]`, async () => {
      const got = await tenant(U, async () => {
        const l = await pool.connect();
        try {
          await l.query('BEGIN');
          const x = await fails(l.query(s));
          await l.query('ROLLBACK');
          return { code: codeOf(x), user: (await l.query('SELECT app.current_user_id()::text AS u')).rows[0].u };
        } finally { l.release(); }
      });
      expect(got).toEqual({ code: '42601', user: U });
    });
    it(`(c) the plain BetterAuth pool, outside any transaction: ${JSON.stringify(s)} is refused through query() and through connect()  [red if: the plain pool sends simple queries]`, async () => {
      const a = await fails(pool.query(s));
      expect(codeOf(a), msgOf(a)).toBe('42601');
      const c = await pool.connect();
      try {
        const b = await fails(c.query(s));
        expect(codeOf(b), msgOf(b)).toBe('42601');
      } finally { c.release(); }
      const d = await fails(dba.authPool().query(s));
      expect(codeOf(d), msgOf(d)).toBe('42601');
    });
  }
});

// ---------------------------------------------------------------- R10: no plpgsql for the runtime roles
describe('R10 poly_app, poly_worker and poly_operator cannot run or define plpgsql', () => {
  for (const role of ['poly_app', 'poly_worker', 'poly_operator']) {
    it(`${role}: DO is refused 42501 permission denied for language plpgsql  [red if: the REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC is missing]`, async () => {
      const x = await inTx(role, (c) => fails(c.query('DO $$BEGIN END$$')));
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(msgOf(x)).toContain('permission denied for language plpgsql');
    });
    it(`${role}: CREATE FUNCTION ... LANGUAGE plpgsql is refused for the language, not for the schema  [red if: a runtime role regains USAGE]`, async () => {
      const c = await open();
      try {
        await c.query('BEGIN');
        await c.query('CREATE SCHEMA qa_lang');
        await c.query(`GRANT CREATE, USAGE ON SCHEMA qa_lang TO ${role}`);
        await c.query(`SET LOCAL ROLE ${role}`);
        const x = await fails(c.query('CREATE FUNCTION qa_lang.f() RETURNS int LANGUAGE plpgsql AS $$BEGIN RETURN 1; END$$'));
        expect(codeOf(x), msgOf(x)).toBe('42501');
        expect(msgOf(x)).toContain('permission denied for language plpgsql');
      } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
    });
  }
});
