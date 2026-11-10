// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-set
export const q = (c: any) => c.query('SET search_path TO public');
