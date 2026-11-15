// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-set
export const q = sql`select set_config('app.qa_probe', ${'1'}, false)`;
