// POLY-89c: a software WebAuthn authenticator (ES256, attestation "none") for the passkey tests. It registers (the response body
// BetterAuth's /passkey/verify-registration takes) and signs assertions (/passkey/verify-authentication). Origin and rp id come
// from helpers/auth's BASE. No browser, no network.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { BASE } from './auth';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
const b64u = (b: Buffer) => b.toString('base64url');
function cbor(v: any): Buffer {
  const head = (m: number, n: number) => (n < 24 ? Buffer.from([(m << 5) | n]) : n < 256 ? Buffer.from([(m << 5) | 24, n]) : Buffer.from([(m << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported value');
}

export function softAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }) as { publicKey: KeyObject; privateKey: KeyObject };
  const jwk: any = publicKey.export({ format: 'jwk' });
  const cose = cbor(new Map<any, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const idBytes = randomBytes(16);
  const rpIdHash = sha256(Buffer.from(new URL(BASE).hostname));
  const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: BASE, crossOrigin: false }));
  return {
    credentialId: b64u(idBytes),
    /** What the passkey table stores in public_key (SimpleWebAuthn: the COSE key, base64url). */
    publicKey: b64u(cose),
    /** The body of /passkey/verify-registration's `response` for the options BetterAuth issued. */
    register(opt: { challenge: string; rp?: { id?: string } }) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, idBytes, cose]);
      const att = cbor(new Map<any, any>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(idBytes), rawId: b64u(idBytes), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData('webauthn.create', opt.challenge)), attestationObject: b64u(att), transports: ['internal'] } };
    },
    /** The body of /passkey/verify-authentication's `response`: user present + verified, the given signature counter. */
    assert(opt: { challenge: string }, counter = 1) {
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), c]);
      const cd = clientData('webauthn.get', opt.challenge);
      const signature = sign('sha256', Buffer.concat([authData, sha256(cd)]), privateKey); // DER, as WebAuthn ES256 wants
      return { id: b64u(idBytes), rawId: b64u(idBytes), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { authenticatorData: b64u(authData), clientDataJSON: b64u(cd), signature: b64u(signature) } };
    },
  };
}
