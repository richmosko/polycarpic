// @virtual-path: packages/auth/src/x.ts
// @expect: no-new-func
export const f = new Function('return 1');
