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
  const ins = await tx.execute(sql`
    INSERT INTO public.entity (type_id, name, self_user_id)
    SELECT t.id,
           coalesce((SELECT u.name FROM public."user" u WHERE u.id = app.current_user_id()), 'Person'),
           app.current_user_id()
    FROM public.entity_type t WHERE t.system_key = 'person'
    ON CONFLICT (self_user_id) DO NOTHING`);
  const row = (await find()).rows[0];
  if (!row) throw new Error('provisionPerson: the Person is not visible after insert');
  return { personId: row.id, created: (ins.rowCount ?? 0) > 0 };
}
