// @virtual-path: apps/web/tests/e2e/x.ts
// @expect: poly/no-relative-cross-package
import p from '../../../../scripts/layers/plugin.mjs';
export const x = p;
