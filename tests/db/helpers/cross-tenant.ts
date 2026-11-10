// Reusable by every feature that adds a tenant table (ruling R4): how many of `other`'s rows can `as` read from `table`
// through the real withTenant wrapper (poly_app, RLS in force)? A table is isolated when this is 0 and its positive
// control (`ownRows`) is above 0. `tenant` is the harness's binding of withTenant; `q` runs SQL in the open tx.
export type Tx = unknown;
export type TenantRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
export type Query = (tx: Tx, text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export async function crossTenantRows(
  tenant: TenantRunner, q: Query, table: string, as: string, other: string, ownerColumn = 'owner_user_id',
): Promise<{ otherRows: number; ownRows: number }> {
  return tenant(as, async (tx) => {
    const o = await q(tx, `select count(*)::int n from ${table} where ${ownerColumn} = $1`, [other]);
    const w = await q(tx, `select count(*)::int n from ${table} where ${ownerColumn} = $1`, [as]);
    return { otherRows: o[0].n as number, ownRows: w[0].n as number };
  });
}
