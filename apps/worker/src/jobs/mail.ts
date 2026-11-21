// mail.drain (POLY-137 R5.2, R3.6, R3.7): claims up to `limit` outbox rows, one mail per row. A held method_added row mints a 32-byte token,
// arms its sha256 with the database, then mails the cancel link in the URL fragment. The worker has no recipient cap: notices are never counted.
import { createHash, randomBytes } from 'node:crypto';
import { armHoldCancel, claimMail, mailFailed, mailSent, type ClaimedMail } from '@poly/db/jobs';
import {
  backupCodeUsedMail, backupCodesReplacedMail, methodAddedFirstMail, methodAddedHeldMail, methodRemovedMail, passwordChangedMail,
  type Mail, type Mailer, type Method,
} from '@poly/mail';

const LIMIT = 20;

async function render(row: ClaimedMail, origin: string): Promise<Pick<Mail, 'subject' | 'text'>> {
  const p = row.payload as { methods?: unknown; at?: unknown; usable_at?: unknown };
  const at = typeof p.at === 'string' ? p.at : new Date();
  const methods = (Array.isArray(p.methods) ? p.methods : []).filter((m): m is Method => m === 'totp' || m === 'passkey');
  switch (row.kind) {
    case 'method_added': {
      if (typeof p.usable_at !== 'string') return methodAddedFirstMail({ methods, at });
      const token = randomBytes(32);
      const until = await armHoldCancel(row.id, createHash('sha256').update(token).digest());
      // NULL: no hold of this mail is held any more (after a cancel). The mail carries no link.
      return methodAddedHeldMail({ methods, at, until: until ?? p.usable_at, origin, cancelToken: until ? token.toString('base64url') : null });
    }
    case 'method_removed': return methodRemovedMail({ methods, at });
    case 'backup_codes_replaced': return backupCodesReplacedMail({ at });
    case 'backup_code_used': return backupCodeUsedMail({ at });
    case 'password_changed': return passwordChangedMail({ at, origin });
    default: throw new Error('unknown outbox kind');
  }
}

export async function drainMail(o: { mailer: Mailer; origin: string; limit?: number }): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < (o.limit ?? LIMIT); i++) {
    const row = await claimMail();
    if (!row) break;
    try {
      const body = await render(row, o.origin);
      await o.mailer.send({ to: row.toAddress, ...body, idempotencyKey: `mail-${row.id}-${row.attempts}` });
      await mailSent(row.id);
      sent++;
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      failed++;
      await mailFailed(row.id, typeof status === 'number' ? status : null).catch(() => {});
    }
  }
  return { sent, failed };
}
