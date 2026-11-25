// POLY-83 wrapper fixtures (ARCH §3.3, SECURITY C-84, A-3). Assumed surface, reconcile in helpers/api.ts `loadDb`:
//   @poly/db            : withSession(handle, fn), withSystem(job, target, fn), close()
//   @poly/db/auth       : withContextFreeTx(fn)
//   fn receives a tx exposing `query(text, params?) => Promise<{ rows }>`; connection from DATABASE_HOST/PORT/NAME/USER/SSLMODE/PASSWORD_FILE (poly_app).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from './helpers/api';
import { must, psql } from './helpers/pg';
import { handleFor } from './helpers/handle';

const UID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const SEEDED_JOB = 'qa_job';
const SEEDED_TARGET = { entityId: '33333333-3333-4333-8333-333333333333', connectionId: null };
let db: string;
let m: any;
let auth: any;
let m0: any;
let operator: any;

beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  vi.resetModules();
  m0 = await import('../../packages/db/src/index.ts');
  await m0.close();
  m0.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
  m = await import('../../packages/db/src/index.ts');
  auth = await import('../../packages/db/src/auth.ts');
  operator = await import('../../packages/db/src/operator.ts'); // POLY-142 R3: the fourth wrapper, subpath @poly/db/operator
});
afterAll(async () => { await m?.close?.(); await auth?.close?.(); });

// tx is a drizzle db; clientOf (db/auth) exposes its pg client
const q = (tx: any, text: string, p?: unknown[]) => auth.clientOf(tx).query(text, p).then((r: any) => r.rows);

