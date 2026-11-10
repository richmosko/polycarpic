// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-banned-specifier
export const m = async () => await import('@poly/secrets/open');
