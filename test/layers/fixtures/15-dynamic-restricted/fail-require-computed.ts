// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-computed-import
declare const require: (s: string) => unknown;
export const m = (n: string) => require(n);
