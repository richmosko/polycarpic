// POLY-62 (ruling R8): behaviour of the tenancy core as the real login role (poly_app) through the real wrappers. One
// freshDb and one seed per file. Each test names the mutation that turns it red. Roles: O owner, M manager, V viewer of
// entity E; X is an outsider whose own Person is F.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from './helpers/api';
import { crossTenantRows } from './helpers/cross-tenant';
import { checkProbe, activeRows, loadMatrix, runAs, type Actor, type Fixture } from './helpers/matrix';
import { must, psql } from './helpers/pg';
import { ID, seedTenancy, type Seed } from './helpers/tenancy';

const SID = '22222222-2222-4222-8222-222222222222';
let db: string;
let m: any;
let auth: any;
let session: any;
let provisionPerson: (tx: any) => Promise<{ personId: string; created: boolean }>;
let S: Seed;

const q = (tx: any, text: string, p?: unknown[]) => auth.clientOf(tx).query(text, p).then((r: any) => r.rows);
const raw = (tx: any, text: string, p?: unknown[]) => auth.clientOf(tx).query(text, p);
const tenant = (uid: string, fn: (tx: any) => Promise<any>) => m.withTenant(session.sessionUserId(uid), SID, fn);
const free = (fn: (tx: any) => Promise<any>) => auth.withContextFreeTx(fn);
const code = (e: any): string => e?.code ?? e?.cause?.code ?? String(e);
const sqlstate = async (p: Promise<unknown>) => p.then(() => 'no error', code);
const O = ID.owner, M = ID.manager, V = ID.viewer, X = ID.outsider, E = ID.entity;
let F: string;
let n = 0;
const uuid = (tag: number) => `00000000-0000-4000-8000-${String(tag).padStart(12, '0')}`;

/** A scratch Business owned by `owner`, plus optional extra members. Returns its id. */
async function scratch(owner: string, members: [string, string][] = []): Promise<string> {
  const id = uuid(900_000 + ++n);
  await tenant(owner, async (tx) => {
    await q(tx, `INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ($1, (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'S', 'business_c_corp')`, [id]);
    for (const [u, role] of members) await q(tx, `INSERT INTO public.membership (entity_id, user_id, role) VALUES ($1, $2, $3)`, [id, u, role]);
  });
  return id;
}
const newUser = (tag: number) => {
  const id = uuid(800_000 + tag);
  must(`INSERT INTO public."user" (id, name, email) VALUES ('${id}', 'u${tag}', 'u${tag}@qa.test')`, db);
  return id;
};

beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  vi.resetModules();
  const m0 = await import('../../packages/db/src/index.ts');
  await m0.close();
  m0.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db), max: 4 });
  m = await import('../../packages/db/src/index.ts');
  auth = await import('../../packages/db/src/auth.ts');
  session = await import('../../packages/db/src/session.ts');
  ({ provisionPerson } = await import('../../packages/tenancy/src/index.ts'));
  S = await seedTenancy({ db, tenant, q, provisionPerson });
  F = S.otherEntity;
});
afterAll(async () => { await m?.close?.(); await auth?.close?.(); });

