// POLY-87 ruling R7: how A's tests create invitations. Test code only; A adds no way to write one.
//  - entity rows: INSERTed as poly_app with app.user_id = the entity's owner (the production owner policy and
//    gate_owner_changes, a sole owner is allowed), so the fixture is itself a test of the production grant;
//  - no-entity rows: superuser, because A has no path that writes them (that is the point, condition 23);
//  - expired / revoked / claimed rows are set up afterwards as superuser.
// The token hash is computed here from the DECODED bytes with node:crypto, not with @poly/tenancy's hashInvitationToken: an
// independent oracle, so a wrong hash in the build fails the sign-up tests instead of agreeing with itself. A separate unit
// test pins hashInvitationToken to this same function.
import { createHash, randomBytes } from 'node:crypto';
import { must, psql } from './pg.ts';

export const tokenHash = (token: string): Buffer => createHash('sha256').update(Buffer.from(token, 'base64url')).digest();
export const newToken = (): string => randomBytes(32).toString('base64url');

export type Role = 'viewer' | 'manager' | 'owner';
export type SeedArgs = {
  db: string;
  email: string;
  role?: Role;
  entityId?: string; // omitted: a no-entity (operator-style) row
  as?: string; // the owner's user id; required with entityId
  expiresAt?: string; // SQL expression, default now() + interval '7 days'
  state?: 'live' | 'expired' | 'revoked' | 'claimed';
};

/** A user and a Business they own. The user and entity are written as superuser except the entity, which poly_app inserts. */
export function seedOwnerEntity(db: string, tag = Math.random().toString(36).slice(2, 8)): { ownerId: string; entityId: string; ownerEmail: string } {
  const ownerEmail = `owner-${tag}@qa.test`;
  const ownerId = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('Owner ${tag}', '${ownerEmail}', true) RETURNING id`, db).rows[0][0]!;
  const name = `qa-ent-${tag}`;
  const r = must(
    `BEGIN; SELECT set_config('app.user_id', '${ownerId}', true);
     INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), '${name}', 'business_pass_through');
     SELECT id FROM public.entity WHERE name = '${name}'; COMMIT;`,
    db,
    { role: 'poly_app' },
  );
  return { ownerId, entityId: r.rows[r.rows.length - 1]![0]!, ownerEmail };
}

/** Returns the plaintext token (the only copy). */
export function seedInvitation(a: SeedArgs): string {
  const token = newToken();
  const hex = tokenHash(token).toString('hex');
  const exp = a.expiresAt ?? `now() + interval '7 days'`;
  const role = a.role ?? 'viewer';
  if (a.entityId) {
    if (!a.as) throw new Error('seedInvitation: an entity invitation needs `as` (the owner)');
    must(
      `BEGIN; SELECT set_config('app.user_id', '${a.as}', true);
       INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
       VALUES ('${a.entityId}', '${a.email}', '${role}', '${a.as}', decode('${hex}', 'hex'), ${exp}); COMMIT;`,
      a.db,
      { role: 'poly_app' },
    );
  } else {
    must(`INSERT INTO public.invitation (email, role, token_hash, expires_at) VALUES ('${a.email}', '${role}', decode('${hex}', 'hex'), ${exp})`, a.db);
  }
  const where = `token_hash = decode('${hex}', 'hex')`;
  if (a.state === 'expired') must(`UPDATE public.invitation SET expires_at = now() - interval '1 minute' WHERE ${where}`, a.db);
  if (a.state === 'revoked') must(`UPDATE public.invitation SET revoked_at = now() WHERE ${where}`, a.db);
  if (a.state === 'claimed') {
    const u = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('Earlier', 'earlier-${hex.slice(0, 8)}@qa.test', true) RETURNING id`, a.db).rows[0]![0]!;
    must(`UPDATE public.invitation SET claimed_user_id = '${u}', claimed_at = now() WHERE ${where}`, a.db);
  }
  return token;
}

export const claimedBy = (db: string, token: string): string => must(`SELECT coalesce(claimed_user_id::text, '') FROM public.invitation WHERE token_hash = decode('${tokenHash(token).toString('hex')}', 'hex')`, db).rows[0]![0]!;
export const inviteRow = (db: string, token: string) =>
  must(`SELECT coalesce(claimed_user_id::text,''), coalesce(claimed_at::text,''), coalesce(accepted_at::text,'') FROM public.invitation WHERE token_hash = decode('${tokenHash(token).toString('hex')}', 'hex')`, db).rows[0]!;
export { psql };
