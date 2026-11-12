// POLY-87 gate 2: the new-user step, app.enter_new_user (ruling R2, R4; conditions 5, 12-14; SECURITY C-84, T-90). The
// database side is driven as poly_app over psql (one script = one transaction), because the TypeScript refusals (R4) are
// layered on top of the definer and the definer decides. Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { psql } from './helpers/pg';

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
    const r = app(`BEGIN; ${ins(id)} ${step(id)} SELECT current_setting('app.user_id'); SELECT app.current_user_id()::text; COMMIT;`);
    expect(r.ok, r.err).toBe(true);
    expect(r.rows.filter((x) => x[0] === id).length).toBeGreaterThanOrEqual(2);
  });
});

describe('condition 13: enter_new_user refuses (each on its own transaction), with 42501', () => {
  const ctl = () => { // positive control: a fresh user passes, so every refusal below is about its input
    const id = uid();
    const r = app(`BEGIN; ${ins(id)} ${step(id)} COMMIT;`);
    expect(r.ok, `control: ${r.err}`).toBe(true);
  };
  it('an existing user (inserted by an earlier transaction)  [red if: any user id is accepted]', () => {
    ctl();
    const id = uid();
    expect(app(ins(id)).ok).toBe(true);
    expect(app(`BEGIN; ${step(id)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('an existing user whose row this transaction UPDATEd (its xmin is ours; signup_txid is not)  [red if: the proof is xmin, not the stamp]', () => {
    ctl();
    const id = uid();
    expect(app(ins(id)).ok).toBe(true);
    expect(app(`BEGIN; UPDATE public."user" SET name = 'changed' WHERE id = '${id}'; ${step(id)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('a second call in the same transaction  [red if: the empty-app.user_id check is missing]', () => {
    ctl();
    const id = uid();
    expect(app(`BEGIN; ${ins(id)} ${step(id)} ${step(id)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('an id whose insert was rolled back to a savepoint  [red if: the lookup survives a savepoint rollback]', () => {
    ctl();
    const id = uid();
    expect(app(`BEGIN; SAVEPOINT s; ${ins(id)} ROLLBACK TO s; ${step(id)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('a user inserted inside a RELEASED savepoint is accepted (BetterAuth inserts in a savepoint)  [red if: the proof uses xmin, a subtransaction id]', () => {
    const id = uid();
    const r = app(`BEGIN; SAVEPOINT s; ${ins(id)} RELEASE s; ${step(id)} SELECT current_setting('app.user_id'); COMMIT;`);
    expect(r.ok, r.err).toBe(true);
  });
  it('a user that already has a Person is refused even when the stamp matches  [red if: the self_user_id check is missing]', () => {
    const id = uid();
    const r = app(`BEGIN; ${ins(id)} ${step(id)}
      INSERT INTO public.entity (type_id, name, self_user_id) SELECT t.id, 'P', '${id}' FROM public.entity_type t WHERE t.system_key = 'person';
      SELECT set_config('app.user_id', '', true); ${step(id)} COMMIT;`);
    expect(r.sqlstate).toBe('42501');
  });
  it('a later transaction cannot enter a user an earlier one inserted  [red if: the stamp is compared to anything but the current transaction id]', () => {
    const id = uid();
    expect(app(`BEGIN; ${ins(id)} COMMIT;`).ok).toBe(true);
    expect(app(`BEGIN; ${step(id)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('app.user_id forged to an existing user, then a new user stepped, is refused as a second entry  [red if: the step ignores a non-empty app.user_id]', () => {
    const old = uid();
    const fresh = uid();
    expect(app(ins(old)).ok).toBe(true);
    expect(app(`BEGIN; SELECT set_config('app.user_id', '${old}', true); ${ins(fresh)} ${step(fresh)} COMMIT;`).sqlstate).toBe('42501');
  });
  it('a poly_app INSERT or UPDATE that supplies signup_txid is refused 42501, and so is a second user insert in one transaction  [red if: the column is grantable or the stamp trigger allows two users]', () => {
    const a = uid();
    const b = uid();
    expect(app(`INSERT INTO public."user" (id, name, email, signup_txid) VALUES ('${a}', 'N', '${a}@qa.test', 1)`).sqlstate).toBe('42501');
    expect(app(ins(b)).ok).toBe(true);
    expect(app(`UPDATE public."user" SET signup_txid = 1 WHERE id = '${b}'`).sqlstate).toBe('42501');
    expect(app(`BEGIN; ${ins(uid())} ${ins(uid())} COMMIT;`).sqlstate).toBe('42501');
  });
});
