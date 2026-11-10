// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-set
export const q = (isLocal: boolean) => sql`select set_config('a', ${'1'}, ${isLocal})`;
