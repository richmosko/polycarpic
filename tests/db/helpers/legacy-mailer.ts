// POLY-137 R1.5 migration: the suites written before the mailer seam collect mail through two callbacks, `sendMagicLink({email, token, url})` and
// `sendSecondStepCode({email, code})`, which authOptions no longer takes. This adapts those callbacks to the one `Mailer` the service now takes, by
// reading the fixed text of the two mails (ruling R1.7). Plain TS (the e2e seed imports it under node): no vitest, no @poly import.
type Sent = { to: string; subject: string; text: string };
export type LegacyMagic = (m: { email: string; token: string; url: string }) => unknown;
export type LegacyCode = (m: { email: string; code: string }) => unknown;
export function legacyMailer(o: { magic?: LegacyMagic; code?: LegacyCode }): { send(m: Sent): Promise<void> } {
  return {
    async send(m) {
      if (m.subject === 'Your polycarpic confirmation code') {
        const code = /\b(\d{6})\b/.exec(m.text)?.[1];
        if (code) await o.code?.({ email: m.to, code });
      } else if (m.subject === 'Your polycarpic sign-in link') {
        const url = /(https?:\/\/\S+)/.exec(m.text)?.[1];
        if (url) await o.magic?.({ email: m.to, token: new URL(url).searchParams.get('token') ?? '', url });
      }
    },
  };
}
