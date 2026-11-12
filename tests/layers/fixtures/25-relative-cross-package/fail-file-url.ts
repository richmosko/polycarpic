// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
import l from 'file:///opt/anything/x.ts';
export const x = l;
