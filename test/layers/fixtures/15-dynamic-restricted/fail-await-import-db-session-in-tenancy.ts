// @virtual-path: packages/tenancy/src/f.ts
// @expect: poly/no-banned-specifier
export const m = async () => await import('@poly/db/session');
