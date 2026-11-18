// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-153 R7.3: web enters by withSession only; the import name withTenant is refused.
import { withTenant } from '@poly/db';
export { withTenant };
