// @virtual-path: packages/ledger/src/f.ts
// @expect: eslint-comments/no-restricted-disable
import type { SessionUserId } from '@poly/db';
export const f = (x: string) => x as SessionUserId; // eslint-disable-line boundaries/dependencies
