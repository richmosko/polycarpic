// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
export const u = new URL('../../ledger/src/index.ts', import.meta.url);
