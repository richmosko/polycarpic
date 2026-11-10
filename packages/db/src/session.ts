// The only constructor of the branded SessionUserId that withTenant() accepts (ARCH §2.1, SECURITY A-39).
// Importable by packages/auth alone (layers.json); a cast to the brand is refused everywhere else.
declare const brand: unique symbol;

export type SessionUserId = string & { readonly [brand]: 'SessionUserId' };

export function sessionUserId(id: string): SessionUserId {
  return id as SessionUserId;
}
