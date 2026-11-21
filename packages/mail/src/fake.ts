import { MailError, type Mail, type Mailer } from './index.ts';

/** A recording mailer for tests; `{ fail: true }` throws MailError(502). Never imported by a service (R1.6). */
export function fakeMailer(o: { fail?: boolean } = {}): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    async send(m) {
      if (o.fail) throw new MailError(502);
      sent.push(m);
    },
  };
}
