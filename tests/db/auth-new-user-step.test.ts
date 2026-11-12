// POLY-87 gate 2: the new-user step, app.enter_new_user (ruling R2, R4; conditions 5, 12-14; SECURITY C-84, T-90). The
// database side is driven as poly_app over psql (one script = one transaction), because the TypeScript refusals (R4) are
// layered on top of the definer and the definer decides. Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { must, psql } from './helpers/pg';

let e: Env;
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

const app = (sql: string) => psql(sql, e.db, { role: 'poly_app' });
const uid = () => crypto.randomUUID();
const ins = (id: string, email = `${id}@qa.test`) => `INSERT INTO public."user" (id, name, email) VALUES ('${id}', 'N', '${email}');`;
const step = (id: string) => `SELECT app.enter_new_user('${id}');`;

describe('condition 5: after the step, app.user_id is the new id until the end of the transaction', () => {
  it('insert, enter_new_user, then current_setting reads the id; the step works as poly_app  [red if: the function is absent, or does not set the setting for the transaction]', () => {
    const id = uid();
    const r = app(`BEGIN; ${ins(id)} ${step(id)} SELECT current_setting('app.user_id'); SELECT app.current_user_id()::text; ROLLBACK;`);
    expect(r.ok, r.err).toBe(true);
    expect(r.rows.filter((x) => x[0] === id).length).toBeGreaterThanOrEqual(2);
  });
});

