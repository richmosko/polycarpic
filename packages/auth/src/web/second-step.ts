// Settings → Sign-in and second step, for web (POLY-150 R2). A web-side file: `@poly/db` and `sql` only, no BetterAuth table named. It calls two
// definers, app.my_second_step and app.recent_auth_ok, each of which requires a marker of kind `session`. Nothing here is a secret.
import { sql, type Tx } from '@poly/db';

export interface SecondStep {
  secondStepAt: string | null;
  totpAddedAt: string | null;
  passkeys: { id: string; name: string | null; createdAt: string }[];
  needsAMethod: boolean;
  codesPaused: boolean;
  /** The dialog's resume point: `factor` while a grant is live, `email_code` while a challenge is open, else `password`. */
  step: 'password' | 'email_code' | 'factor';
  /** Null once a second step is on. */
  enrolment: { challengeExpiresAt: string | null; resendAvailableAt: string | null; grantExpiresAt: string | null } | null;
}

type Row = {
  second_step_at: Date | string | null;
  totp_added_at: Date | string | null;
  passkeys: { id: string; name: string | null; created_at: string }[] | null;
  challenge_expires_at: Date | string | null;
  resend_available_at: Date | string | null;
  grant_expires_at: Date | string | null;
  needs_a_method: boolean;
  codes_paused: boolean;
};

const iso = (v: Date | string | null): string | null => (v === null || v === undefined ? null : new Date(v).toISOString());

/** The caller's own second-step state, plus whether a recent step-up is still fresh. */
export async function readSecondStep(tx: Tx): Promise<{ secondStep: SecondStep; recentAuthOk: boolean }> {
  const res = await tx.execute<Row>(sql`SELECT * FROM app.my_second_step()`);
  const r = res.rows[0];
  if (!r) throw new Error('my_second_step returned no row');
  const fresh = await tx.execute<{ ok: boolean }>(sql`SELECT app.recent_auth_ok() AS ok`);
  const secondStepAt = iso(r.second_step_at);
  const grant = iso(r.grant_expires_at);
  const challenge = iso(r.challenge_expires_at);
  return {
    secondStep: {
      secondStepAt,
      totpAddedAt: iso(r.totp_added_at),
      passkeys: (r.passkeys ?? []).map((k) => ({ id: k.id, name: k.name, createdAt: k.created_at })),
      needsAMethod: r.needs_a_method === true,
      codesPaused: r.codes_paused === true,
      step: grant ? 'factor' : challenge ? 'email_code' : 'password',
      enrolment: secondStepAt ? null : { challengeExpiresAt: challenge, resendAvailableAt: iso(r.resend_available_at), grantExpiresAt: grant },
    },
    recentAuthOk: fresh.rows[0]?.ok === true,
  };
}
