// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
export type T = import(`../../ledger/src/index.ts`).L;
