// POLY-62 ruling R6: the tenancy fixture. Users O, M, V, X are inserted as superuser; every other write goes through the
// real withTenant as poly_app, so the seed is itself a test of the policies. A seed step that fails is a failing test.
import { must } from './pg';

export const ID = {
  owner: '00000000-0000-4000-8000-0000000000a1',
  manager: '00000000-0000-4000-8000-0000000000a2',
  viewer: '00000000-0000-4000-8000-0000000000a3',
  outsider: '00000000-0000-4000-8000-0000000000a4',
  entity: '00000000-0000-4000-8000-0000000000e1',
} as const;

type Ctx = {
  db: string;
  tenant: (uid: string, fn: (tx: any) => Promise<any>) => Promise<any>;
  q: (tx: any, text: string, p?: unknown[]) => Promise<any[]>;
  provisionPerson: (tx: any) => Promise<{ personId: string; created: boolean }>;
};
export type Seed = { users: { owner: string; manager: string; viewer: string; outsider: string }; entity: string; otherEntity: string };

export async function seedTenancy({ db, tenant, q, provisionPerson }: Ctx): Promise<Seed> {
  const u = ID;
  must(`INSERT INTO public."user" (id, name, email) VALUES
    ('${u.owner}', 'O', 'o@qa.test'), ('${u.manager}', 'M', 'm@qa.test'), ('${u.viewer}', 'V', 'v@qa.test'), ('${u.outsider}', 'X', 'x@qa.test')`, db);
  // O creates E (a Business, so the owner can edit a classification); the creator trigger seats O as owner
  await tenant(u.owner, async (tx) => {
    await q(tx, `INSERT INTO public.entity (id, type_id, name, tax_classification)
      VALUES ($1, (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'E', 'business_pass_through')`, [u.entity]);
    await q(tx, `INSERT INTO public.membership (entity_id, user_id, role) VALUES ($1, $2, 'manager'), ($1, $3, 'viewer')`, [u.entity, u.manager, u.viewer]);
    await q(tx, `INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
      VALUES ($1, 'new@qa.test', 'viewer', $2, decode('aa11', 'hex'), now() + interval '1 day')`, [u.entity, u.owner]);
    await q(tx, `INSERT INTO public.entity_type (name, kind, owner_user_id) VALUES ('Club', 'base', $1)`, [u.owner]);
  });
  // X gets its own Person F, an invitation on it and a custom type of its own
  const f = await tenant(u.outsider, async (tx) => {
    const p = await provisionPerson(tx);
    await q(tx, `INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
      VALUES ($1, 'x-new@qa.test', 'viewer', $2, decode('bb22', 'hex'), now() + interval '1 day')`, [p.personId, u.outsider]);
    await q(tx, `INSERT INTO public.entity_type (name, kind, owner_user_id) VALUES ('Lodge', 'base', $1)`, [u.outsider]);
    return p.personId;
  });
  must(`INSERT INTO public.notification (entity_id, recipient_user_id, kind) VALUES
    ('${u.entity}', '${u.owner}', 'qa.seed'), ('${u.entity}', '${u.manager}', 'qa.seed'), ('${u.entity}', '${u.viewer}', 'qa.seed'), ('${f}', '${u.outsider}', 'qa.seed')`, db);
  return { users: { owner: u.owner, manager: u.manager, viewer: u.viewer, outsider: u.outsider }, entity: u.entity, otherEntity: f };
}
