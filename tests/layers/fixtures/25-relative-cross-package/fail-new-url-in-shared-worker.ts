// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
export const w = new SharedWorker(new URL('../../../packages/db/src/index.ts', import.meta.url));
