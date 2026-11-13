// The operator's invitation issuer (POLY-142 R4). The only file that names app.issue_operator_invitation (layers.json
// reservedLiterals), and confined to the CLI's user-invite.ts. Only the token's hash reaches the database.
import { sql, type Tx } from '@poly/db';
import { newInvitationToken } from './invitation.ts';

export class InstanceStateRefused extends Error {
  readonly reason: 'not_empty' | 'empty';
  constructor(reason: 'not_empty' | 'empty') {
    super(`InstanceStateRefused: ${reason}`);
    this.name = 'InstanceStateRefused';
    this.reason = reason;
  }
}

type PgError = { code?: string; message?: string; cause?: PgError };
const pgError = (e: unknown): PgError => {
  const x = e as PgError;
  return x.code ? x : (x.cause ?? x);
};

export async function issueOperatorInvitation(
  tx: Tx,
  args: { email: string; bootstrap: boolean },
): Promise<{ token: string; invitationId: string; expiresAt: Date }> {
  const { token, hash } = newInvitationToken();
  try {
    const r = await tx.execute<{ o_invitation_id: string; o_expires_at: Date | string }>(
      sql`SELECT * FROM app.issue_operator_invitation(${args.email}::text, ${hash}::bytea, ${args.bootstrap}::boolean)`,
    );
    const row = r.rows[0]!;
    return { token, invitationId: row.o_invitation_id, expiresAt: new Date(row.o_expires_at) };
  } catch (e) {
    const pe = pgError(e);
    if (pe.code === '55000') throw new InstanceStateRefused(pe.message === 'instance_empty' ? 'empty' : 'not_empty');
    throw e;
  }
}
