// Must FAIL tsc (TS2307/TS2792): the exports map hides everything past the index.
import * as deep from '@poly/ledger/src/index';

export { deep };