describe('cross-tenant isolation on every tenancy table (R4 of POLY-84, per tenant table)', () => {
  // Mutation per table: replace that table's SELECT policy with USING (true) and otherRows becomes > 0.
  const cases: [string, string, { own: string; other: string } | undefined, string, string][] = [
    ['public.entity', 'id', undefined, 'F', 'E'],
    ['public.membership', 'entity_id', undefined, 'F', 'E'],
    ['public.invitation', 'entity_id', undefined, 'F', 'E'],
    ['public.audit_event', 'entity_id', undefined, 'F', 'E'],
    ['public.notification', 'recipient_user_id', { own: X, other: O }, '', ''],
    ['public.entity_type', 'owner_user_id', { own: X, other: O }, '', ''],
  ];
  for (const [table, col, keys] of cases) {
    it(`${table}: X reads none of O's rows and, as a positive control, all of its own`, async () => {
      const k = keys ?? { own: F, other: E };
      const r = await crossTenantRows(tenant, q, table, X, O, col, k);
      expect(r.otherRows, `${table} leaks across tenants`).toBe(0);
      expect(r.ownRows, `positive control on ${table}`).toBeGreaterThan(0);
    });
  }

  it('the superuser sees the other side too, so the zeros above are policy, not an empty seed', () => {
    for (const t of ['entity', 'membership', 'invitation', 'audit_event']) {
      const col = t === 'entity' ? 'id' : 'entity_id';
      expect(Number(must(`SELECT count(*) FROM public.${t} WHERE ${col} = '${E}'`, db).rows[0][0]), t).toBeGreaterThan(0);
    }
  });
});

describe('the authz functions (criterion 4)', () => {
  // Mutation: rank the roles wrongly in has_role (manager >= owner), or return visible_entities without the membership read.
  it('has_role ranks viewer < manager < owner; the outsider holds nothing; visible_entities lists exactly the caller\'s entities', async () => {
    const roles = async (u: string) => tenant(u, async (tx) => (await q(tx, `select app.has_role($1, 'viewer') v, app.has_role($1, 'manager') m, app.has_role($1, 'owner') o`, [E]))[0]);
    expect(await roles(V)).toEqual({ v: true, m: false, o: false });
    expect(await roles(M)).toEqual({ v: true, m: true, o: false });
    expect(await roles(O)).toEqual({ v: true, m: true, o: true });
    expect(await roles(X)).toEqual({ v: false, m: false, o: false });
    const vis = (u: string) => tenant(u, async (tx) => (await q(tx, `select unnest(app.visible_entities())::text e order by 1`)).map((r: any) => r.e));
    expect(await vis(M)).toContain(E);
    expect(await vis(M)).not.toContain(F);
    expect(await vis(X)).toEqual([F]);
    expect(await free(async (tx: any) => (await q(tx, `select app.visible_entities() v`))[0].v), 'no user, no entities').toEqual([]);
  });

  // Mutation: owner_count counts for non-members (a membership-count oracle), or returns 0 instead of null.
  it('owner_count answers members and is null to a non-member', async () => {
    expect(await tenant(O, async (tx) => (await q(tx, `select app.owner_count($1) c`, [E]))[0].c)).toBe(1);
    expect(await tenant(V, async (tx) => (await q(tx, `select app.owner_count($1) c`, [E]))[0].c)).toBe(1);
    expect(await tenant(X, async (tx) => (await q(tx, `select app.owner_count($1) c`, [E]))[0].c)).toBeNull();
  });

  // Mutation: grant EXECUTE on them to PUBLIC, or call them without a user and see them answer.
  it('an unauthenticated transaction gets false from has_role and null from owner_count', async () => {
    expect(await free(async (tx: any) => (await q(tx, `select app.has_role($1, 'viewer') h, app.owner_count($1) c`, [E]))[0])).toEqual({ h: false, c: null });
  });
});

