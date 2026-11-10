// @virtual-path: apps/web/src/f.ts
// @expect: eslint-comments/no-restricted-disable
/* eslint-disable poly/no-session-user-id-cast */
import { open } from '@poly/secrets/open';
export { open };
