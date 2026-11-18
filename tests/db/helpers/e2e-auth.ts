// The Playwright seed's one use of BetterAuth (apps/web/tests/e2e/serve.ts). Web holds no BetterAuth (POLY-152 R1.8), so the in-process
// password hash and sign-in live here, in repo-level test helpers, built from the same exported configuration the service uses.
// POLY-153 R10: signIn goes through handleAuthRequest on the poly_auth pool, as the service does, so the handle plugin issues the
// handle and inserts its app.session_handle row in the sign-in transaction. auth.api.signInEmail bypasses handleAuthRequest and runs
// outside any transaction of ours, so it is not used.
import { authOptions, createAuth, handleAuthRequest } from '../../../packages/auth/src/index.ts';
import { close, configure } from '../../../packages/db/src/index.ts';
import { dbEnv } from './api.ts';

export async function e2eAuth(db: string, origin: string, secret: string) {
  configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db) });
  const auth = await createAuth(authOptions({ secret, baseURL: origin, tlsMode: 'private-ca', requireClientIp: false, sendMagicLink: async () => {} }));
  return {
    hash: async (password: string): Promise<string> => (await auth.$context).password.hash(password),
    /** POST /api/auth/sign-in/email through handleAuthRequest; the Response carries both Set-Cookie lines. */
    signIn: (email: string, password: string): Promise<Response> =>
      handleAuthRequest(new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ email, password }),
      }), auth),
    close,
  };
}

export type StorageCookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax' | 'Strict' | 'None' };
/** Playwright storageState cookies from a response's Set-Cookie lines, each with its own Path (R10): no hard-coded '/'. */
export function storageCookies(res: Response, domain = 'localhost'): StorageCookie[] {
  return res.headers.getSetCookie().map((c) => {
    const [pair = '', ...attrs] = c.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k.toLowerCase()}=`))?.slice(k.length + 1);
    const has = (k: string) => attrs.some((a) => a.toLowerCase() === k.toLowerCase());
    return {
      name: pair.slice(0, eq), value: pair.slice(eq + 1), domain, path: attr('path') ?? '/', expires: -1,
      httpOnly: has('HttpOnly'), secure: has('Secure'), sameSite: 'Lax' as const,
    };
  });
}