describe('provisionPerson (criterion 1, as amended by ruling R5)', () => {
  // Mutation: drop the idempotency check (second call inserts a second Person), or the self_user_id unique.
  it('twice gives one Person with self_user_id set and one owner membership; created is true then false', async () => {
    const u = newUser(1);
    const first = await tenant(u, (tx) => provisionPerson(tx));
    const second = await tenant(u, (tx) => provisionPerson(tx));
    expect(first.created).toBe(true);
    expect(second).toEqual({ personId: first.personId, created: false });
    const rows = must(`SELECT e.id, e.tax_classification, t.system_key, m.role FROM public.entity e JOIN public.entity_type t ON t.id = e.type_id
      JOIN public.membership m ON m.entity_id = e.id WHERE e.self_user_id = '${u}'`, db).rows;
    expect(rows).toEqual([[first.personId, 'individual', 'person', 'owner']]);
  });

  // Mutation: remove the 42501 raise in seat_creator, or let provisionPerson pass a user id of its own.
  it('with no user set it rejects with 42501 and leaves no entity behind', async () => {
    const before = must(`SELECT count(*) FROM public.entity`, db).rows[0][0];
    expect(await sqlstate(free((tx: any) => provisionPerson(tx)))).toBe('42501');
    expect(must(`SELECT count(*) FROM public.entity`, db).rows[0][0]).toBe(before);
  });

  // Mutation: weaken the entity INSERT WITH CHECK so self_user_id may name another user.
  it('a user cannot forge another user\'s Person (self_user_id = someone else) or a second Person of their own', async () => {
    expect(await sqlstate(tenant(O, (tx) => q(tx, `INSERT INTO public.entity (type_id, name, tax_classification, self_user_id)
      VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), 'forged', 'individual', $1)`, [X])))).toBe('42501');
    expect(await sqlstate(tenant(X, (tx) => q(tx, `INSERT INTO public.entity (type_id, name, tax_classification, self_user_id)
      VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), 'second', 'individual', $1)`, [X])))).toBe('23505');
  });
});

describe('tax classification (criterion 2)', () => {
  const insert = (uid: string, typeKey: string, tax: string | null) => sqlstate(tenant(uid, (tx) => q(tx,
    `INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = $1), 'T', $2)`, [typeKey, tax])));
  const defaulted = (uid: string, typeKey: string) => tenant(uid, async (tx) => {
    const id = uuid(700_000 + ++n);
    await q(tx, `INSERT INTO public.entity (id, type_id, name) VALUES ($1, (SELECT id FROM public.entity_type WHERE system_key = $2), 'D')`, [id, typeKey]);
    return (await q(tx, `SELECT tax_classification t FROM public.entity WHERE id = $1`, [id]))[0].t;
  });

  // Mutation: drop the default branch for parents in check_tax_classification.
  it('a Household and a Holding default to parent_pass_through; a Trust or a Business with no value is refused (23514)', async () => {
    expect(await defaulted(O, 'household')).toBe('parent_pass_through');
    expect(await defaulted(O, 'holding')).toBe('parent_pass_through');
    expect(await insert(O, 'trust', null)).toBe('23514');
    expect(await insert(O, 'business', null)).toBe('23514');
  });

  // Mutation: remove the family check, so any text in the column is accepted.
  it('a value outside the type\'s family is refused (23514) and one inside it is accepted', async () => {
    expect(await insert(O, 'trust', 'business_c_corp')).toBe('23514');
    expect(await insert(O, 'business', 'trust_grantor')).toBe('23514');
    expect(await insert(O, 'business', 'individual')).toBe('23514');
    expect(await insert(O, 'household', 'business_pass_through')).toBe('23514');
    expect(await insert(O, 'trust', 'nonsense')).toBe('23514');
    expect(await insert(O, 'trust', 'trust_grantor')).toBe('no error');
    expect(await insert(O, 'trust', 'trust_non_grantor')).toBe('no error');
    expect(await insert(O, 'business', 'business_c_corp')).toBe('no error');
    expect(await insert(O, 'household', 'parent_joint_filers')).toBe('no error');
  });

  // Mutation: drop the system_key = 'person' requirement on self_user_id.
  it('self_user_id marks a Person only: a Business carrying one is refused (23514)', async () => {
    expect(await sqlstate(tenant(O, (tx) => q(tx, `INSERT INTO public.entity (type_id, name, tax_classification, self_user_id)
      VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'B', 'business_c_corp', $1)`, [O])))).toBe('23514');
  });

  // Mutation: change the entity UPDATE policy to has_role(id, 'manager').
  it('only an owner may change the classification, and the new value is checked against the family on update too', async () => {
    const e = await scratch(O, [[M, 'manager'], [V, 'viewer']]);
    const upd = (uid: string, v: string) => tenant(uid, async (tx) => (await q(tx, `UPDATE public.entity SET tax_classification = $2 WHERE id = $1 RETURNING id`, [e, v])).length);
    expect(await upd(M, 'business_pass_through')).toBe(0);
    expect(await upd(V, 'business_pass_through')).toBe(0);
    expect(await upd(X, 'business_pass_through')).toBe(0);
    expect(await upd(O, 'business_pass_through')).toBe(1);
    expect(await sqlstate(upd(O, 'trust_grantor'))).toBe('23514');
  });
});

