// @virtual-path: packages/db/src/migrate/other.ts
// @expect: poly/no-session-set
export const q = sql`SET ROLE poly_owner`;
