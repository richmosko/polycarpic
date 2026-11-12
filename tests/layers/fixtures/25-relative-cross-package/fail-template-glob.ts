// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
export const g = import.meta.glob(`../../../packages/*/src/*.ts`);
