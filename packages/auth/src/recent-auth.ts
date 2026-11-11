// Step-up (ARCH §3.1c, §3.3): a session passes only within 5 minutes of its recent_auth_at, by the database's clock.
import { APIError } from 'better-auth/api';
import { createRoutingPool } from './routing-pool.ts';

const WINDOW_SECONDS = 300;
const pool = createRoutingPool();

/** Reads recent_auth_at from the row on every call (no cookie cache). A stamp in the future, or none, is refused. */
export async function requireRecentAuth(sessionId: string): Promise<void> {
  const res = (await pool.query(
    'SELECT extract(epoch FROM (now() - recent_auth_at))::float8 AS age FROM public.session WHERE id = $1',
    [sessionId],
  )) as { rows: { age: number | null }[] };
  const age = res.rows[0]?.age;
  if (age == null || age < 0 || age > WINDOW_SECONDS) {
    throw new APIError('FORBIDDEN', { code: 'step_up_required', message: 'step_up_required' });
  }
}

const ABSOLUTE_CAP_MS = 30 * 86_400_000;

/** C-02: 30 days absolute, whatever BetterAuth's sliding expiry says (S14). */
export const cappedOut = (createdAt: Date | string | number): boolean => new Date(createdAt).getTime() + ABSOLUTE_CAP_MS <= Date.now();
