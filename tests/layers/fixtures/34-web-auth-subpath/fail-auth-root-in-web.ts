// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-152 (architect f16e92d1): a subpath-only allow ('auth/web' without 'auth') means "not the index": the root is refused in web.
import { listSessions } from '@poly/auth';
export { listSessions };
