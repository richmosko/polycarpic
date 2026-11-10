// @virtual-path: packages/ledger/src/f.ts
// @expect: eslint-comments/no-unlimited-disable
/* eslint-disable */
import type { SessionUserId } from '@poly/db';
export const f = (x: string) => x as SessionUserId;
