// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package,poly/no-computed-import
declare const n: string;
export const l = () => import(`../../ledger/${n}`);
