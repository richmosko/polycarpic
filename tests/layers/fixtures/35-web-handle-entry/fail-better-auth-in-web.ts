// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-153 R7.3 (N3): web imports no better-auth package.
import { betterAuth } from 'better-auth';
export { betterAuth };
