// POLY-150 R3.3 / R7: the browser half of WebAuthn, in the wire shape BetterAuth's passkey routes take (SimpleWebAuthn's JSON). No dependency.
const b64u = (buf: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string): ArrayBuffer => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

type Descriptor = { id: string; type: 'public-key'; transports?: AuthenticatorTransport[] };
const descriptors = (list?: Descriptor[]) => list?.map((d) => ({ ...d, id: unb64u(d.id) }));

export type CreationOptionsJSON = {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Descriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
};
export type RequestOptionsJSON = { challenge: string; timeout?: number; rpId?: string; allowCredentials?: Descriptor[]; userVerification?: UserVerificationRequirement };

/** navigator.credentials.create for BetterAuth's options; resolves the `response` body of /passkey/verify-registration, or null if cancelled. */
export async function createCredential(o: CreationOptionsJSON): Promise<Record<string, unknown> | null> {
  const cred = (await navigator.credentials
    .create({ publicKey: { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) }, excludeCredentials: descriptors(o.excludeCredentials) } })
    .catch(() => null)) as PublicKeyCredential | null;
  if (!cred) return null;
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports?.() ?? [] },
  };
}

/** navigator.credentials.get for BetterAuth's options; resolves the `response` body of /passkey/verify-authentication, or null if cancelled. */
export async function getCredential(o: RequestOptionsJSON): Promise<Record<string, unknown> | null> {
  const cred = (await navigator.credentials.get({ publicKey: { ...o, challenge: unb64u(o.challenge), allowCredentials: descriptors(o.allowCredentials) } }).catch(() => null)) as PublicKeyCredential | null;
  if (!cred) return null;
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { authenticatorData: b64u(r.authenticatorData), clientDataJSON: b64u(r.clientDataJSON), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined },
  };
}
