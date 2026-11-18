// The Playwright seed's one use of BetterAuth (apps/web/tests/e2e/serve.ts). Web holds no BetterAuth (POLY-152 R1.8), so the in-process
// password hash and sign-in live here, in repo-level test helpers, built from the same exported configuration the service uses.
import { authOptions, createAuth } from '../../../packages/auth/src/index.ts';
import { close, configure } from '../../../packages/db/src/index.ts';
import { dbEnv } from './api.ts';

export async function e2eAuth(db: string, origin: string, secret: string) {
  configure({ app: dbEnv('poly_app', db), auth: dbEnv('poly_auth', db) });
  const auth = await createAuth(authOptions({ secret, baseURL: origin, tlsMode: 'private-ca', requireClientIp: false, sendMagicLink: async () => {} }));
  return {
    hash: async (password: string): Promise<string> => (await auth.$context).password.hash(password),
    signIn: (email: string, password: string) => auth.api.signInEmail({ body: { email, password }, returnHeaders: true }),
    close,
  };
}
