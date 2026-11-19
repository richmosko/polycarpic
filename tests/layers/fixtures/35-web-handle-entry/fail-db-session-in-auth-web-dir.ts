// @virtual-path: packages/auth/src/web/sessions.ts
// @expect: no-restricted-imports
// POLY-153 R7.3: and for the web/ directory under packages/auth/src.
import { sessionUserId } from '@poly/db/session';
export { sessionUserId };
