// POLY-137 harness (ruling @ a5e9ce4f R1.5, R1.6). A duck-typed Mailer: `{ send(m) }` is the whole interface, so these suites need neither
// @poly/mail nor its fake to exist and fail for behaviour, not for a missing import. `fail: true` throws what MailError(502) is (name,
// status). Nothing in a service imports this file. The service is built with `mailer` in the extras of e.optionsOf (R1.5).
import { expect } from 'vitest';
import { PW, post, type Env } from './auth';
import { sessionWithHandle } from './handle';
import { totp } from './second-step';
import { must } from './sql';

export type Sent = { to: string; subject: string; text: string; idempotencyKey?: string };
export type Mem = { sent: Sent[]; fail: boolean; send(m: Sent): Promise<void> };
export function memMailer(o: { fail?: boolean } = {}): Mem {
  const m: Mem = {
    sent: [], fail: o.fail ?? false,
    async send(x) { if (m.fail) throw Object.assign(new Error('mail failed'), { name: 'MailError', status: 502 }); m.sent.push(x); },
  };
  return m;
}
/** The six-digit code in a second-step mail; the token or link in a magic-link / reset mail. */
export const codeIn = (m: Sent): string => /\b(\d{6})\b/.exec(m.text)![1]!;
export const fragmentTokenIn = (m: Sent): string => /#([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
export const magicUrlIn = (m: Sent): string => /(https?:\/\/\S+)/.exec(m.text)![1]!;
export const lastTo = (mm: Mem, to: string): Sent | undefined => [...mm.sent].reverse().find((s) => s.to.toLowerCase() === to.toLowerCase());
/** Waits (real timers) until `n` mails are in `mm.sent`: the reset and magic-link senders are started, not awaited (R1.9, R2.2). */
export async function sentCount(mm: Mem, n: number, ms = 3000): Promise<boolean> {
  for (let t = 0; t < ms; t += 25) { if (mm.sent.length >= n) return true; await new Promise((r) => setTimeout(r, 25)); }
  return mm.sent.length >= n;
}
/** Lets started-but-unawaited senders finish when no mail is expected. */
export const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** A service instance built with `mailer`; the limiter is off unless `limiter` is set (S6). */
export async function mailAuth(e: Env, mailer: Mem | undefined, o: { limiter?: boolean; tls?: 'real-domain' | 'private-ca' } = {}) {
  // `sendSecondStepCode` is the pre-POLY-137 injection point (R1.5 removes it from AuthInput, so after the build it is ignored and the code
  // arrives through `mailer`). While it still exists, it lets first set-up work, so the hold's own tests reach the hold and fail there.
  const legacy = mailer ? { sendSecondStepCode: async (m: any) => { const code = Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string; mailer.sent.push({ to: String(m.email), subject: 'legacy stand-in', text: `Your code is ${code}.` }); } } : {};
  const extra = mailer ? { mailer, ...legacy } : {};
  return e.A.createAuth({ ...e.optionsOf(o.tls ?? 'real-domain', extra), ...(o.limiter ? {} : { rateLimit: { enabled: false } }) });
}

/**
 * First set-up over the real handler with `mm` as the mailer: password, emailed code, enable, verify. Returns the secret, backup codes and cookie.
 * The code is read from the mail the service sent (R1.5), not from a stand-in argument.
 */
export async function enrol(e: Env, auth: any, mm: Mem, u = e.seedUser()) {
  const { jar } = await import('./auth');
  let { cookie } = await e.signIn(u.email, auth);
  const n0 = mm.sent.length;
  const s = await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
  expect(s.status, 'send-code').toBe(200);
  const code = codeIn(lastTo(mm, u.email) ?? mm.sent[n0]!);
  expect((await e.handle(post('/second-step/confirm-code', { code }, cookie), auth)).status).toBe(200);
  const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
  expect(en.status).toBe(200);
  const j: any = await en.clone().json();
  const secret = new URL(j.totpURI).searchParams.get('secret')!;
  const ver = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, cookie), auth);
  expect(ver.status).toBe(200);
  cookie = jar(cookie, ver);
  return { u, cookie, secret, backupCodes: (j.backupCodes ?? []) as string[] };
}
/** A session for the user with a fresh step-up stamp (what Confirm it's you leaves), as a Cookie header. */
export async function freshCookie(e: Env, auth: any, uid: string): Promise<{ cookie: string; id: string }> {
  const s = sessionWithHandle(e.db, uid, { fresh: true });
  return { cookie: await e.cookieForToken(s.token, auth), id: s.id };
}
export const holds = (e: Env, uid: string) =>
  must(`SELECT id, method, coalesce(two_factor_id::text,''), coalesce(passkey_id::text,''), extract(epoch FROM (usable_at - created_at))::int, coalesce(cancel_hash::text,''), coalesce(cancelled_at::text,''), coalesce(notice_sent_at::text,''), mail_id FROM app.method_hold WHERE user_id = '${uid}' ORDER BY created_at, id`, e.db).rows;
export const outbox = (e: Env, uid: string, kind?: string) =>
  must(`SELECT id, kind, to_address, payload::text, coalesce(sent_at::text,''), attempts FROM app.mail_outbox WHERE user_id = '${uid}'${kind ? ` AND kind = '${kind}'` : ''} ORDER BY created_at, id`, e.db).rows;
/** What the worker's mail.drain leaves when it has sent the mail: the notice is accepted, and `usable_at` is `hours` from now (default: past). */
export function markSent(e: Env, uid: string, o: { usableInHours?: number } = {}): void {
  const at = o.usableInHours === undefined ? `now() - interval '1 second'` : `now() + interval '${o.usableInHours} hours'`;
  must(`UPDATE app.mail_outbox SET sent_at = now(), attempts = greatest(attempts, 1) WHERE user_id = '${uid}' AND kind = 'method_added'; UPDATE app.method_hold SET notice_sent_at = now() - interval '1 hour', usable_at = ${at} WHERE user_id = '${uid}' AND cancelled_at IS NULL`, e.db);
}
