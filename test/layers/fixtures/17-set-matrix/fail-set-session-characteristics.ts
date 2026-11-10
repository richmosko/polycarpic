// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-set
export const q = sql`SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
