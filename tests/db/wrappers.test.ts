// POLY-83 wrapper fixtures (ARCH §3.3, SECURITY C-84, A-3). Assumed surface, reconcile in helpers/api.ts `loadDb`:
//   @poly/db            : withTenant(userId, sessionId, fn), withSystem(job, target, fn), close()
//   @poly/db/auth       : withContextFreeTx(fn)
//   fn receives a tx exposing `query(text, params?) => Promise<{ rows }>`; connection from DATABASE_HOST/PORT/NAME/USER/SSLMODE/PASSWORD_FILE (poly_app).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from './helpers/api';
import { must, psql } from './helpers/pg';

const UID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const SEEDED_JOB = 'qa_job';
const SEEDED_TARGET = { entityId: '33333333-3333-4333-8333-333333333333', connectionId: null };
let db: string;
let m: any;
let auth: any;
let session: any;
let m0: any;
let operator: any;

beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  vi.resetModules();
  m0 = await import('../../packages/db/src/index.ts');
  await m0.close();
  m0.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
  m = await import('../../packages/db/src/index.ts');
  auth = await import('../../packages/db/src/auth.ts');
  session = await import('../../packages/db/src/session.ts');
  operator = await import('../../packages/db/src/operator.ts'); // POLY-142 R3: the fourth wrapper, subpath @poly/db/operator
});
afterAll(async () => { await m?.close?.(); await auth?.close?.(); });

// tx is a drizzle db; clientOf (db/auth) exposes its pg client
const q = (tx: any, text: string, p?: unknown[]) => auth.clientOf(tx).query(text, p).then((r: any) => r.rows);

describe('withTenant', () => {
  it('sets app.user_id and app.session_id transaction-locally (is_local = true)', async () => {
    const got = await m.withTenant(session.sessionUserId(UID), SID, async (tx: any) => ({
      u: (await q(tx, `select current_setting('app.user_id') u`))[0].u,
      s: (await q(tx, `select current_setting('app.session_id') s`))[0].s,
      cu: (await q(tx, `select app.current_user_id()::text cu`))[0].cu,
    }));
    expect(got).toEqual({ u: UID, s: SID, cu: UID });
    // a following transaction on the pool carries nothing: the GUC reads '' (not NULL) and the nullif form gives NULL
    const after = await auth.withContextFreeTx(async (tx: any) => (await q(tx,
      `select coalesce(current_setting('app.user_id', true), '<null>') raw, app.current_user_id() is null as denied`))[0]);
    expect(after.denied).toBe(true);
  });

  it('current_user_id() uses the nullif form: empty string yields NULL, not a cast error', async () => {
    const r = await auth.withContextFreeTx(async (tx: any) => {
      await q(tx, `select set_config('app.user_id', '', true)`);
      return (await q(tx, `select app.current_user_id() is null as n`))[0].n;
    });
    expect(r).toBe(true);
  });

  it('does not run the callback when the userId is not a SessionUserId-shaped uuid', async () => {
    let ran = false;
    await expect(m.withTenant('not-a-uuid', SID, async () => { ran = true; })).rejects.toThrow();
    expect(ran).toBe(false);
  });
});

describe('withSystem', () => {
  it('errors when no principal resolves (M1: job_targets returns zero rows for every job); callback never runs', async () => {
    let ran = false;
    await expect(m.withSystem('no_such_job', { entityId: UID, connectionId: null }, async () => { ran = true; })).rejects.toThrow(/principal|no target|resolve/i);
    expect(ran).toBe(false);
  });
});

describe('withSystem job name', () => {
  it.each(['Bad-Name', '1abc', '', 'a'.repeat(64)])('rejects job %j before touching the database', async (job) => {
    await expect(m.withSystem(job, { entityId: UID, connectionId: null }, async () => {})).rejects.toThrow();
  });
});

describe('app.job_targets', () => {
  it('is executable by poly_worker, refused (42501) for poly_app', () => {
    expect(must(`select count(*) from app.job_targets('no-such-job')`, db, { role: 'poly_worker' }).rows[0][0]).toBe('0');
    const r = psql(`select * from app.job_targets('x')`, db, { role: 'poly_app' });
    expect(r.sqlstate).toBe('42501');
  });
});

describe('withContextFreeTx', () => {
  it('first statement asserts app.user_id is empty: a connection carrying a user id is refused', async () => {
    await auth.close(); // drop pooled backends so the next one is fresh and picks up the role setting
    m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) }); // close() resets the config
    must(`ALTER ROLE poly_app IN DATABASE ${db} SET app.user_id = '${UID}'`);
    try {
      let ran = false;
      await expect(auth.withContextFreeTx(async () => { ran = true; })).rejects.toThrow(/app\.user_id/i);
      expect(ran).toBe(false);
    } finally {
      await auth.close();
      m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
      must(`ALTER ROLE poly_app IN DATABASE ${db} RESET app.user_id`);
    }
  });
});

