// The second-step hold on the three credential paths (POLY-86 ruling M1; seceng S9, S10). twoFactor's own after-hook holds
// /sign-in/email only. TOTP users: its matcher is widened to SIGN_IN_PATHS. Passkey-only users (twoFactorEnabled false,
// secondStepAt set): our after-hook deletes the new session and answers secondStepRequired.
import { createAuthMiddleware } from 'better-auth/api';
import { SIGN_IN_PATHS } from './route-policy.ts';

type Matcher = (ctx: { path?: string }) => boolean;
interface Hook {
  matcher: Matcher;
  handler: unknown;
}
interface Plugin {
  id: string;
  hooks?: { after?: Hook[] };
}

const SENTINEL = '/__poly_sentinel__';

/** Widen the one twoFactor after-hook, found by behaviour. Throws unless exactly one hook is the sign-in hold. */
export function widenTwoFactorMatcher(plugins: readonly unknown[] | undefined): void {
  const hooks = ((plugins as Plugin[] | undefined) ?? [])
    .flatMap((p) => p.hooks?.after ?? [])
    .filter((h) => typeof h.matcher === 'function' && h.matcher({ path: '/sign-in/email' }) && !h.matcher({ path: SENTINEL }));
  if (hooks.length !== 1) throw new Error(`second step: expected exactly one sign-in after-hook, found ${hooks.length}`);
  const hook = hooks[0]!;
  const original = hook.matcher;
  hook.matcher = (ctx) => original(ctx) || SIGN_IN_PATHS.has(ctx.path ?? '');
}

/** Our after-hook for the user the plugin does not hold: enrolled with a passkey and no TOTP. */
export const passkeyOnlyHold = createAuthMiddleware(async (ctx) => {
  if (!SIGN_IN_PATHS.has(ctx.path)) return;
  const fresh = ctx.context.newSession;
  if (!fresh) return;
  const user = fresh.user as { twoFactorEnabled?: boolean | null; secondStepAt?: Date | string | null };
  if (user.twoFactorEnabled || !user.secondStepAt) return;
  await ctx.context.internalAdapter.deleteSession(fresh.session.token);
  // the session cookie BetterAuth already queued must not reach the browser
  const queued = ctx.context.responseHeaders;
  if (queued) {
    const keep = queued.getSetCookie().filter((c) => !c.startsWith(`${ctx.context.authCookies.sessionToken.name}=`));
    queued.delete('set-cookie');
    for (const c of keep) queued.append('set-cookie', c);
  }
  ctx.setCookie(ctx.context.authCookies.sessionToken.name, '', { ...ctx.context.authCookies.sessionToken.attributes, maxAge: 0 });
  ctx.context.newSession = null;
  if (ctx.method === 'GET') throw ctx.redirect('/sign-in/second-step');
  return ctx.json({ secondStepRequired: 'passkey' });
});