describe('tombstone, immutability and keys (criterion 3)', () => {
  // Mutation: drop entity_purged_check, or allow purged_at on a row that still has a name.
  it('purged_at is all-or-nothing with the nulled columns: a named row cannot be purged, a fully nulled row can', () => {
    expect(psql(`UPDATE public.entity SET purged_at = now() WHERE id = '${E}'`, db).sqlstate).toBe('23514');
    const ok = psql(`BEGIN; UPDATE public.entity SET name = NULL, type_id = NULL, tax_classification = NULL, self_user_id = NULL, purged_at = now() WHERE id = '${F}'; ROLLBACK;`, db);
    expect(ok.ok, ok.err).toBe(true);
    expect(psql(`UPDATE public.entity SET name = NULL WHERE id = '${E}'`, db).sqlstate, 'nulling the name without purged_at').toBe('23514');
  });

  // Mutation: GRANT UPDATE on the whole table (or on any listed column) to poly_app.
  it('tenancy and actor columns are not updatable by poly_app, even by an owner of the row (42501)', async () => {
    const attempts: [string, string, unknown[]][] = [
      ['entity', `UPDATE public.entity SET id = gen_random_uuid() WHERE id = $1`, [E]],
      ['entity', `UPDATE public.entity SET type_id = (SELECT id FROM public.entity_type WHERE system_key = 'trust') WHERE id = $1`, [E]],
      ['entity', `UPDATE public.entity SET self_user_id = $2 WHERE id = $1`, [E, O]],
      ['entity', `UPDATE public.entity SET purged_at = now() WHERE id = $1`, [E]],
      ['membership', `UPDATE public.membership SET user_id = $2 WHERE entity_id = $1 AND user_id = $3`, [E, X, V]],
      ['membership', `UPDATE public.membership SET entity_id = $2 WHERE entity_id = $1 AND user_id = $3`, [E, F, V]],
      ['invitation', `UPDATE public.invitation SET inviter_user_id = $2 WHERE entity_id = $1`, [E, X]],
      ['invitation', `UPDATE public.invitation SET entity_id = $2 WHERE entity_id = $1`, [E, F]],
      ['notification', `UPDATE public.notification SET recipient_user_id = $2 WHERE recipient_user_id = $1`, [O, X]],
      ['entity_type', `UPDATE public.entity_type SET owner_user_id = $2 WHERE owner_user_id = $1`, [O, X]],
    ];
    for (const [t, text, p] of attempts) expect(await sqlstate(tenant(O, (tx) => q(tx, text, p))), `${t}: ${text}`).toBe('42501');
  });
});

