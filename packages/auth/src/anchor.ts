// The second-step anchor (POLY-89 R2): the emailed code that first enrolment rests on. A BetterAuth plugin, so it moves to the sign-in
// service with BetterAuth (stage 2). Two routes, both for a signed-in user with no second step yet:
//   POST /second-step/send-code     password (or, with no password, a session under 5 minutes old) -> a code by mail, before commit
//   POST /second-step/confirm-code  the code -> an enrolment grant for this session
// The database is the proof (app.issue_email_challenge, app.confirm_email_challenge); the password half is this file's, because
// Postgres cannot check a password. The answer to send-code is the same whether a code was sent or suppressed (R2, S8).
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { createRoutingPool } from './routing-pool.ts';

export interface SecondStepCode {
  email: string;
  code: string;
}
export type SendSecondStepCode = (m: SecondStepCode) => Promise<void>;

/** The answer a refused-but-counted confirm gives: the request transaction commits (the attempt is recorded), the status is 403. */
export const COMMIT_HEADER = 'x-poly-commit';

const pool = createRoutingPool();
const FRESH_SESSION_MS = 5 * 60_000;

const asRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/** The flip, by the definer (R3 #1): the exact parameter-bound call, on the request's transaction. */
export async function setTwoFactorEnabled(on: boolean): Promise<void> {
  await pool.query('SELECT app.set_two_factor_enabled($1)', [on]);
}

/** True when the marker's user holds a live grant for the marker's session (the enrolment class, R5). */
export async function enrolmentGrantLive(): Promise<boolean> {
  const rows = asRows<{ enrolment_grant_live: boolean }>(await pool.query('SELECT app.enrolment_grant_live()', []));
  return rows[0]?.enrolment_grant_live === true;
}

const refusal = (status: number, code: string): Response =>
  new Response(JSON.stringify({ code, message: code }), { status, headers: { 'content-type': 'application/json', [COMMIT_HEADER]: '1' } });

export function secondStepAnchor(opts: { sendSecondStepCode?: SendSecondStepCode }): BetterAuthPlugin {
  return {
    id: 'second-step-anchor',
    endpoints: {
      sendSecondStepCode: createAuthEndpoint('/second-step/send-code', { method: 'POST', use: [sessionMiddleware] }, async (ctx) => {
        const { user, session } = ctx.context.session;
        // ARCH §3.1c: the code goes to the current verified address only.
        if (!user.emailVerified) throw new APIError('FORBIDDEN', { code: 'email_not_verified', message: 'email_not_verified' });
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        const accounts = await ctx.context.internalAdapter.findAccounts(user.id);
        const credential = accounts.find((a) => a.providerId === 'credential' && a.password);
        if (credential) {
          // The password half of the anchor.
          if (typeof password !== 'string' || !(await ctx.context.password.verify({ hash: credential.password!, password }))) {
            throw new APIError('FORBIDDEN', { code: 'invalid_password', message: 'invalid_password' });
          }
        } else if (Date.now() - new Date(session.createdAt).getTime() > FRESH_SESSION_MS) {
          // No password: the session must be a fresh sign-in (a magic link makes one). The mailbox alone, as email is the recovery root (C-e).
          throw new APIError('FORBIDDEN', { code: 'recent_sign_in_required', message: 'recent_sign_in_required' });
        }
        const rows = asRows<{ issue_email_challenge: string | null }>(await pool.query('SELECT app.issue_email_challenge($1)', ['first_enrolment']));
        const code = rows[0]?.issue_email_challenge ?? null;
        if (code !== null) {
          if (!opts.sendSecondStepCode) throw new Error('second step: sendSecondStepCode is not configured');
          // Before commit: a failed send rolls the challenge back.
          await opts.sendSecondStepCode({ email: user.email, code });
        }
        return ctx.json({ status: true });
      }),
      confirmSecondStepCode: createAuthEndpoint('/second-step/confirm-code', { method: 'POST', use: [sessionMiddleware] }, async (ctx) => {
        const code = (ctx.body as { code?: unknown } | undefined)?.code;
        if (typeof code !== 'string') throw new APIError('BAD_REQUEST', { code: 'invalid_code', message: 'invalid_code' });
        const rows = asRows<{ confirm_email_challenge: boolean }>(await pool.query('SELECT app.confirm_email_challenge($1)', [code]));
        if (rows[0]?.confirm_email_challenge !== true) return refusal(403, 'invalid_code');
        return ctx.json({ status: true });
      }),
    },
  };
}
