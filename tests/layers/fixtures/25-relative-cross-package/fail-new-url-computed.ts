// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
declare const n: string;
export const u = new URL(`../../ledger/${n}`, import.meta.url);
