// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
// @message: db
import { d } from '../../db/src/index.ts';
export const x = d;
