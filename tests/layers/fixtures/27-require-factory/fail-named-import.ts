// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-require-factory,no-restricted-imports
import { createRequire } from 'node:module';
export const r = createRequire;
