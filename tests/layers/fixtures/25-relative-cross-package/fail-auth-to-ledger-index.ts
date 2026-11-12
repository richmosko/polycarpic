// @virtual-path: packages/auth/src/f.ts
// @expect: poly/no-relative-cross-package
// @message: ledger
import { l } from '../../ledger/src/index.ts';
export const x = l;
