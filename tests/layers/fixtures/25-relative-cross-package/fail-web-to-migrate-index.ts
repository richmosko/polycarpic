// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
// @message: migrate
import { m } from '../../migrate/src/index.ts';
export const x = m;
