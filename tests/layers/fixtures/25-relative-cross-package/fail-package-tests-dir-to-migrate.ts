// @virtual-path: apps/web/tests/e2e/x.ts
// @expect: poly/no-relative-cross-package
// @message: migrate
import { m } from '../../../migrate/src/index.ts';
export const x = m;
