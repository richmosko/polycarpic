// @virtual-path: packages/ledger/src/f.ts
// @expect: poly/no-webcrypto-members
export const f = (k: CryptoKey, d: BufferSource) => globalThis.crypto.subtle.encrypt({ name: 'AES-GCM' } as any, k, d);
