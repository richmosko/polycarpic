// POLY-150 D6 (b): the lock refusal to a held sign-in says how long the pause is, in three bands and never a time (SECURITY S14).
// An after-hook on the two verify paths. It acts only on BetterAuth's own lock refusal, only with no session on the request, and
// only for a hold read through BetterAuth's signed-cookie check (an unsigned or wrongly signed value is no hold) whose verification
// row is live. Every other case leaves BetterAuth's answer exactly as it was.
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';

export type PausedFor = 'under_an_hour' | 'a_few_hours' | 'up_to_a_day';

/** Under 60 minutes, under 6 hours, or longer. */
export const bandOf = (msLeft: number): PausedFor => (msLeft < 3_600_000 ? 'under_an_hour' : msLeft < 21_600_000 ? 'a_few_hours' : 'up_to_a_day');

export const lockBand = createAuthMiddleware(async (ctx) => {
  const returned = ctx.context.returned as { body?: { code?: string; message?: string }; statusCode?: number } | undefined;
  if (!(returned instanceof APIError) || returned.body?.code !== 'ACCOUNT_TEMPORARILY_LOCKED') return;
  if (await getSessionFromCtx(ctx).catch(() => null)) return;
  const cookie = ctx.context.createAuthCookie('two_factor');
  const key = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!key) return;
  const hold = await ctx.context.internalAdapter.findVerificationValue(key);
  // A dead hold gets no band. (BetterAuth checks the lock before the hold's expiry and an after-hook cannot change the status, so the answer stays its 429.)
  if (!hold || new Date(hold.expiresAt).getTime() <= Date.now()) return;
  const rows = (await ctx.context.adapter.findMany({ model: 'twoFactor', where: [{ field: 'userId', value: hold.value }] })) as { verified?: boolean; lockedUntil?: Date | string | null }[];
  const until = rows.filter((r) => r.verified && r.lockedUntil).map((r) => new Date(r.lockedUntil!).getTime()).sort((a, b) => b - a)[0];
  if (until === undefined || until <= Date.now()) return;
  throw new APIError('TOO_MANY_REQUESTS', { ...returned.body, pausedFor: bandOf(until - Date.now()) });
});

/** The hook entry for the second-step anchor plugin (cookieLifetime must stay last, and its hooks are pinned). */
export const lockBandHook = {
  matcher: (c: { path?: string }) => c.path === '/two-factor/verify-totp' || c.path === '/two-factor/verify-backup-code',
  handler: lockBand,
};
