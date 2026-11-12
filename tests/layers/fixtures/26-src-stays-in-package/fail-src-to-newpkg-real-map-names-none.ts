// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
// @message-not: newpkg
import { n } from '../../newpkg/src/index.ts';
export const x = n;
