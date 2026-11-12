// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
export const g = import.meta.glob(['./ok.ts', '../../../packages/ledger/src/*.ts']);
