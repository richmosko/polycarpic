// @virtual-path: apps/web/src/f.ts
// @expect: no-restricted-imports
// POLY-153 R7.3: the import name sessionUserId is refused wherever it is imported from.
import { sessionUserId } from '@poly/db';
export { sessionUserId };