describe('no nesting: all sixteen ordered pairs (self-nesting included), each refused with the inner callback never running  [POLY-142 C11: red if withOperatorTx is not a fourth Kind in context.ts]', () => {
  // M1's app.job_targets returns zero rows for every job (R4), so withSystem could never reach its callback. The
  // superuser replaces the body in THIS test database only (owner stays poly_authz) so the outer-system pairs run.
  beforeAll(() => {
    must(`CREATE OR REPLACE FUNCTION app.job_targets(job text) RETURNS TABLE (entity_id uuid, principal_user_id uuid, connection_id uuid)
          LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ select '${SEEDED_TARGET.entityId}'::uuid, '${UID}'::uuid, null::uuid $$`, db);
  });
  const w: Record<string, (fn: () => Promise<unknown>) => Promise<unknown>> = {
    tenant: (fn) => m.withTenant(session.sessionUserId(UID), SID, fn),
    system: (fn) => m.withSystem(SEEDED_JOB, SEEDED_TARGET, fn),
    ctxfree: (fn) => auth.withContextFreeTx(fn),
    operator: (fn) => operator.withOperatorTx(fn),
  };
  // withSystem needs a resolvable principal to reach its callback: a job target is seeded by the superuser (seed shape
  const kinds = ['tenant', 'system', 'ctxfree', 'operator'];
  const pairs: [string, string][] = kinds.flatMap((o) => kinds.map((i) => [o, i] as [string, string]));
  for (const [outer, inner] of pairs) {
    it(`${inner} inside ${outer}`, async () => {
      let innerRan = false;
      const p = w[outer](() => w[inner](async () => { innerRan = true; }));
      await expect(p).rejects.toThrow(/nest/i);
      expect(innerRan).toBe(false);
    });
  }
});

// ---------------------------------------------------------------- POLY-142 C11 (O1): withOperatorTx
describe('withOperatorTx (@poly/db/operator)', () => {
  it('runs as poly_worker with app.actor = operator:cli and an empty app.user_id; its handle has no enterNewUser  [red if: wrong pool, a second setting, a user id, or the new-user step leaks onto the handle]', async () => {
    const got = await operator.withOperatorTx(async (tx: any) => ({
      who: (await q(tx, `select current_user as v`))[0].v,
      actor: (await q(tx, `select current_setting('app.actor', true) as v`))[0].v,
      uid: (await q(tx, `select coalesce(current_setting('app.user_id', true), '') as v`))[0].v,
      sess: (await q(tx, `select coalesce(current_setting('app.session_id', true), '') as v`))[0].v,
      step: 'enterNewUser' in tx || typeof tx.enterNewUser === 'function',
    }));
    expect(got).toEqual({ who: 'poly_worker', actor: 'operator:cli', uid: '', sess: '', step: false });
  });
  it('is_local: after commit and after rollback, the next checkout of a max:1 pool reads app.actor and app.user_id empty  [red if: the setting is session-level and rides the backend]', async () => {
    await operator.close();
    m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db), max: 1 });
    try {
      await operator.withOperatorTx(async () => 'ok');
      await expect(operator.withOperatorTx(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      const after = await operator.withOperatorTx(async (tx: any) => (await q(tx, `select coalesce(current_setting('app.user_id', true), '') u`))[0].u);
      expect(after).toBe('');
      const raw = await m.withSystem(SEEDED_JOB, SEEDED_TARGET, async (tx: any) => (await q(tx, `select coalesce(current_setting('app.actor', true), '') a`))[0].a).catch(() => 'n/a');
      expect(raw).not.toBe('operator:cli'); // a later transaction on the same backend carries no operator actor
    } finally {
      await operator.close();
      m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
    }
  });
  it('refuses a connection that carries an app.user_id, the callback never running  [red if: the emptiness assertion is missing]', async () => {
    await operator.close();
    m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
    must(`ALTER ROLE poly_worker IN DATABASE ${db} SET app.user_id = '${UID}'`);
    try {
      let ran = false;
      await expect(operator.withOperatorTx(async () => { ran = true; })).rejects.toThrow(/app\.user_id/i);
      expect(ran).toBe(false);
    } finally {
      await operator.close();
      m.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
      must(`ALTER ROLE poly_worker IN DATABASE ${db} RESET app.user_id`);
    }
  });
  it('no other entry point exports it: @poly/db, /auth, /session, /migrate and /startup have no withOperatorTx  [red if: a re-export is added to any of them]', async () => {
    for (const f of ['index', 'auth', 'session', 'migrate', 'startup']) {
      const x: any = await import(`../../packages/db/src/${f}.ts`);
      expect(Object.keys(x), f).not.toContain('withOperatorTx');
    }
    expect(Object.keys(operator)).toEqual(expect.arrayContaining(['withOperatorTx', 'close']));
  });
});
