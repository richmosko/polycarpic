// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-computed-import
export const m = (n: string) => import(`@poly/${n}`);
