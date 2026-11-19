// The session cookie lives to the 30-day cap (POLY-152 R7). BetterAuth sets it with Max-Age = expiresIn (7 days); the row, not the
// cookie, is the idle bound, so this plugin rewrites every session-token Set-Cookie to the seconds left until created_at + 30 days.
// Measured against 1.7.18: an after-hook sees ctx.context.responseHeaders and ctx.context.newSession, and an in-place rewrite of the
// headers reaches the client. The matcher accepts every path: widenTwoFactorMatcher counts after-hooks that accept /sign-in/email
// and reject its sentinel path, so a path-specific matcher would make startup throw. The path test is not needed: newSession is set
// only where a session was issued.
import { handleAfter } from './session-handle.ts';

const CAP_MS = 30 * 86_400_000;

interface HookCtx {
  context?: {
    responseHeaders?: Headers;
    newSession?: { session?: { createdAt?: Date | string | number } } | null;
    authCookies?: { sessionToken?: { name?: string } };
  };
}

export async function lifetimeAfter(ctx: HookCtx): Promise<Record<string, never>> {
  const rh = ctx?.context?.responseHeaders;
  const created = ctx?.context?.newSession?.session?.createdAt;
  const name = ctx?.context?.authCookies?.sessionToken?.name;
  if (!rh || created === undefined || !name) return {};
  const cookies = rh.getSetCookie();
  if (!cookies.some((c) => c.startsWith(`${name}=`))) return {};
  const left = Math.max(0, Math.floor((new Date(created).getTime() + CAP_MS - Date.now()) / 1000));
  rh.delete('set-cookie');
  for (const c of cookies) {
    // A cookie set without Max-Age (rememberMe false) and a clearing cookie (Max-Age=0) are left as BetterAuth wrote them.
    const m = c.startsWith(`${name}=`) ? /;\s*Max-Age=(\d+)/i.exec(c) : null;
    rh.append('set-cookie', m && Number(m[1]) > 0 ? c.replace(/(;\s*Max-Age=)\d+/i, `$1${left}`) : c);
  }
  // BetterAuth reads .headers and .response from an after-hook's result.
  return {};
}

export function cookieLifetime() {
  return {
    id: 'cookie-lifetime',
    hooks: {
      after: [
        { matcher: () => true, handler: lifetimeAfter },
        { matcher: () => true, handler: handleAfter }, // POLY-153 R5.1: after the lifetime hook, so it copies the capped Max-Age
      ],
    },
  } as const;
}
