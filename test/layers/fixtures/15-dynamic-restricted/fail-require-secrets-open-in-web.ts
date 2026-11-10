// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-banned-specifier
declare const require: (s: string) => unknown;
export const m = require('@poly/secrets/open');
