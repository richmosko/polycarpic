// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-relative-cross-package
// @layers: ledger-allows-posting
// @ignore: boundaries/dependencies
// @message: posting
import { p } from '../../posting/src/index.ts';
export const x = p;
