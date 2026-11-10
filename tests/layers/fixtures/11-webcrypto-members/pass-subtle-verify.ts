// @virtual-path: packages/ledger/src/f.ts
export const f = (k: any, d: BufferSource) => crypto.subtle.verify('SHA-256' as any, k, d as any);
