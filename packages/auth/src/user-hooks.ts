// databaseHooks (POLY-86 ruling R4, R7; seceng S11, S16b): the sign-up wrapper assertion with the invitation claim, the
// image rule, and the hook that keeps the IdP's idToken out of the account table.
import { currentClient, currentTx } from '@poly/db/auth';
import { claimInvitation } from '@poly/tenancy';

export class SignUpOutsideTransaction extends Error {
  constructor() {
    super('SignUpOutsideTransaction: a user row may only be created inside withContextFreeTx');
    this.name = 'SignUpOutsideTransaction';
  }
}

type Data = Record<string, unknown>;
type Hooked = { data: Data };

/** The image rule (criterion 15): until avatar upload exists the only accepted image is null. Pure. */
export function stripImage(data: Data): Data {
  return { ...data, image: null };
}

/**
 * Runs before every user insert, on every path, with no exception. The row is written inside the savepoint BetterAuth
 * opens, and a throw here writes nothing. It never opens a transaction (A-40): with no withContextFreeTx open it throws.
 */
export async function userCreateBefore(data: Data, ctx?: { body?: Record<string, unknown> } | null): Promise<Hooked> {
  if (currentClient()?.kind !== 'withContextFreeTx') throw new SignUpOutsideTransaction();
  const tx = currentTx();
  if (!tx) throw new SignUpOutsideTransaction();
  const token = typeof ctx?.body?.invitationToken === 'string' ? ctx.body.invitationToken : null;
  await claimInvitation(tx, { email: String(data.email ?? ''), token });
  return { data: stripImage(data) };
}

/** Until avatar upload exists the only accepted image is null; a provider's picture URL is never stored (criterion 15). */
export async function userUpdateBefore(data: Data): Promise<Hooked> {
  return { data: 'image' in data ? stripImage(data) : data };
}

export async function accountDropIdToken(data: Data): Promise<Hooked> {
  const { idToken: _dropped, ...rest } = data;
  return { data: rest };
}
