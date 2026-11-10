// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-banned-specifier
export const m = async () => await import('@sveltejs/kit');
