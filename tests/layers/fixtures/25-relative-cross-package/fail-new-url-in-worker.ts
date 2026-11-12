// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
// @message: db
export const w = new Worker(new URL('../../../packages/db/src/index.ts', import.meta.url));
