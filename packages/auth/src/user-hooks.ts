// databaseHooks (POLY-86 ruling R4, R7; seceng S11, S16b): the sign-up wrapper assertion with the invitation claim, the
// image rule, and the hook that keeps the IdP's idToken out of the account table.
import { currentClient, currentTx, type ContextFreeTx } from '@poly/db/auth';
import { setTwoFactorEnabled } from './anchor.ts';
import { acceptInvitations, claimInvitation, InvitationRequired, provisionPerson } from '@poly/tenancy';
import { APIError } from 'better-auth/api';

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

type HookCtx = { path?: string; body?: Record<string, unknown> } | null | undefined;

/** The one refusal body, shared with the route hook (S8): no SQLSTATE, message or hint ever reaches the client. */
export const invitationRequired = () => new APIError('FORBIDDEN', { code: 'invitation_required', message: 'invitation_required' });

// The claim mode is chosen by the route template, never by whether a body field is present (S1).
const TOKEN_LESS = new Set(['/callback/:id', '/magic-link/verify']);
function tokenFor(ctx: HookCtx): { token: string | null } {
  if (ctx?.path === '/sign-up/email') {
    const t = ctx.body?.invitationToken;
    if (typeof t !== 'string') throw invitationRequired();
    return { token: t };
  }
  if (ctx?.path !== undefined && TOKEN_LESS.has(ctx.path)) return { token: null };
  throw invitationRequired();
}

function contextFree(): ContextFreeTx {
  if (currentClient()?.kind !== 'withContextFreeTx') throw new SignUpOutsideTransaction();
  const tx = currentTx() as ContextFreeTx | null;
  if (!tx) throw new SignUpOutsideTransaction();
  return tx;
}

async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InvitationRequired) throw invitationRequired();
    throw e;
  }
}

/**
 * Runs before every user insert, on every path, with no exception. The row is written inside the savepoint BetterAuth
 * opens, and a throw here writes nothing. It never opens a transaction (A-40): with no withContextFreeTx open it throws.
 */
export async function userCreateBefore(data: Data, ctx?: HookCtx): Promise<Hooked> {
  const tx = contextFree();
  const { token } = tokenFor(ctx);
  await refusing(() => claimInvitation(tx, { email: String(data.email ?? ''), token }));
  return { data: stripImage(data) };
}

/**
 * After the user row exists (BetterAuth queues after-hooks until its own transaction ends, so this runs in our outer
 * transaction): the new-user step, the Person, then the invitation(s). Any throw rolls the whole sign-up back.
 */
export async function userCreateAfter(user: { id: string }, ctx?: HookCtx): Promise<void> {
  const tx = contextFree();
  const { token } = tokenFor(ctx);
  await tx.enterNewUser(user.id);
  await provisionPerson(tx);
  await refusing(() => acceptInvitations(tx, { token }));
}

/** Until avatar upload exists the only accepted image is null; a provider's picture URL is never stored (criterion 15). */
export async function userUpdateBefore(data: Data): Promise<Hooked> {
  const out = 'image' in data ? stripImage(data) : data;
  if (data.twoFactorEnabled === undefined) return { data: out };
  // R3 #1: poly_app holds no UPDATE on the column. The definer flips it (and applies the grant and step-up rules); the key goes out of
  // BetterAuth's UPDATE as undefined, because the adapter merges hook data over the original, so omitting it would not remove it.
  await setTwoFactorEnabled(data.twoFactorEnabled === true);
  return { data: { ...out, twoFactorEnabled: undefined } };
}

/** R3 #3: poly_app cannot INSERT recent_auth_at; BetterAuth copies it on a rotation. The database stamps the one enrolment session. */
export async function sessionCreateBefore(data: Data): Promise<Hooked> {
  return { data: { ...data, recentAuthAt: undefined } };
}

// BetterAuth merges a hook's data over the original (db/with-hooks.mjs), so omitting the key keeps the token: it is set to null.
export async function accountDropIdToken(data: Data): Promise<Hooked> {
  return { data: { ...data, idToken: null } };
}
