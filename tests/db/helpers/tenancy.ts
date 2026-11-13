// POLY-62 ruling R6: the tenancy fixture. Users O, M, V, X are inserted as superuser. M (manager) and V (viewer) are seated
// as superuser too, because poly_app holds no membership INSERT; their audit rows carry actor 'none' and the seed asserts it.
// Every other write goes through the real withTenant as poly_app, so the seed is itself a test of the policies. poly_app
// may not supply an entity id, so ids are read back by a unique name. A seed step that fails is a failing test.
import { must } from './pg';

export const ID = {
  owner: '00000000-0000-4000-8000-0000000000a1',
  manager: '00000000-0000-4000-8000-0000000000a2',
  viewer: '00000000-0000-4000-8000-0000000000a3',
  outsider: '00000000-0000-4000-8000-0000000000a4',
  owner2: '00000000-0000-4000-8000-0000000000a5',
} as const;

type Ctx = {
  db: string;
  tenant: (uid: string, fn: (tx: any) => Promise<any>) => Promise<any>;
  q: (tx: any, text: string, p?: unknown[]) => Promise<any[]>;
  provisionPerson: (tx: any) => Promise<{ personId: string; created: boolean }>;
};
export type Seed = {
  users: { owner: string; manager: string; viewer: string; outsider: string }; entity: string; otherEntity: string;
  types: { owner: string; outsider: string };
};

export async function seedTenancy({ db, tenant, q, provisionPerson }: Ctx): Promise<Seed> {
  const u = ID;
  must(`INSERT INTO public."user" (id, name, email) VALUES
    ('${u.owner}', 'O', 'o@qa.test'), ('${u.manager}', 'M', 'm@qa.test'), ('${u.viewer}', 'V', 'v@qa.test'), ('${u.outsider}', 'X', 'x@qa.test'), ('${u.owner2}', 'O2', 'o2@qa.test')`, db);
  // O creates E (a Business, so the owner can edit a classification); the creator trigger seats O as owner
  const e = await tenant(u.owner, async (tx) => {
    await q(tx, `INSERT INTO public.entity (type_id, name, tax_classification)
      VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-fixture-E', 'business_pass_through')`);
    const id = (await q(tx, `SELECT id FROM public.entity WHERE name = 'qa-fixture-E'`))[0].id as string;
    await q(tx, `INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
      VALUES ($1, 'new@qa.test', 'viewer', $2, decode(repeat('aa', 32), 'hex'), now() + interval '1 day')`, [id, u.owner]);
    await q(tx, `INSERT INTO public.entity_type (name, kind, owner_user_id) VALUES ('Club', 'base', $1)`, [u.owner]);
    return id;
  });
  must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${e}', '${u.manager}', 'manager'), ('${e}', '${u.viewer}', 'viewer')`, db);
  const seated = must(`SELECT subject_user_id, actor, coalesce(actor_user_id::text, '') FROM public.audit_event WHERE entity_id = '${e}' AND kind = 'membership.created' ORDER BY subject_user_id`, db).rows;
  const want = [[u.owner, 'user', u.owner], [u.manager, 'none', ''], [u.viewer, 'none', '']].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (JSON.stringify(seated) !== JSON.stringify(want)) throw new Error(`fixture audit rows: ${JSON.stringify(seated)} != ${JSON.stringify(want)}`);
  // X gets its own Person F, an invitation on it and a custom type of its own
  const f = await tenant(u.outsider, async (tx) => {
    const p = await provisionPerson(tx);
    await q(tx, `INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
      VALUES ($1, 'x-new@qa.test', 'viewer', $2, decode(repeat('bb', 32), 'hex'), now() + interval '1 day')`, [p.personId, u.outsider]);
    await q(tx, `INSERT INTO public.entity_type (name, kind, owner_user_id) VALUES ('Lodge', 'base', $1)`, [u.outsider]);
    return p.personId;
  });
  must(`INSERT INTO public.notification (entity_id, recipient_user_id, kind) VALUES
    ('${e}', '${u.owner}', 'qa.seed'), ('${e}', '${u.manager}', 'qa.seed'), ('${e}', '${u.viewer}', 'qa.seed'), ('${f}', '${u.outsider}', 'qa.seed')`, db);
  const tid = (name: string) => must(`SELECT id FROM public.entity_type WHERE name = '${name}'`, db).rows[0][0];
  return {
    users: { owner: u.owner, manager: u.manager, viewer: u.viewer, outsider: u.outsider }, entity: e, otherEntity: f,
    types: { owner: tid('Club'), outsider: tid('Lodge') },
  };
}
