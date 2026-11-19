// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-153 R7.3 (N3): nor a @better-auth/* package.
import { passkey } from '@better-auth/passkey';
export { passkey };
