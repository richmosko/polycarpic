// The three token senders, built from the one Mailer (POLY-137 R1.5, R1.8, R1.9, R2.2). Every token mail goes through one RecipientCap; no
// sender logs an address, a subject, a text, a code, a link or a token.
import { RecipientCap, magicLinkMail, resetPasswordMail, secondStepCodeMail, type Mailer } from '@poly/mail';

type Kind = 'magic_link' | 'reset_password' | 'second_step_code';

export interface Senders {
  cap: RecipientCap;
  mailer: Mailer | undefined;
  /** Awaited by BetterAuth; answers at once. Throws only when no mailer is configured (development). */
  sendMagicLink(m: { email: string; url: string; token?: string }, ctx?: unknown): Promise<void>;
  sendResetPassword(m: { user: { id: string; email: string }; token: string }): Promise<void>;
  /** Taken before the challenge is issued (R1.8): false means the address is capped. */
  allow(address: string, userId: string): boolean;
  sendCode(m: { email: string; code: string }): Promise<void>;
}

export type LogFn = (event: string, fields: Record<string, unknown>) => void;
/** The default sink: one JSON line on stderr (as handler.ts does). apps/auth passes its pino logger instead. */
const consoleLog: LogFn = (event, fields) => console.error(JSON.stringify({ event, ...fields }));

type Finder = { context: { internalAdapter: { findUserByEmail(email: string): Promise<{ user: { id: string; email: string } } | null> } } };

export function buildSenders(mailer: Mailer | undefined, origin: string, log: LogFn = consoleLog): Senders {
  const cap = new RecipientCap();
  // A timeout has no status: the field is omitted, never a string.
  const logFailed = (kind: Kind, e: unknown): void => {
    const status = (e as { status?: unknown } | null)?.status;
    log('mail.failed', { kind, ...(typeof status === 'number' ? { status } : {}) });
  };
  const logCapped = (kind: Kind, userId: string): void => log('mail.capped', { kind, user_id: userId });
  /** Started, not awaited: the answer never depends on the lookup, the cap or the provider. */
  const background = (fn: () => Promise<void>): void => {
    void fn().catch(() => {});
  };
  return {
    cap,
    mailer,
    async sendMagicLink(m, ctx) {
      if (!mailer) throw new Error('mailer not configured');
      background(async () => {
        // A link goes only to an address with an account (R1.9). The lookup runs on the plain pool: this route has no transaction of ours.
        const found = await (ctx as Finder).context.internalAdapter.findUserByEmail(m.email.trim().toLowerCase());
        if (!found) return;
        if (!cap.take(found.user.email)) return logCapped('magic_link', found.user.id);
        try {
          await mailer.send({ to: found.user.email, ...magicLinkMail({ url: m.url }) });
        } catch (e) {
          logFailed('magic_link', e);
        }
      });
    },
    async sendResetPassword(m) {
      background(async () => {
        if (!cap.take(m.user.email)) return logCapped('reset_password', m.user.id);
        try {
          await mailer!.send({ to: m.user.email, ...resetPasswordMail({ origin, token: m.token }) });
        } catch (e) {
          logFailed('reset_password', e);
        }
      });
    },
    allow(address, userId) {
      if (cap.take(address)) return true;
      logCapped('second_step_code', userId);
      return false;
    },
    async sendCode(m) {
      // Awaited before commit: a failed send rolls the challenge back. The count was taken by allow(), before the provider call.
      await mailer!.send({ to: m.email, ...secondStepCodeMail({ code: m.code }) });
    },
  };
}