describe('condition 13: enter_new_user refuses (each on its own transaction), with 42501', () => {
  const ctl = () => { // positive control: a fresh user passes, so every refusal below is about its input
    const id = uid();
    const r = app(`BEGIN; ${ins(id)} ${step(id)} ROLLBACK;`);
    expect(r.ok, `control: ${r.err}`).toBe(true);
  };
  it('an existing user (inserted by an earlier transaction)  [red if: any user id is accepted]', () => {
    ctl();
    const id = uid();
    must(ins(id), e.db);
    expect(app(`BEGIN; ${step(id)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('an existing user whose row this transaction UPDATEd (its xmin is ours; signup_txid is not)  [red if: the proof is xmin, not the stamp]', () => {
    ctl();
    const id = uid();
    must(ins(id), e.db);
    expect(app(`BEGIN; UPDATE public."user" SET name = 'changed' WHERE id = '${id}'; ${step(id)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('a second call in the same transaction  [red if: the empty-app.user_id check is missing]', () => {
    ctl();
    const id = uid();
    expect(app(`BEGIN; ${ins(id)} ${step(id)} ${step(id)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('an id whose insert was rolled back to a savepoint  [red if: the lookup survives a savepoint rollback]', () => {
    ctl();
    const id = uid();
    expect(app(`BEGIN; SAVEPOINT s; ${ins(id)} ROLLBACK TO s; ${step(id)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('a user inserted inside a RELEASED savepoint is accepted (BetterAuth inserts in a savepoint)  [red if: the proof uses xmin, a subtransaction id]', () => {
    const id = uid();
    const r = app(`BEGIN; SAVEPOINT s; ${ins(id)} RELEASE s; ${step(id)} SELECT current_setting('app.user_id'); ROLLBACK;`);
    expect(r.ok, r.err).toBe(true);
  });
  it('a user that already has a Person is refused even when the stamp matches  [red if: the self_user_id check is missing]', () => {
    const id = uid();
    const r = app(`BEGIN; ${ins(id)} ${step(id)}
      INSERT INTO public.entity (type_id, name, self_user_id) SELECT t.id, 'P', '${id}' FROM public.entity_type t WHERE t.system_key = 'person';
      SELECT set_config('app.user_id', '', true); ${step(id)} ROLLBACK;`);
    expect(r.sqlstate).toBe('42501');
  });
  it('a later transaction cannot enter a user an earlier one inserted  [red if: the stamp is compared to anything but the current transaction id]', () => {
    const id = uid();
    must(ins(id), e.db);
    expect(app(`BEGIN; ${step(id)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('app.user_id forged to an existing user, then a new user stepped, is refused as a second entry  [red if: the step ignores a non-empty app.user_id]', () => {
    const old = uid();
    const fresh = uid();
    must(ins(old), e.db);
    expect(app(`BEGIN; SELECT set_config('app.user_id', '${old}', true); ${ins(fresh)} ${step(fresh)} ROLLBACK;`).sqlstate).toBe('42501');
  });
  it('a poly_app INSERT or UPDATE that supplies signup_txid is refused 42501, and so is a second user insert in one transaction  [red if: the column is grantable or the stamp trigger allows two users]', () => {
    const a = uid();
    const b = uid();
    expect(app(`INSERT INTO public."user" (id, name, email, signup_txid) VALUES ('${a}', 'N', '${a}@qa.test', 1)`).sqlstate).toBe('42501');
    must(ins(b), e.db);
    expect(app(`UPDATE public."user" SET signup_txid = 1 WHERE id = '${b}'`).sqlstate).toBe('42501');
    expect(app(`BEGIN; ${ins(uid())} ${ins(uid())} ROLLBACK;`).sqlstate).toBe('42501');
  });
});

// ---------------------------------------------------------------- the TypeScript side (R4): the handle, not the index
// ASSUMED surface (R4): inside @poly/db/auth's withContextFreeTx the Tx has a non-enumerable enterNewUser(id) -> Promise<void>.
// Every case below rolls back with a sentinel, so no stamped row is committed (C32).
class Rollback extends Error {}
const inCtxFree = async (fn: (tx: any) => Promise<void>): Promise<unknown> => {
  try {
    await e.dba.withContextFreeTx(async (tx: any) => { await fn(tx); throw new Rollback(); });
  } catch (x) { return x; }
  return undefined;
};
const insTx = (tx: any, id: string) => tx.execute(e.dbm.sql`INSERT INTO public."user" (id, name, email) VALUES (${id}, 'N', ${`${id}@qa.test`})`);
const refused = (x: unknown) => expect((x as { code?: string; cause?: { code?: string } })?.code ?? (x as any)?.cause?.code).toBe('42501');

describe('condition 13 (handle): the step is reachable from withContextFreeTx\'s handle only, and the TypeScript side refuses too', () => {
  it('a fresh user steps and app.user_id is the new id  [red if: the handle has no enterNewUser]', async () => {
    const id = uid();
    let seen = '';
    const x = await inCtxFree(async (tx) => {
      await insTx(tx, id);
      await tx.enterNewUser(id);
      seen = (await tx.execute(e.dbm.sql`SELECT current_setting('app.user_id') AS v`)).rows[0].v;
    });
    expect(x).toBeInstanceOf(Rollback);
    expect(seen).toBe(id);
  });
  it('enterNewUser is not enumerable on the handle  [red if: the step shows up in Object.keys or a spread of the Tx]', async () => {
    let keys: string[] = [];
    let has = false;
    await inCtxFree(async (tx) => { keys = Object.keys(tx); has = typeof tx.enterNewUser === 'function'; });
    expect(has).toBe(true);
    expect(keys).not.toContain('enterNewUser');
  });
  it('a second call is refused  [red if: the used flag and the database check are both missing]', async () => {
    const id = uid();
    let first: unknown = 'not run';
    let second: unknown;
    await inCtxFree(async (tx) => {
      await insTx(tx, id);
      first = await tx.enterNewUser(id).then(() => 'ok', (x: unknown) => x);
      second = await tx.enterNewUser(id).then(() => 'ok', (x: unknown) => x);
    });
    expect(first).toBe('ok');
    expect(second).not.toBe('ok');
  });
  it('an existing user\'s id is refused with 42501  [red if: any id is accepted]', async () => {
    const old = uid();
    must(ins(old), e.db);
    let r: unknown = 'ok';
    await inCtxFree(async (tx) => { r = await tx.enterNewUser(old).then(() => 'ok', (x: unknown) => x); });
    refused(r);
  });
  it('a call after the transaction ended is refused  [red if: the closure outlives its transaction]', async () => {
    let kept: any;
    await inCtxFree(async (tx) => { kept = tx; });
    const r = await kept.enterNewUser(uid()).then(() => 'ok', (x: unknown) => x);
    expect(r).not.toBe('ok');
  });
  it('an id whose insert was rolled back to a savepoint is refused  [red if: the TypeScript side trusts a remembered id]', async () => {
    const id = uid();
    let r: unknown = 'ok';
    await inCtxFree(async (tx) => {
      await tx.execute(e.dbm.sql`SAVEPOINT s`);
      await insTx(tx, id);
      await tx.execute(e.dbm.sql`ROLLBACK TO s`);
      r = await tx.enterNewUser(id).then(() => 'ok', (x: unknown) => x);
    });
    refused(r);
  });
});

describe('condition 14: the step is not on the db index, db/auth or db/session, nor on withTenant\'s Tx', () => {
  const surfaces: Record<string, string> = {
    '@poly/db': '../../packages/db/src/index.ts',
    '@poly/db/auth': '../../packages/db/src/auth.ts',
    '@poly/db/session': '../../packages/db/src/session.ts',
  };
  for (const [name, path] of Object.entries(surfaces))
    it(`${name}: no export is named like the step and no exported function's source calls enter_new_user  [red if: the step is exported from the index]`, async () => {
      const m: Record<string, unknown> = await import(/* @vite-ignore */ path);
      expect(Object.keys(m).filter((k) => /enter.?new.?user|newuser/i.test(k))).toEqual([]);
      for (const [k, v] of Object.entries(m))
        if (typeof v === 'function') expect(String(v), `${name}.${k}`).not.toMatch(/enter_new_user|enterNewUser/);
    });
  it('a withTenant Tx has no enterNewUser  [red if: the step is attached to every Tx, not to the context-free kind]', async () => {
    const u = must(`INSERT INTO public."user" (name, email) VALUES ('T', 't-${uid()}@qa.test') RETURNING id`, e.db).rows[0]![0]!;
    const has = await e.dbm.withTenant(e.dbs.sessionUserId(u), '00000000-0000-4000-8000-0000000000e2', async (tx: any) => 'enterNewUser' in tx || typeof tx.enterNewUser !== 'undefined');
    expect(has).toBe(false);
    // control, so this cannot pass on a missing step everywhere: the context-free handle has it
    let ctlHas = false;
    await inCtxFree(async (tx) => { ctlHas = typeof tx.enterNewUser === 'function'; });
    expect(ctlHas).toBe(true);
  });
});
