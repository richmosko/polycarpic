// @virtual-path: packages/auth/src/f.ts
// @expect: eslint-comments/no-restricted-disable,poly/no-require-factory
// eslint-disable-next-line poly/no-require-factory
import { createRequire } from 'node:module';
export const r = createRequire;
