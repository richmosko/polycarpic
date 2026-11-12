// Invitation claim and acceptance (POLY-87 ruling R1-R3; SECURITY C-01). The only file that names the two definers
// (layers.json reservedLiterals). Runs SQL through the caller's transaction; the database decides every refusal.
import { createHash } from 'node:crypto';
import { sql, type Tx } from '@poly/db';

export class InvitationRequired extends Error {
  constructor() {
    super('sign-up requires an invitation');
    this.name = 'InvitationRequired';
  }
}

/** A token is exactly 32 bytes in canonical base64url (43 characters, no padding); anything else is not a token. */
export function decodeInvitationToken(token: string): Buffer | null {
  if (typeof token !== 'string' || token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === token ? bytes : null;
}

/** sha256 of the DECODED bytes: the value stored in invitation.token_hash. */
export function hashInvitationToken(token: string): Buffer {
  const bytes = decodeInvitationToken(token);
  if (!bytes) throw new InvitationRequired();
  return createHash('sha256').update(bytes).digest();
}

/** One refusal for every cause: no row, wrong state, or a database refusal (42501) or lock timeout (55P03). */
function refused(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
  return code === '42501' || code === '55P03';
}

const hashOf = (token: string | null): Buffer | null => (token === null ? null : hashInvitationToken(token));

/**
 * Locks the live invitation(s) this sign-up may claim, inside the sign-up transaction (SECURITY C-01, ARCH §3.1c).
 * With a token: the one row for that token and email. With null: every live row for the email (the caller proves the
 * email another way). Throws InvitationRequired for every refusal.
 */
export async function claimInvitation(tx: Tx, args: { email: string; token: string | null }): Promise<void> {
  const hash = hashOf(args.token);
  try {
    await tx.execute(sql`SELECT app.claim_invitations(${hash}::bytea, ${args.email}::text)`);
  } catch (e) {
    if (refused(e)) throw new InvitationRequired();
    throw e;
  }
}

/** Binds the claimed rows to the user this transaction inserted and seats viewers. Returns the newest seated entity, or null. */
export async function acceptInvitations(tx: Tx, args: { token: string | null }): Promise<string | null> {
  const hash = hashOf(args.token);
  try {
    const r = await tx.execute<{ accept_invitations: string | null }>(sql`SELECT app.accept_invitations(${hash}::bytea)`);
    return r.rows[0]?.accept_invitations ?? null;
  } catch (e) {
    if (refused(e)) throw new InvitationRequired();
    throw e;
  }
}

/** The entity a signed-in user lands on: the newest one an accepted invitation seated, else their own Person. */
export async function landingEntity(tx: Tx): Promise<string | null> {
  const r = await tx.execute<{ id: string | null }>(sql`
    SELECT coalesce(
      (SELECT i.entity_id FROM public.invitation i
        WHERE i.claimed_user_id = app.current_user_id() AND i.accepted_at IS NOT NULL AND i.entity_id IS NOT NULL
        ORDER BY i.created_at DESC, i.id DESC LIMIT 1),
      (SELECT e.id FROM public.entity e WHERE e.self_user_id = app.current_user_id())) AS id`);
  return r.rows[0]?.id ?? null;
}
