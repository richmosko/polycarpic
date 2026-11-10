// @virtual-path: packages/db/src/session.ts
export type SessionUserId = string & { readonly __brand: 'SessionUserId' };
export const asSessionUserId = (x: string) => x as SessionUserId;
