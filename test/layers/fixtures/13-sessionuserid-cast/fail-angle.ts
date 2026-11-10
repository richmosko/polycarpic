// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-session-user-id-cast
import type { SessionUserId } from '@poly/db';
export const f = (x: any) => <SessionUserId>x;
