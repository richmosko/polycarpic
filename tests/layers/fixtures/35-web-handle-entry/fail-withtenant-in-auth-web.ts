// @virtual-path: packages/auth/src/web.ts
// @expect: no-restricted-imports
// POLY-153 R7.3: the same refusals hold for packages/auth/src/web*.
import { withTenant } from '@poly/db';
export { withTenant };
