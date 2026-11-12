// @virtual-path: packages/config/src/f.ts
// @expect: poly/no-relative-cross-package
import { t } from './x.test.mjs';
export const x = t;
