// `polycarpic cli user reset-mfa <email>` (POLY-89 R6). The only file that imports the reset wrapper. Clears a user's second steps and
// sessions; the user must re-enrol. Exit codes: 0 reset, 2 no such user, 1 anything else. Nothing secret is printed.
import { Writable } from 'node:stream';
import { createLogger } from '@poly/config/log';
import { withOperatorTx } from '@poly/db/operator';
import { validOperatorEmail } from '@poly/tenancy';
import { NoSuchUser, resetSecondStep } from '@poly/tenancy/operator-reset';
import type { InviteIo } from './user-invite.ts';

export async function runUserResetMfa(args: { email: string }, io: InviteIo): Promise<0 | 1 | 2> {
  const log = createLogger({ service: 'operator', stream: new Writable({ write: (c, _e, cb) => (io.stderr.write(String(c)), cb()) }) });
  if (!validOperatorEmail(args.email)) {
    io.stderr.write('refused: not an email address\n');
    return 1;
  }
  try {
    await withOperatorTx((tx) => resetSecondStep(tx, args));
    io.stdout.write('second step reset; the user must enrol again\n');
    log.info('second_step.reset', { outcome: 'ok' });
    return 0;
  } catch (e) {
    if (e instanceof NoSuchUser) {
      io.stderr.write('refused: no such user\n');
      log.warn('second_step.reset_refused', { outcome: 'refused' });
      return 2;
    }
    io.stderr.write('failed: nothing was reset\n');
    log.error('second_step.reset_failed', { outcome: 'error', err: e });
    return 1;
  }
}
