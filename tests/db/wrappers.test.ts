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

beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  vi.resetModules();
  Object.assign(process.env, dbEnv('poly_app', db)); // web/worker use the same names with their own user (addendum 1)
  m = await import('../../packages/db/src/index.ts');
  auth = await import('../../packages/db/src/auth.ts');
  session = await import('../../packages/db/src/session.ts');
});
afterAll(async () => { await m?.close?.(); await auth?.close?.(); });

const q = (tx: any, text: string, p?: unknown[]) => tx.query(text, p).then((r: any) => r.rows);

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
    must(`ALTER ROLE poly_app IN DATABASE ${db} SET app.user_id = '${UID}'`);
    try {
      let ran = false;
      await expect(auth.withContextFreeTx(async () => { ran = true; })).rejects.toThrow(/app\.user_id/i);
      expect(ran).toBe(false);
    } finally {
      must(`ALTER ROLE poly_app IN DATABASE ${db} RESET app.user_id`);
    }
  });
});

describe('no nesting: all nine ordered pairs (self-nesting included), each refused with the inner callback never running', () => {
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
  };
  // withSystem needs a resolvable principal to reach its callback: a job target is seeded by the superuser (seed shape
    const kinds = ['tenant', 'system', 'ctxfree'];
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
