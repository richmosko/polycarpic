// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
// @layers: newpkg
// @message: newpkg
import { n } from '../../newpkg/src/index.ts';
export const x = n;
