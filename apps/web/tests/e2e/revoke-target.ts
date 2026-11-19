// POLY-153 R7.4 (architect's condition): the harness revoke finds its target in the catalog, and must find exactly one function, the
// asserted-user entry with the signature (uuid, uuid). Zero or two matches, or any other signature, throws, so the revoke can never
// silently do nothing. The definer's name is reserved to packages/db/src/context.ts (poly/reserved-literal), hence the shape check.
export function revokeTarget(rows: string[][]): string {
  const sigs = rows.map((r) => r[0]!);
  if (sigs.length !== 1) throw new Error(`R7.4: expected exactly one asserted-user entry in the catalog, found ${sigs.length}: ${sigs.join(', ')}`);
  const sig = sigs[0]!;
  if (!/^app\.enter_asserted_[a-z]+\(uuid,uuid\)$/.test(sig) || !sig.endsWith('_user(uuid,uuid)')) throw new Error(`R7.4: the catalog entry is not the (uuid, uuid) asserted-user entry: ${sig}`);
  return sig;
}
