// @virtual-path: packages/config/src/x.test.ts
// @expect: poly/no-relative-cross-package
import p from '../../../scripts/layers/plugin.mjs';
export const x = p;
