// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-153 R7.3: web has no SessionUserId brand; @poly/db/session is refused in apps/web.
import { sessionUserId } from '@poly/db/session';
export { sessionUserId };
