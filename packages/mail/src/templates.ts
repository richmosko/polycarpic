// R1.7: fixed strings with placeholders. No user-supplied string appears in any mail.
import type { Mail } from './index.ts';

export type Method = 'totp' | 'passkey';
type Body = Pick<Mail, 'subject' | 'text'>;

/** `2026-11-21 18:04 UTC` */
export function utc(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const one = (m: Method): string => (m === 'totp' ? 'An authenticator app' : 'A passkey');
const was = (ms: readonly Method[], verb: 'added' | 'removed'): string =>
  ms.length === 1 ? `${one(ms[0]!)} was ${verb}` : `${ms.length} sign-in methods were ${verb}`;

export const magicLinkMail = (o: { url: string }): Body => ({
  subject: 'Your polycarpic sign-in link',
  text: `Use this link to sign in to polycarpic. It works once, for 5 minutes:\n\n${o.url}\n\nIf you did not ask for it, ignore this email. Nobody can sign in without the link.`,
});

export const secondStepCodeMail = (o: { code: string }): Body => ({
  subject: 'Your polycarpic confirmation code',
  text: `Your code is ${o.code}. It works once, for 10 minutes, to set up a second step for signing in to your polycarpic account.\n\nNobody from polycarpic will ask you for this code. If you did not ask for it, someone may know your password: change it.`,
});

export const resetPasswordMail = (o: { origin: string; token: string }): Body => ({
  subject: 'Reset your polycarpic password',
  text: `Use this link to choose a new password. It works once, for 15 minutes:\n\n${o.origin}/sign-in/reset#${o.token}\n\nChoosing a new password signs your account out on every device. If you did not ask for this, ignore this email: your password has not changed.`,
});

const ADDED_SUBJECT = 'A sign-in method was added to your polycarpic account';

/** A held add. `cancelToken` null = the link is not armed (after a cancel). */
export const methodAddedHeldMail = (o: { methods: readonly Method[]; at: Date | string; until: Date | string; origin: string; cancelToken: string | null }): Body => {
  const head = `${was(o.methods, 'added')} as a second step for signing in to your polycarpic account on ${utc(o.at)}.\n\nIt will not work until ${utc(o.until)}, at least 24 hours from this email.\n\nIf you added it, you need do nothing.\n\n`;
  const tail = o.cancelToken === null
    ? 'If you did not add it, someone else may be signed in as you. Sign in, remove it under Settings, Sign-in and second step, change your password, and tell your operator.'
    : `If you did not add it, someone else may be signed in as you. Cancel it before ${utc(o.until)}:\n\n${o.origin}/sign-in/cancel-method#${o.cancelToken}\n\nCancelling removes the new method and signs your account out on every device. Then change your password.`;
  return { subject: ADDED_SUBJECT, text: head + tail };
};

export const methodAddedFirstMail = (o: { methods: readonly Method[]; at: Date | string }): Body => ({
  subject: ADDED_SUBJECT,
  text: `${was(o.methods, 'added')} as a second step for signing in to your polycarpic account on ${utc(o.at)}. It is your first second step, so it works now.\n\nIf you did not add it, someone else may be signed in as you: change your password at once and ask your operator to reset your second step.`,
});

export const methodRemovedMail = (o: { methods: readonly Method[]; at: Date | string }): Body => ({
  subject: 'A sign-in method was removed from your polycarpic account',
  text: `${was(o.methods, 'removed')} from the second step for signing in to your polycarpic account on ${utc(o.at)}.\n\nIf you did not remove ${o.methods.length === 1 ? 'it' : 'them'}, someone else may be signed in as you: change your password and tell your operator.`,
});

export const backupCodesReplacedMail = (o: { at: Date | string }): Body => ({
  subject: 'New backup codes were made for your polycarpic account',
  text: `New backup codes were made for your polycarpic account on ${utc(o.at)}. Your old backup codes no longer work.\n\nIf you did not make them, someone else may be signed in as you: change your password and tell your operator.`,
});

export const backupCodeUsedMail = (o: { at: Date | string }): Body => ({
  subject: 'A backup code was used on your polycarpic account',
  text: `A backup code was used to sign in to your polycarpic account on ${utc(o.at)}.\n\nIf it was not you, someone has your password and one of your backup codes: change your password and make new codes.`,
});

export const passwordChangedMail = (o: { at: Date | string; origin: string }): Body => ({
  subject: 'Your polycarpic password was changed',
  text: `The password for your polycarpic account was changed on ${utc(o.at)}.\n\nIf you did not change it, someone else may be signed in as you: reset your password at ${o.origin}/sign-in/forgot and tell your operator.`,
});
