// @virtual-path: apps/worker/src/main.ts
// @expect: poly/confined-module
export const l = () => import('@poly/db/operator');
