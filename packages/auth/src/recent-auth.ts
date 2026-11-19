// Step-up (ARCH §3.1c, §3.3): a session passes only within 5 minutes of its recent_auth_at, by the database's clock. The check is the
// database's own (app.step_up_fresh(), POLY-153 R6): it reads the marker's session, so it runs on the request's transaction or not at all.
import { APIError } from 'better-auth/api';
import { currentClient } from '@poly/db/auth';

/** A stamp in the future, none, or no session transaction of ours (it fails closed) is refused. */
export async function requireRecentAuth(_sessionId: string): Promise<void> {
  const cur = currentClient();
  let fresh = false;
  if (cur) {
    const res = await cur.client.query('SELECT app.step_up_fresh()');
    fresh = Object.values((res.rows[0] ?? {}) as Record<string, unknown>)[0] === true;
  }
  if (!fresh) throw new APIError('FORBIDDEN', { code: 'step_up_required', message: 'step_up_required' });
}

const ABSOLUTE_CAP_MS = 30 * 86_400_000;

/** C-02: 30 days absolute, whatever BetterAuth's sliding expiry says (S14). */
export const cappedOut = (createdAt: Date | string | number): boolean => new Date(createdAt).getTime() + ABSOLUTE_CAP_MS <= Date.now();
