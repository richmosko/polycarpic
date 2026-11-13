// @virtual-path: packages/db/src/pool.ts
// @expect: poly/confined-module
export const l = () => import('./new-user.ts');
