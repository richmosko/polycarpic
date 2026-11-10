// @virtual-path: packages/ledger/src/f.ts
export const f = (k: any, d: BufferSource) => crypto.subtle.sign('SHA-256' as any, k, d as any);
