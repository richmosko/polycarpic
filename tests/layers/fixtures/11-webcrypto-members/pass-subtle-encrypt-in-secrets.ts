// @virtual-path: packages/secrets/src/f.ts
export const f = (k: CryptoKey, d: BufferSource) => crypto.subtle.encrypt({ name: 'AES-GCM' } as any, k, d);
