// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-set
export const q = sql`SET SESSION statement_timeout = 5`;
