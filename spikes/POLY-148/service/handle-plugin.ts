// Option 1 of POLY-145 comparison.md §7 point 1: a second random cookie, only sha256(handle) in app.session_handle.
// A plugin after-hook, listed last in plugins[]: dispatch runs options.hooks.after first, then plugin hooks in array order, so
// this one sees the FINAL ctx.context.newSession, after twoFactor's hold (and our passkey hold) have deleted a held session and nulled it.
// It writes through the routing pool, so inside a request transaction the row is in that transaction (it commits or rolls back with the session).
import { createHash, randomBytes } from 'node:crypto';

interface Input {
  createAuthMiddleware: (fn: (ctx: any) => Promise<unknown>) => unknown;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  cookieName: string;
  option: string;
}

export function handlePlugin({ createAuthMiddleware, query, cookieName }: Input) {
  const attrs = (maxAge: number) => ({ secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge });
  return {
    id: 'poly148-handle',
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path === '/sign-out') {
              ctx.setCookie(cookieName, '', attrs(0));
              return;
            }
            const fresh = ctx.context.newSession;
            if (!fresh) return;
            const sessionId = fresh.session.id as string;
            // setSessionCookie also runs on a refresh and on a user update, with the same session: no new handle then.
            const have = await query('SELECT 1 FROM app.session_handle WHERE session_id = $1', [sessionId]);
            if (have.rows.length) return;
            const handle = randomBytes(32).toString('base64url');
            await query('INSERT INTO app.session_handle (session_id, handle_hash) VALUES ($1, $2)', [sessionId, createHash('sha256').update(handle, 'utf8').digest()]);
            ctx.setCookie(cookieName, handle, attrs(ctx.context.sessionConfig.expiresIn));
          }),
        },
      ],
    },
  };
}
