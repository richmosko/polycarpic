// @virtual-path: packages/config/src/f.ts
// @expect: poly/no-relative-cross-package
import { t } from './x.spec.ts';
export const x = t;
