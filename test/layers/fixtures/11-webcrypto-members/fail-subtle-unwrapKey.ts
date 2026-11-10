// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-webcrypto-members
export const f = (k: CryptoKey, d: BufferSource) => crypto.subtle.unwrapKey({ name: 'AES-GCM' } as any, k, d as any);
