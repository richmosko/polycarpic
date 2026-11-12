// @virtual-path: apps/web/src/x.ts
// @expect: no-eval
export const r = globalThis.eval('1 + 1');
