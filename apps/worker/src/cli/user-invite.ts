// `polycarpic cli user invite <email> [--bootstrap]` (POLY-142 R5). The only file that imports @poly/db/operator and the issuer.
// stdout carries the link and nothing else, written once, after COMMIT returned. The token, the link, the hash and the email
// never reach the logger or stderr. Exit codes: 0 issued, 2 refused (instance state), 1 anything else.
import { Writable } from 'node:stream';
import { createLogger } from '@poly/config/log';
import { withOperatorTx } from '@poly/db/operator';
import { invitationLink, validOperatorEmail } from '@poly/tenancy';
import { InstanceStateRefused, issueOperatorInvitation } from '@poly/tenancy/operator-invitation';

export interface Sink {
  write(s: string): unknown;
}
export interface InviteIo {
  stdout: Sink;
  stderr: Sink;
  /** config.publicOrigin and nothing else (O8). */
  origin: string;
}

export async function runUserInvite(args: { email: string; bootstrap: boolean }, io: InviteIo): Promise<0 | 1 | 2> {
  const log = createLogger({ service: 'worker', stream: new Writable({ write: (c, _e, cb) => (io.stderr.write(String(c)), cb()) }) });
  if (!validOperatorEmail(args.email)) {
    io.stderr.write('refused: not an email address\n');
    return 1;
  }
  try {
    const issued = await withOperatorTx((tx) => issueOperatorInvitation(tx, args));
    const kind = args.bootstrap ? 'bootstrap' : 'operator';
    io.stdout.write(invitationLink(io.origin, issued.token) + '\n');
    io.stderr.write(`invitation recorded (${kind}), expires ${issued.expiresAt.toISOString()}\n`);
    log.info('invitation.issued', { outcome: 'ok' });
    return 0;
  } catch (e) {
    if (e instanceof InstanceStateRefused) {
      io.stderr.write(e.reason === 'not_empty' ? 'refused: the instance already has a user\n' : 'refused: the instance has no user; use --bootstrap\n');
      log.warn('invitation.refused', { outcome: 'refused' });
      return 2;
    }
    io.stderr.write('failed: the invitation was not issued\n');
    log.error('invitation.failed', { outcome: 'error', err: e });
    return 1;
  }
}
