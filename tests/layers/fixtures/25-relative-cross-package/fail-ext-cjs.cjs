// @virtual-path: packages/auth/src/f.cjs
// @expect: poly/no-relative-cross-package
const l = require('../../ledger/src/index.js');
module.exports = l;