describe('owners and membership writes (criterion 4, matrix rows)', () => {
  // Mutation: delete the keep_an_owner trigger, or make it count only when role is lowered but not on DELETE.
  it('the last owner can neither be demoted nor removed (23514), by themselves or by anyone else', async () => {
    const e = await scratch(O, [[M, 'manager']]);
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.membership SET role = 'manager' WHERE entity_id = $1 AND user_id = $2`, [e, O])))).toBe('23514');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `DELETE FROM public.membership WHERE entity_id = $1 AND user_id = $2`, [e, O])))).toBe('23514');
    expect(Number(must(`SELECT count(*) FROM public.membership WHERE entity_id = '${e}' AND role = 'owner'`, db).rows[0][0])).toBe(1);
  });

  // Mutation: have keep_an_owner refuse every owner demotion, or skip the owner_count check.
  it('an owner may lower their own role while a second owner exists', async () => {
    const e = await scratch(O, [[M, 'owner']]);
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.membership SET role = 'viewer' WHERE entity_id = $1 AND user_id = $2`, [e, O])))).toBe('no error');
    expect(Number(must(`SELECT count(*) FROM public.membership WHERE entity_id = '${e}' AND role = 'owner'`, db).rows[0][0])).toBe(1);
  });

  // Mutation: drop the `FOR UPDATE` entity row lock from keep_an_owner; both demotions then succeed and the entity has no owner.
  it('two owners demoting each other on two connections at once leave exactly one owner (the entity row lock serialises them)', async () => {
    const e = await scratch(O, [[M, 'owner']]);
    let release!: () => void;
    const started = new Promise<void>((res) => { release = res; });
    const demote = (uid: string, target: string) => tenant(uid, (tx) => q(tx, `UPDATE public.membership SET role = 'viewer' WHERE entity_id = $1 AND user_id = $2`, [e, target]));
    const first = tenant(O, async (tx) => {
      await q(tx, `UPDATE public.membership SET role = 'viewer' WHERE entity_id = $1 AND user_id = $2`, [e, M]);
      release();
      await new Promise((r) => setTimeout(r, 1500));
    }).then(() => 'ok', code);
    await started;
    const second = demote(M, O).then(() => 'ok', code);
    const results = await Promise.all([first, second]);
    expect(Number(must(`SELECT count(*) FROM public.membership WHERE entity_id = '${e}' AND role = 'owner'`, db).rows[0][0]), `results ${results}`).toBe(1);
  });

  // Mutation: widen the membership INSERT policy to has_role(entity_id, 'manager').
  it('a manager cannot add a member, raise a role or remove anyone; a viewer cannot either (42501 or zero rows)', async () => {
    expect(await sqlstate(tenant(M, (tx) => q(tx, `INSERT INTO public.membership (entity_id, user_id, role) VALUES ($1, $2, 'viewer')`, [E, X])))).toBe('42501');
    expect(await tenant(M, async (tx) => (await q(tx, `UPDATE public.membership SET role = 'manager' WHERE entity_id = $1 AND user_id = $2 RETURNING 1`, [E, V])).length)).toBe(0);
    expect(await tenant(V, async (tx) => (await q(tx, `DELETE FROM public.membership WHERE entity_id = $1 AND user_id = $2 RETURNING 1`, [E, V])).length)).toBe(0);
  });

  // Mutation: let the membership SELECT policy read `entity_id = any(visible_entities())` alone (a viewer then lists everyone).
  it('a viewer reads only their own membership row, a manager reads the whole list', async () => {
    expect(await tenant(V, async (tx) => (await q(tx, `SELECT user_id FROM public.membership WHERE entity_id = $1`, [E])).map((r: any) => r.user_id))).toEqual([V]);
    expect(await tenant(M, async (tx) => (await q(tx, `SELECT user_id FROM public.membership WHERE entity_id = $1`, [E])).length)).toBe(3);
  });

  // Mutation: remove the audit_membership trigger or write the wrong kind.
  it('membership changes write membership.created / role_changed / removed audit events attributed to the actor', async () => {
    const e = await scratch(O, [[V, 'viewer']]);
    await tenant(O, async (tx) => {
      await q(tx, `UPDATE public.membership SET role = 'manager' WHERE entity_id = $1 AND user_id = $2`, [e, V]);
      await q(tx, `DELETE FROM public.membership WHERE entity_id = $1 AND user_id = $2`, [e, V]);
    });
    const kinds = must(`SELECT kind, actor_user_id, subject_user_id, actor FROM public.audit_event WHERE entity_id = '${e}' ORDER BY created_at, kind`, db).rows;
    const k = kinds.map((r) => r[0]);
    expect(k.filter((x) => x === 'membership.created')).toHaveLength(2);
    expect(k).toContain('membership.role_changed');
    expect(k).toContain('membership.removed');
    for (const r of kinds) { expect(r[1]).toBe(O); expect(r[3]).toBe('user'); }
    expect(kinds.find((r) => r[0] === 'membership.removed')![2]).toBe(V);
  });
});