describe('withSession (the tenant entry)', () => {
  it('writes the identity marker for this transaction only: current_user_id() and current_session_id() read it, kind session  [red if: the entry still sets app.user_id, or the marker outlives the transaction]', async () => {
    const got = await m.withSession(handleFor(db, UID, SID), async (tx: any) => ({
      u: (await q(tx, `select app.current_user_id()::text u`))[0].u,
      s: (await q(tx, `select app.current_session_id()::text s`))[0].s,
      k: (await q(tx, `select kind as k from app.tx_identity where xid = pg_current_xact_id_if_assigned()`))[0].k,
      raw: (await q(tx, `select coalesce(current_setting('app.user_id', true), '') raw`))[0].raw,
    }));
    expect(got).toEqual({ u: UID, s: SID, k: 'session', raw: '' });
    // a following transaction on the pool carries nothing
    const after = await auth.withContextFreeTx(async (tx: any) => (await q(tx, `select app.current_user_id() is null as denied`))[0]);
    expect(after.denied).toBe(true);
  });

  it('a forged app.user_id grants nothing: current_user_id() stays NULL  [red if: current_user_id() still reads the setting]', async () => {
    const r = await auth.withContextFreeTx(async (tx: any) => {
      await q(tx, `select set_config('app.user_id', '${UID}', true)`);
      return (await q(tx, `select app.current_user_id() is null as n`))[0].n;
    });
    expect(r).toBe(true);
  });

  it('does not run the callback when the handle is not live', async () => {
    let ran = false;
    await expect(m.withSession('not-a-handle', async () => { ran = true; })).rejects.toThrow();
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
  it('is executable by no runtime role: enter_job is its only caller  [red if: poly_worker keeps EXECUTE on job_targets]', () => {
    for (const role of ['poly_worker', 'poly_app']) {
      const r = psql(`select * from app.job_targets('x')`, db, { role });
      expect(r.sqlstate, role).toBe('42501');
    }
  });
});

describe('withContextFreeTx', () => {
  it('a connection (poly_auth, the context-free kind) carrying a session-level app.user_id is not refused and still reads no identity  [red if: the wrapper still asserts the setting, or current_user_id() reads it]', async () => {
    await auth.close(); // drop pooled backends so the next one is fresh and picks up the role setting
    m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) }); // close() resets the config
    must(`ALTER ROLE poly_auth IN DATABASE ${db} SET app.user_id = '${UID}'`);
    try {
      const got = await auth.withContextFreeTx(async (tx: any) => (await q(tx, `select app.current_user_id() is null as n, coalesce(current_setting('app.user_id', true), '') as raw`))[0]);
      expect(got).toEqual({ n: true, raw: UID });
    } finally {
      await auth.close();
      m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
      must(`ALTER ROLE poly_auth IN DATABASE ${db} RESET app.user_id`);
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
    tenant: (fn) => m.withSession(handleFor(db, UID, SID), fn),
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
  it('runs as poly_operator (POLY-146) with app.actor = operator:cli; it can read no identity and its handle has no enterNewUser  [red if: wrong pool, a second setting, or the new-user step leaks onto the handle]', async () => {
    const got = await operator.withOperatorTx(async (tx: any) => ({
      who: (await q(tx, `select current_user as v`))[0].v,
      actor: (await q(tx, `select current_setting('app.actor', true) as v`))[0].v,
      read: await (async () => { // a savepoint: the refused call must not abort the operator transaction
        await q(tx, 'SAVEPOINT qa_read');
        const code = await q(tx, `select app.current_user_id()::text as v`).then(() => 'read', (x: any) => x.code);
        await q(tx, 'ROLLBACK TO SAVEPOINT qa_read');
        return code;
      })(),
      step: 'enterNewUser' in tx || typeof tx.enterNewUser === 'function',
    }));
    expect(got).toEqual({ who: 'poly_operator', actor: 'operator:cli', read: '42501', step: false });
  });
  it('is_local: after commit and after rollback, the next checkout of a max:1 pool reads no operator actor  [red if: the setting is session-level and rides the backend]', async () => {
    await operator.close();
    m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db), max: 1 });
    try {
      await operator.withOperatorTx(async () => 'ok');
      await expect(operator.withOperatorTx(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      const raw = await m.withSystem(SEEDED_JOB, SEEDED_TARGET, async (tx: any) => (await q(tx, `select coalesce(current_setting('app.actor', true), '') a`))[0].a).catch(() => 'n/a');
      expect(raw).not.toBe('operator:cli'); // a later transaction on the same backend carries no operator actor
    } finally {
      await operator.close();
      m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
    }
  });
  it('a connection carrying an app.user_id is not refused: the setting means nothing to the operator path  [red if: the wrapper still asserts the setting]', async () => {
    await operator.close();
    m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
    must(`ALTER ROLE poly_operator IN DATABASE ${db} SET app.user_id = '${UID}'`);
    try {
      let ran = false;
      await operator.withOperatorTx(async () => { ran = true; });
      expect(ran).toBe(true);
    } finally {
      await operator.close();
      m.configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
      must(`ALTER ROLE poly_operator IN DATABASE ${db} RESET app.user_id`);
    }
  });
  it('no other entry point exports it: @poly/db, /auth, /migrate and /startup have no withOperatorTx  [red if: a re-export is added to any of them]', async () => {
    for (const f of ['index', 'auth', 'migrate', 'startup']) {
      const x: any = await import(`../../packages/db/src/${f}.ts`);
      expect(Object.keys(x), f).not.toContain('withOperatorTx');
    }
    expect(Object.keys(operator)).toEqual(expect.arrayContaining(['withOperatorTx', 'close']));
  });
});

// POLY-160 R5, C20 and C21: a backend that dies under a held transaction is an error to the caller, never the result, and never kills the process.
// [red if: the pool's per-client 'connect' → client.on('error') line is removed: the unhandled 'error' event ends the test process]
describe('a backend lost inside withSession (POLY-160 C20, C21)', () => {
  // the connection is lost at the socket (the backend's restart looks the same to the client); no cluster-wide verb, so this file stays in the parallel project
  const lose = (tx: any) => auth.clientOf(tx).connection.stream.destroy();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const nobody = async () => (await auth.withContextFreeTx(async (tx: any) => (await q(tx, `select app.current_user_id() is null as denied`))[0])).denied;

  it('terminated with no query in flight, before COMMIT: an error, never the result; the next checkout carries no identity', async () => {
    let result: unknown = 'not reached';
    await expect(
      m.withSession(handleFor(db, UID, SID), async (tx: any) => {
        lose(tx);
        await sleep(300); // the client's own 'error' event arrives while the callback holds it
        result = 'RESULT';
        return result;
      }),
    ).rejects.toBeDefined();
    expect(await nobody()).toBe(true);
    // and the pool is usable again
    const ok = await m.withSession(handleFor(db, UID, SID), async (tx: any) => (await q(tx, `select 1 as n`))[0].n);
    expect(ok).toBe(1);
  });

  it('terminated during a query: that query rejects, the wrapper rejects, the next checkout carries no identity', async () => {
    let held: any;
    const running = m.withSession(handleFor(db, UID, SID), async (tx: any) => {
      held = tx;
      return q(tx, `select pg_sleep(5)`);
    });
    for (let i = 0; i < 50 && !held; i++) await sleep(20);
    await sleep(200);
    lose(held);
    await expect(running).rejects.toBeDefined();
    expect(await nobody()).toBe(true);
  });
});
