// Tenancy core (ARCH §3.1; POLY-62 ruling R1). Runs SQL through the caller's transaction; adds no dependency.
import { sql, type Tx } from '@poly/db';

export const name = '@poly/tenancy';

export const TAX_CLASSIFICATIONS = [
  'individual',
  'trust_grantor',
  'trust_non_grantor',
  'business_pass_through',
  'business_c_corp',
  'parent_joint_filers',
  'parent_pass_through',
] as const;
export type TaxClassification = (typeof TAX_CLASSIFICATIONS)[number];

export type EntityKind = 'base' | 'parent';

/** Which classifications each entity kind admits (the database trigger enforces the same, plus the system-type family). */
export const TAX_BY_KIND: Record<EntityKind, readonly TaxClassification[]> = {
  base: ['individual', 'trust_grantor', 'trust_non_grantor', 'business_pass_through', 'business_c_corp'],
  parent: ['parent_joint_filers', 'parent_pass_through'],
};

/**
 * Gives the transaction's user their own Person (owner membership seated by the entity trigger). Idempotent. Acts for
 * app.current_user_id(); with no user set the insert is refused (42501). No RETURNING: the new row's SELECT policy
 * cannot see the AFTER trigger's membership, so the id is read back in a second statement.
 */
export async function provisionPerson(tx: Tx): Promise<{ personId: string; created: boolean }> {
  const find = () =>
    tx.execute<{ id: string }>(sql`SELECT id FROM public.entity WHERE self_user_id = app.current_user_id()`);
  const existing = await find();
  if (existing.rows[0]) return { personId: existing.rows[0].id, created: false };
  // No ON CONFLICT: its arbiter makes the INSERT also check the SELECT policy, which cannot see the AFTER trigger's
  // membership. Two concurrent first calls for one user hit the unique self_user_id; the loser fails and retries.
  await tx.execute(sql`
    INSERT INTO public.entity (type_id, name, self_user_id)
    SELECT t.id,
           coalesce((SELECT u.name FROM public."user" u WHERE u.id = app.current_user_id()), 'Person'),
           app.current_user_id()
    FROM public.entity_type t WHERE t.system_key = 'person'`);
  const row = (await find()).rows[0];
  if (!row) throw new Error('provisionPerson: the Person is not visible after insert');
  return { personId: row.id, created: true };
}

/**
 * A sign-up's own Person (POLY-152 R3), for the sign-in service: poly_auth holds no write on entity, so the insert is the definer's.
 * It must be the exact call, inside the transaction that created the user. Returns the new Person's id.
 */
export async function provisionOwnPerson(tx: Tx): Promise<string> {
  const res = await tx.execute<{ provision_person: string }>(sql`SELECT app.provision_person()`);
  const id = res.rows[0]?.provision_person;
  if (typeof id !== 'string') throw new Error('provisionOwnPerson: the definer returned no id');
  return id;
}

export { InvitationRequired, claimInvitation, acceptInvitations, landingEntity, hashInvitationToken, decodeInvitationToken, newInvitationToken, invitationLink, validOperatorEmail } from './invitation.ts';
