// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-session-set
export const q = sql`-- harmless
SET ROLE poly_owner`;
