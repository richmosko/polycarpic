// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
export const l = () => import('../../ledger/src/index.ts');