describe('append-only and insert-only tables (criterion 5)', () => {
  const owners = (t: string) => Number(must(`SELECT count(*) FROM public.${t}`, db).rows[0][0]);

  // Mutation: GRANT UPDATE or DELETE on audit_event to poly_app, or drop the refuse_change trigger.
  it('audit_event cannot be updated or deleted: poly_app gets 42501 from the grant, a superuser gets 42501 from the trigger', async () => {
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.audit_event SET kind = 'x' WHERE entity_id = $1`, [E])))).toBe('42501');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `DELETE FROM public.audit_event WHERE entity_id = $1`, [E])))).toBe('42501');
    expect(psql(`UPDATE public.audit_event SET kind = 'x'`, db).sqlstate).toBe('42501');
    expect(psql(`DELETE FROM public.audit_event`, db).sqlstate).toBe('42501');
  });

  // Mutation: remove audit_event's INSERT policy for poly_govern, or add an INSERT grant for poly_app.
  it('poly_app cannot write an audit event directly (forged history)', async () => {
    expect(await sqlstate(tenant(O, (tx) => q(tx, `INSERT INTO public.audit_event (entity_id, actor, kind) VALUES ($1, 'user', 'forged')`, [E])))).toBe('42501');
  });

  // Mutation: drop the refuse_truncate trigger from any one of the six.
  it('TRUNCATE is refused (42501) on all six tables, even for a superuser', () => {
    for (const t of ['entity_type', 'entity', 'membership', 'invitation', 'notification', 'audit_event']) {
      expect(psql(`TRUNCATE public.${t} CASCADE`, db).sqlstate, t).toBe('42501');
    }
  });

  // Mutation: grant UPDATE on the whole notification table, or a DELETE policy.
  it('a notification is insert-only except read_at: the recipient may mark it read, nothing else changes, nobody deletes (42501)', async () => {
    expect(await tenant(O, async (tx) => (await q(tx, `UPDATE public.notification SET read_at = now() WHERE recipient_user_id = $1 RETURNING 1`, [O])).length)).toBe(1);
    expect(await tenant(M, async (tx) => (await q(tx, `UPDATE public.notification SET read_at = now() WHERE recipient_user_id = $1 RETURNING 1`, [O])).length), 'another recipient\'s').toBe(0);
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.notification SET kind = 'x' WHERE recipient_user_id = $1`, [O])))).toBe('42501');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.notification SET payload = '{}' WHERE recipient_user_id = $1`, [O])))).toBe('42501');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `DELETE FROM public.notification WHERE recipient_user_id = $1`, [O])))).toBe('42501');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `INSERT INTO public.notification (entity_id, recipient_user_id, kind) VALUES ($1, $2, 'forged')`, [E, M])))).toBe('42501');
  });

  // Mutation: GRANT UPDATE (accepted_at) to poly_app. Acceptance is a definer's job (POLY-89/90).
  it('an invitation can be revoked by an owner but not accepted or changed by poly_app (42501)', async () => {
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.invitation SET accepted_at = now() WHERE entity_id = $1`, [E])))).toBe('42501');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `UPDATE public.invitation SET role = 'owner' WHERE entity_id = $1`, [E])))).toBe('42501');
    expect(await tenant(O, async (tx) => (await q(tx, `UPDATE public.invitation SET revoked_at = now() WHERE entity_id = $1 RETURNING 1`, [E])).length)).toBe(1);
    expect(await tenant(M, async (tx) => (await q(tx, `UPDATE public.invitation SET revoked_at = now() WHERE entity_id = $1 RETURNING 1`, [E])).length), 'a manager').toBe(0);
  });

  // Mutation: GRANT DELETE on entity to poly_app (the purge keeps the row as a tombstone).
  it('no one deletes an entity (42501), and the entity table keeps its rows', async () => {
    const before = owners('entity');
    expect(await sqlstate(tenant(O, (tx) => q(tx, `DELETE FROM public.entity WHERE id = $1`, [E])))).toBe('42501');
    expect(owners('entity')).toBe(before);
  });

  // Mutation: add ON DELETE CASCADE to an audit_event / notification foreign key.
  it('no foreign key from the six tables cascades a delete, so audit rows sit outside any purge', () => {
    const r = must(`SELECT conrelid::regclass::text FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'c'
      AND conrelid IN ('public.entity_type'::regclass, 'public.entity'::regclass, 'public.membership'::regclass,
        'public.invitation'::regclass, 'public.notification'::regclass, 'public.audit_event'::regclass)`, db);
    expect(r.rows).toEqual([]);
  });

  // Mutation: owners-only read becomes members-only (drop the has_role owner branch's strictness).
  it('audit_event is readable by an owner, not by a manager or viewer of the entity, and a user always reads their own acts', async () => {
    const cnt = (u: string, ent: string) => tenant(u, async (tx) => (await q(tx, `SELECT 1 FROM public.audit_event WHERE entity_id = $1`, [ent])).length);
    expect(await cnt(O, E)).toBeGreaterThan(0);
    expect(await cnt(M, E)).toBe(0);
    expect(await cnt(V, E)).toBe(0);
    expect(await cnt(X, E)).toBe(0);
  });
});

