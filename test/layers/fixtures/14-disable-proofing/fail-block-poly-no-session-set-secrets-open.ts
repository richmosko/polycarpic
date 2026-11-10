// @virtual-path: apps/web/src/f.ts
// @expect: eslint-comments/no-restricted-disable
/* eslint-disable poly/no-session-set */
import { open } from '@poly/secrets/open';
export { open };
