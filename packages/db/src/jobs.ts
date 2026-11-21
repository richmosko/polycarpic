// db/jobs (POLY-137 R5.1): every SQL string the worker's scheduled jobs run, each one autocommit statement on the worker pool as
// poly_worker. There is no marker and no withSystem: none of these definers reads one. Importable by apps/worker/src/jobs/purge.ts and
// mail.ts alone (layers.json `confined`); the definer names are reserved literals of this file.
import { workerPool } from './pool.ts';

const one = async (text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> => (await workerPool().query(text, values)).rows;

export async function purgeTxIdentity(): Promise<number> {
  return Number((await one('SELECT app.purge_tx_identity()'))[0]?.purge_tx_identity ?? 0);
}
export async function purgeSignInRecord(): Promise<number> {
  return Number((await one('SELECT app.purge_sign_in_record()'))[0]?.purge_sign_in_record ?? 0);
}
export async function purgeMailOutbox(): Promise<number> {
  return Number((await one('SELECT app.purge_mail_outbox()'))[0]?.purge_mail_outbox ?? 0);
}

export interface ClaimedMail {
  id: string;
  kind: string;
  toAddress: string;
  payload: Record<string, unknown>;
  attempts: number;
}
/** The oldest unsent row, claimed (attempts + 1), or null. */
export async function claimMail(): Promise<ClaimedMail | null> {
  const r = (await one('SELECT * FROM app.claim_mail()'))[0];
  if (!r) return null;
  return { id: r.id as string, kind: r.kind as string, toAddress: r.to_address as string, payload: (r.payload ?? {}) as Record<string, unknown>, attempts: Number(r.attempts) };
}
/** Arms the cancel link's hash for the mail's holds; returns the latest usable_at, or null when none is held (after a cancel). */
export async function armHoldCancel(mailId: string, hash: Buffer): Promise<Date | null> {
  const v = (await one('SELECT app.arm_hold_cancel($1, $2)', [mailId, hash]))[0]?.arm_hold_cancel;
  return v == null ? null : new Date(v as string | Date);
}
export async function mailSent(mailId: string): Promise<void> {
  await one('SELECT app.mail_sent($1)', [mailId]);
}
export async function mailFailed(mailId: string, status: number | null): Promise<void> {
  await one('SELECT app.mail_failed($1, $2)', [mailId, status]);
}