describe('workers (ruling R4)', () => {
  // Mutation: GRANT INSERT/UPDATE/DELETE on any of the six to poly_worker, or omit its SELECT policy role.
  it('poly_worker holds SELECT on all six and no write privilege on any', () => {
    for (const t of ['entity_type', 'entity', 'membership', 'invitation', 'notification', 'audit_event']) {
      const p = must(`SELECT ${['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((x) => `has_table_privilege('poly_worker', 'public.${t}', '${x}')`).join(', ')}`, db).rows[0];
      expect(p, t).toEqual(['t', 'f', 'f', 'f']);
    }
  });
});

describe('the §4.2.1 matrix rows for these tables (criterion 6), probed as four actors each', () => {
  // Mutation: any policy that lets a viewer, a manager or the outsider do what the row's cell denies, or denies the owner what it allows.
  it('every active row\'s probes give viewer, manager, owner their cell and the outsider a denial', async () => {
    const { rows } = loadMatrix();
    const { active } = activeRows(db, rows);
    expect(active.length).toBeGreaterThan(0);
    const fx: Fixture = { users: S.users, entity: S.entity, otherEntity: S.otherEntity };
    const bad: string[] = [];
    for (const r of active) {
      expect(r.probe, r.id).not.toBeNull();
      for (const p of r.probe!) bad.push(...(await checkProbe(db, r, p, fx, (a: Actor, sql: string) => runAs(tenant, raw, fx, a, sql))));
    }
    expect(bad).toEqual([]);
  });

  it('the fixture is what the probes assume: E has an owner, a manager, a viewer, an invitation, audit events and notifications; the outsider\'s Person is another entity', () => {
    const c = (sql: string) => Number(must(sql, db).rows[0][0]);
    expect(c(`SELECT count(*) FROM public.membership WHERE entity_id = '${E}'`)).toBe(3);
    expect(c(`SELECT count(*) FROM public.invitation WHERE entity_id = '${E}'`)).toBeGreaterThan(0);
    expect(c(`SELECT count(*) FROM public.audit_event WHERE entity_id = '${E}'`)).toBeGreaterThan(0);
    expect(c(`SELECT count(*) FROM public.notification WHERE entity_id = '${E}'`)).toBe(3);
    expect(F).not.toBe(E);
  });
});
