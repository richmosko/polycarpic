// @virtual-path: packages/db/src/f.ts
// @expect: poly/no-session-set
export const q = sql`SET SESSION AUTHORIZATION x`;
