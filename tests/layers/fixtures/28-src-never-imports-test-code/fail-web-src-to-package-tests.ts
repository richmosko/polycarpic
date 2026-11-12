// @virtual-path: apps/web/src/x.ts
// @expect: poly/no-relative-cross-package
import { s } from '../tests/e2e/serve.ts';
export const x = s;
