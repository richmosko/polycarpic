// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-require-factory
import { createRequire } from 'node:module';
export const r = createRequire;
