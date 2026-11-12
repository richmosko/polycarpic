// @virtual-path: packages/auth/src/x.mts
// @expect: poly/no-relative-cross-package
import { l } from '../../ledger/src/index.ts';
export const x = l;
