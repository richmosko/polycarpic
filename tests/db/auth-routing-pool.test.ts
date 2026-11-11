// POLY-86 criterion 1, 7 (ARCH §8 routing-pool row); ruling R2; seceng S2-S5. Real Postgres, as poly_app.
// Every test names the mutation that turns it red in its title: [red if: ...].
// Not covered here: AuthUnderSystemJob (P4). withSystem needs a seeded job target (job_targets returns no rows today), so
// the pure check lives with the builder's unit test of routing-pool.ts; flagged to the architect for the verdict.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { must } from './helpers/sql';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';
let e: Env;
let pool: any;
const tenant = (u: string, fn: (tx: any) => Promise<any>) => e.dbm.withTenant(e.dbs.sessionUserId(u), S1, fn);
const scratch = () => Number(must('SELECT count(*) FROM public.qa_scratch', e.db).rows[0][0]);
const lease = async () => pool.connect();

beforeAll(async () => {
  e = await boot();
  must(`CREATE TABLE public.qa_scratch (v text); GRANT SELECT, INSERT ON public.qa_scratch TO poly_app;`, e.db);
  const { createRoutingPool } = await import('../../packages/auth/src/routing-pool.ts');
  pool = createRoutingPool();
});
afterAll(() => teardown(e));

describe('inside withTenant', () => {
  it('BetterAuth statements run on the request client: same backend, GUCs visible  [red if: the pool opens its own connection]', async () => {
    await tenant(U1, async (tx) => {
      const outer = (await e.dba.clientOf(tx).query('select pg_backend_pid() p')).rows[0].p;
      const l = await lease();
      const r = (await l.query(`select pg_backend_pid() p, current_setting('app.user_id') u, current_setting('app.session_id') s`)).rows[0];
      expect(r).toEqual({ p: outer, u: U1, s: S1 });
      l.release();
    });
  });

  it('BEGIN/COMMIT become savepoints: the work commits with the outer transaction, not before  [red if: BEGIN passed through (warning, no savepoint) or COMMIT ends the outer tx]', async () => {
    await tenant(U1, async (tx) => {
      const l = await lease();
      await l.query('BEGIN');
      await l.query(`insert into public.qa_scratch values ('kept')`);
      await l.query('COMMIT');
      l.release();
      expect(scratch()).toBe(0); // still uncommitted: the outer transaction owns it
      expect((await e.dba.clientOf(tx).query(`select count(*)::int c from public.qa_scratch`)).rows[0].c).toBe(1);
    });
    expect(scratch()).toBe(1);
  });

  it("ROLLBACK rolls back only BetterAuth's work; the outer transaction stays healthy  [red if: ROLLBACK passes through and aborts the outer tx, or is dropped]", async () => {
    const before = scratch();
    await tenant(U1, async () => {
      const l = await lease();
      await l.query('begin;');
      await l.query(`insert into public.qa_scratch values ('gone')`);
      await l.query('ROLLBACK');
      await l.query(`insert into public.qa_scratch values ('after')`); // would fail on an aborted outer tx
      l.release();
    });
    expect(scratch()).toBe(before + 1);
    expect(must(`SELECT count(*) FROM public.qa_scratch WHERE v = 'gone'`, e.db).rows[0][0]).toBe('0');
  });

  it('nested transactions use one savepoint per depth; a ROLLBACK decrements the depth  [red if: names collide across depths, or ROLLBACK does not decrement the counter (S4)]', async () => {
    const before = scratch();
    await tenant(U1, async () => {
      const l = await lease();
      await l.query('BEGIN');
      await l.query(`insert into public.qa_scratch values ('outer')`);
      await l.query('BEGIN');
      await l.query(`insert into public.qa_scratch values ('inner')`);
      await l.query('ROLLBACK');
      await l.query('BEGIN'); // depth 2 again after the rollback
      await l.query(`insert into public.qa_scratch values ('inner2')`);
      await l.query('COMMIT');
      await l.query('COMMIT');
      l.release();
    });
    expect(scratch()).toBe(before + 2);
    expect(must(`SELECT string_agg(v, ',' ORDER BY v) FROM public.qa_scratch WHERE v LIKE 'inner%' OR v = 'outer'`, e.db).rows[0][0]).toBe('inner2,outer');
  });

  it('a request that fails rolls back everything BetterAuth wrote  [red if: a write escapes the outer transaction]', async () => {
    const before = scratch();
    await expect(tenant(U1, async () => {
      const l = await lease();
      await l.query('BEGIN');
      await l.query(`insert into public.qa_scratch values ('x')`);
      await l.query('COMMIT');
      l.release();
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(scratch()).toBe(before);
  });
});

describe('serialisation (criterion 1)', () => {
  it('two concurrent connect() in one request never interleave: the second resolves only after the first releases  [red if: both leases are handed out at once]', async () => {
    const log: string[] = [];
    await tenant(U1, async () => {
      const a = lease().then(async (l: any) => {
        log.push('a:got');
        await l.query('select pg_sleep(0.3)');
        log.push('a:done');
        l.release();
        log.push('a:released');
      });
      const b = lease().then(async (l: any) => {
        log.push('b:got');
        await l.query('select 1');
        l.release();
      });
      await Promise.all([a, b]);
    });
    expect(log.slice(0, 3)).toEqual(['a:got', 'a:done', 'a:released']);
    expect(log[3]).toBe('b:got');
  });

  it('pool.query() shares the lease queue with connect() (S5)  [red if: pool.query bypasses the queue and runs mid-lease]', async () => {
    const log: string[] = [];
    await tenant(U1, async () => {
      const l = await lease();
      const q = pool.query('select 1').then(() => log.push('pool.query'));
      await new Promise((r) => setTimeout(r, 150));
      log.push('release');
      l.release();
      await q;
    });
    expect(log).toEqual(['release', 'pool.query']);
  });

  it('a wait over 5 s throws RoutingPoolContention and the waiter is cancelled: a late release does not hand it the lease (S5)  [red if: no timeout (deadlock) or the cancelled waiter still receives the lease]', async () => {
    await tenant(U1, async () => {
      const l = await lease();
      await expect(lease()).rejects.toThrow(/RoutingPoolContention|contention/i);
      l.release();
      const again = await lease(); // the queue is clean: the dead waiter did not take the lease
      again.release();
    });
  }, 30_000);
});

describe('outside a transaction', () => {
  it('a plain poly_app pool with no GUC  [red if: it returns a client still carrying app.user_id]', async () => {
    const r = await pool.query(`select coalesce(current_setting('app.user_id', true), '') u, coalesce(current_setting('app.session_id', true), '') s, current_user cu`);
    expect(r.rows[0]).toEqual({ u: '', s: '', cu: 'poly_app' });
  });

  it('P7: a backend that served a withTenant, checked out next on the plain path, reads both GUCs empty  [red if: set_config(.., false) leaks the identity]', async () => {
    await tenant(U2, async () => {});
    for (let i = 0; i < 5; i++) {
      const c = await pool.connect();
      const r = (await c.query(`select coalesce(current_setting('app.user_id', true), '') u, coalesce(current_setting('app.session_id', true), '') s`)).rows[0];
      expect(r).toEqual({ u: '', s: '' });
      c.release();
    }
  });
});

describe('a lease dies with its transaction (S3, P3)', () => {
  it('a timer scheduled inside withTenant that calls connect() after commit rejects and the next tenant sees nothing  [red if: the store is not revoked, so the late write runs on a reused backend]', async () => {
    const before = scratch();
    let late: Promise<unknown> | undefined;
    await tenant(U1, async () => {
      late = new Promise((res, rej) => setTimeout(() => lease().then((l: any) => l.query(`insert into public.qa_scratch values ('late')`)).then(res, rej), 300));
      late.catch(() => {});
    });
    await tenant(U2, async () => { await new Promise((r) => setTimeout(r, 600)); }); // U2 holds a backend while the timer fires
    await expect(late).rejects.toThrow(/TransactionClosed|TransactionEnded|closed|ended/i);
    expect(scratch()).toBe(before);
  });

  it('currentClient() on a dead store throws TransactionEnded, it does not return null  [red if: returns null, silently falling through to the plain pool]', async () => {
    let late: Promise<unknown> | undefined;
    await tenant(U1, async () => {
      late = new Promise((res, rej) => setTimeout(() => { try { res(e.dba.currentClient()); } catch (x) { rej(x); } }, 100));
      late.catch(() => {});
    });
    await expect(late).rejects.toThrow(/TransactionEnded/);
  });

  it('a query on a lease kept past the transaction throws  [red if: the lease still reaches the released client]', async () => {
    let kept: any;
    await tenant(U1, async () => { kept = await lease(); });
    await expect(kept.query('select 1')).rejects.toThrow(/TransactionClosed|closed/i);
  });

  it('currentClient() reports the kind and an opaque client with no release  [red if: AuthClient exposes release (S5)]', async () => {
    expect(e.dba.currentClient()).toBeNull();
    await tenant(U1, async () => {
      const c = e.dba.currentClient();
      expect(c.kind).toBe('withTenant');
      expect('release' in c.client).toBe(false);
      expect(typeof c.client.query).toBe('function');
    });
    await e.dba.withContextFreeTx(async () => { expect(e.dba.currentClient().kind).toBe('withContextFreeTx'); });
  });

  it('pool counts return to their earlier values after a signed-in request and after a failed one  [red if: the routing pool releases or leaks the underlying client (S5)]', async () => {
    const p = e.dba.authPool();
    await tenant(U1, async () => {}); // warm
    const snap = () => ({ total: p.totalCount, idle: p.idleCount });
    const s0 = snap();
    await tenant(U1, async () => { const l = await lease(); await l.query('select 1'); l.release(); });
    expect(snap()).toEqual(s0);
    await expect(tenant(U1, async () => { const l = await lease(); await l.query('select 1'); l.release(); throw new Error('x'); })).rejects.toThrow('x');
    expect(snap()).toEqual(s0);
  });
});

describe('closed statement grammar (S4)', () => {
  const run = (sql: string) => tenant(U1, async () => { const l = await lease(); try { return await l.query(sql); } finally { l.release(); } });

  for (const ok of ['BEGIN', 'begin;', 'START TRANSACTION', 'start transaction;', 'COMMIT', 'commit;', 'END', 'ROLLBACK;', 'rollback'])
    it(`rewrites the bare form ${JSON.stringify(ok)}  [red if: the rewrite table omits it: it reaches Postgres as a real transaction command]`, async () => {
      const opens = /^(begin|start)/i.test(ok);
      const alive = await tenant(U1, async (tx) => {
        const l = await lease();
        if (!opens) await l.query('BEGIN');
        await l.query(ok);
        if (opens) await l.query('ROLLBACK'); // balance the savepoint the opener created
        l.release();
        return (await e.dba.clientOf(tx).query('select 1 x')).rows[0].x; // outer transaction still open and healthy
      });
      expect(alive).toBe(1);
    });

  for (const pass of ['RELEASE SAVEPOINT qa_sp', 'RELEASE qa_sp', 'ROLLBACK TO SAVEPOINT qa_sp', 'ROLLBACK TO qa_sp'])
    it(`passes ${JSON.stringify(pass)} through unchanged  [red if: ROLLBACK TO matches the ROLLBACK rule and is rewritten]`, async () => {
      await tenant(U1, async () => {
        const l = await lease();
        await l.query('SAVEPOINT qa_sp');
        await l.query(pass);
        l.release();
      });
    });

  for (const bad of ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'BEGIN READ ONLY', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'ABORT', 'COMMIT AND CHAIN', 'ROLLBACK AND CHAIN', "PREPARE TRANSACTION 'x'", "COMMIT PREPARED 'x'", 'COMMIT; select 1', 'BEGIN; select 1', 'ROLLBACK; BEGIN'])
    it(`throws on ${JSON.stringify(bad)}  [red if: the grammar is open: the form reaches Postgres or is half-rewritten]`, async () => {
      await expect(run(bad)).rejects.toThrow();
    });
});

describe('a silent rollback is an error (S2, P2)', () => {
  it('a statement fails inside withTenant, the error is caught, fn returns normally: withTenant still rejects  [red if: inTransaction does not check the COMMIT result]', async () => {
    const before = scratch();
    await expect(tenant(U1, async (tx) => {
      const c = e.dba.clientOf(tx);
      await c.query(`insert into public.qa_scratch values ('before-fail')`);
      await c.query('select 1/0').catch(() => {});
      return 'looked fine';
    })).rejects.toThrow(/TransactionAborted|aborted|rolled back/i);
    expect(scratch()).toBe(before);
  });
});
