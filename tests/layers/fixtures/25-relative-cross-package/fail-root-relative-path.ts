// @virtual-path: apps/web/src/f.ts
// @expect: poly/no-relative-cross-package
// @message: ledger
import l from '../../../packages/ledger/src/index.ts';
export const x = l;
