// @virtual-path: apps/worker/src/f.ts
// @expect: poly/no-banned-specifier
export const m = async () => await import('@hpke/core');
