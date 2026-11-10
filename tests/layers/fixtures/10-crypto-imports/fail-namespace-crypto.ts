// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/named-imports-only
import * as c from 'crypto';
export const x = c.createCipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12));
