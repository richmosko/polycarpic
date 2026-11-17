// POLY-152 R3, seceng B3: app.provision_person(). The Person insert is the definer's, poly_auth holds no tenancy write. Each refusal
// asserts entity and membership counts unchanged (a permission error and a guard refusal are both 42501). Red today: no definer.
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { count, signUpEntry, snapshot, tx } from './helpers/auth-tx';
import { codeOf, fails, msgOf } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
beforeAll(() => { db = cloneMigrated(); });
const uid = () => crypto.randomUUID();
const TENANCY = `SELECT (SELECT count(*) FROM public.entity), (SELECT count(*) FROM public.membership)`;
const PROV = 'SELECT app.provision_person()';

describe('R3 the exact call, in a sign-up transaction', () => {
  it('provisions the Person: type person, name from user.name, self_user_id the new user, owner membership seated [red if: the definer is absent]', async () => {
    const id = uid();
    await tx(db, 'poly_auth', async (q) => {
      await signUpEntry(q, id, `${id}@qa.test`, 'Ada Lovelace');
      const r = await q(PROV);
      expect(r.rows[0].provision_person).toMatch(/^[0-9a-f-]{36}$/);
    }, true);
    expect(must(`SELECT e.name, t.system_key, e.self_user_id::text, m.role FROM public.entity e JOIN public.entity_type t ON t.id = e.type_id JOIN public.membership m ON m.entity_id = e.id AND m.user_id = e.self_user_id WHERE e.self_user_id = '${id}'`, db).rows[0])
      .toEqual(['Ada Lovelace', 'person', id, 'owner']);
  });
  it('a forced failure after the Person rolls back the user, the Person and the membership [red if: the Person commits on its own]', async () => {
    const id = uid();
    const x = await tx(db, 'poly_auth', async (q) => { await signUpEntry(q, id); await q(PROV); return fails(q('SELECT 1/0')); }, true);
    expect(x).not.toBeNull();
    expect(count(db, `SELECT 1 FROM public."user" WHERE id = '${id}'`)).toBe(0);
    expect(count(db, `SELECT 1 FROM public.entity WHERE self_user_id = '${id}'`)).toBe(0);
  });
});

describe('B3 refusals, each leaving entity and membership unchanged', () => {
  const refused = async (run: () => Promise<any>) => {
    const before = snapshot(db, TENANCY);
    const x = await run();
    expect(x, 'must be refused').not.toBeNull();
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(snapshot(db, TENANCY)).toBe(before);
  };
  it('not the exact call: a second select item, a subquery, a CTE [red if: the exact-call check is absent]', async () => {
    for (const sql of ['SELECT app.provision_person(), 1', 'SELECT * FROM (SELECT app.provision_person()) s', 'WITH x AS (SELECT app.provision_person()) SELECT * FROM x'])
      await refused(() => tx(db, 'poly_auth', async (q) => { await signUpEntry(q, uid()); return fails(q(sql)); }));
  });
  it('a second call in one sign-up [red if: the no-existing-Person check is absent]', async () => {
    await refused(() => tx(db, 'poly_auth', async (q) => { await signUpEntry(q, uid()); await q(PROV); return fails(q(PROV)); }));
  });
  it('under an auth marker (a user not created by this transaction) [red if: the kind or the signup_txid check is absent]', async () => {
    const u = uid();
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${u}', 'X', '${u}@qa.test', true)`, db);
    const tok = `t-${u}`;
    must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${u}', '${tok}', now() + interval '1 day')`, db);
    await refused(() => tx(db, 'poly_auth', async (q) => { await q('SELECT app.enter_auth_session($1)', [tok]); return fails(q(PROV)); }));
  });
  it('under a web marker (poly_app) and with no marker at all [red if: provision_person is callable outside a sign-up]', async () => {
    const u = uid();
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${u}', 'X', '${u}@qa.test', true)`, db);
    await refused(() => tx(db, 'poly_auth', (q) => fails(q(PROV))));
    await refused(() => tx(db, 'poly_app', async (q) => { await q('SELECT app.enter_asserted_user($1, $2)', [u, crypto.randomUUID()]); return fails(q(PROV)); }));
  });
  it('poly_worker and poly_operator hold no EXECUTE [red if: granted]', async () => {
    for (const role of ['poly_worker', 'poly_operator']) await refused(() => tx(db, role, (q) => fails(q(PROV))));
  });
});

describe('C3 poly_auth holds no tenancy write', () => {
  it('a direct INSERT INTO entity as poly_auth in a sign-up is refused by permission, nothing written [red if: poly_auth holds INSERT on entity]', async () => {
    const before = snapshot(db, TENANCY);
    const x = await tx(db, 'poly_auth', async (q) => {
      await signUpEntry(q, uid());
      return fails(q(`INSERT INTO public.entity (type_id, name, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), 'P', app.current_user_id())`));
    });
    expect(codeOf(x)).toBe('42501');
    expect(snapshot(db, TENANCY)).toBe(before);
  });
});
