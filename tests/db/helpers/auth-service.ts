// POLY-152: the assumed surface of the sign-in service, in ONE place so the builder reconciles names here and not in four files.
// ASSUMED names (the ruling fixes the behaviour, not the exports):
//   apps/auth/src/internal.ts : handleInternal(request: Request, auth): Promise<Response>   the internal listener's GET /session (R6.2)
//   apps/auth/src/public.ts   : handlePublic(request: Request, auth): Promise<Response>     the public listener (/api/auth/* only, else 404)
//   @poly/db/auth             : withAuthSession(token, fn), withSignInTx(fn)               (R5, R9)
//   packages/auth/src/cookie-lifetime.ts : cookieLifetime() -> BetterAuth plugin, last in plugins[]
//   db configure({ auth }) is the pool key for poly_auth.
import { createHmac } from 'node:crypto';
import { expect } from 'vitest';
import { PW, SECRET, get, jar, post, type Env } from './auth';
import { pgmod, totp } from './second-step';
import { must } from './sql';

export const INTERNAL = 'http://auth.internal:3001';
export const internalReq = (cookie: string, path = '/session', init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`${INTERNAL}${path}`, { method: 'GET', ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });

export async function internal(): Promise<{ handleInternal: (r: Request, a: any) => Promise<Response>; handlePublic: (r: Request, a: any) => Promise<Response> }> {
  const i: any = await import('../../../apps/auth/src/internal.ts');
  const p: any = await import('../../../apps/auth/src/public.ts');
  return { handleInternal: i.handleInternal, handlePublic: p.handlePublic };
}

/** The signed-cookie value better-call builds for a token. */
export const signed = (token: string, secret = SECRET) => `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`;
export const sessionCookieName = (res: Response) => res.headers.getSetCookie().map((c) => c.split('=')[0]!).find((n) => /session_token/.test(n!))!;

/** Set a session row's age through SQL (the idle bound and the cap are row facts, so no timer is faked). */
export function age(e: Env, userId: string, o: { createdDaysAgo?: number; expiresInDays?: number; updatedDaysAgo?: number }): void {
  const sets: string[] = [];
  if (o.createdDaysAgo !== undefined) sets.push(`created_at = now() - interval '${o.createdDaysAgo} days'`);
  if (o.expiresInDays !== undefined) sets.push(`expires_at = now() + interval '${o.expiresInDays} days'`);
  if (o.updatedDaysAgo !== undefined) sets.push(`updated_at = now() - interval '${o.updatedDaysAgo} days'`);
  must(`UPDATE public.session SET ${sets.join(', ')} WHERE user_id = '${userId}'`, e.db);
}
export const expiresInDays = (e: Env, userId: string): number => Number(must(`SELECT extract(epoch FROM (expires_at - now()))/86400 FROM public.session WHERE user_id = '${userId}' ORDER BY created_at DESC LIMIT 1`, e.db).rows[0]![0]);
export const sessionRows = (e: Env, userId: string) => e.count(`SELECT 1 FROM public.session WHERE user_id = '${userId}'`);

/** Enrol a TOTP factor over the real handler (password + emailed code + enable + verify); returns the secret and backup codes. */
export async function enrolTotp(e: Env, auth: any, u: { id: string; email: string }, mails: { email: string; code: string }[]) {
  let { cookie } = await e.signIn(u.email, auth);
  mails.length = 0;
  expect((await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth)).status).toBe(200);
  const code = mails.find((m) => m.email.toLowerCase() === u.email.toLowerCase())!.code;
  expect((await e.handle(post('/second-step/confirm-code', { code }, cookie), auth)).status).toBe(200);
  const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
  expect(en.status).toBe(200);
  const j: any = await en.clone().json();
  const secret = new URL(j.totpURI).searchParams.get('secret')!;
  const ver = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, cookie), auth);
  expect(ver.status).toBe(200);
  cookie = jar(cookie, ver);
  return { cookie, secret, backupCodes: (j.backupCodes ?? []) as string[] };
}
export const heldSignIn = async (e: Env, auth: any, email: string) => {
  const r = await e.handle(post('/sign-in/email', { email, password: PW }), auth);
  return { cookie: jar('', r), res: r };
};
export const hasSessionCookie = (r: Response) => r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c));

/** Statements the pg client sends while `fn` runs (the ruling asks for the write set of a refusal). */
export async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const sql: string[] = [];
  const orig = pgmod.Client.prototype.query;
  pgmod.Client.prototype.query = function (this: unknown, ...a: any[]) { const q = a[0]; sql.push(typeof q === 'string' ? q : String(q?.text)); return orig.apply(this, a); };
  try { return { result: await fn(), sql }; } finally { pgmod.Client.prototype.query = orig; }
}
export { get, jar, post };
