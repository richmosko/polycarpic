// @virtual-path: packages/config/src/f.ts
// @expect: poly/no-relative-cross-package
import { canary } from '../../../tests/log/canary.ts';
export const x = canary;
