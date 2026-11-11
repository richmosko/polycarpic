// Builds the app's one BetterAuth instance from the loaded configuration (POLY-86). Nothing here relaxes a check for tests:
// the e2e user is seeded in the test process (seceng S18).
import { authOptions, createAuth, setDefaultAuth } from '@poly/auth';
import { loadConfig } from '@poly/config';

let started = false;

export async function startAuth(): Promise<void> {
  const { dev } = await import('$app/env'); // dynamic: unit tests load this module without Kit's runtime
  if (started) return;
  started = true;
  const config = loadConfig('web');
  const secret = config.secrets.AUTH_SECRET_FILE;
  if (!secret) throw new Error('AUTH_SECRET_FILE is required');
  setDefaultAuth(
    createAuth(
      authOptions({
        secret: secret.reveal(),
        baseURL: config.publicOrigin,
        tlsMode: config.tlsMode,
        requireClientIp: !dev,
        // Providers arrive with POLY-88; the mailer with the Resend follow-up. Until then a magic link answers 503.
        sendMagicLink: async () => {
          throw new Error('mailer not configured');
        },
      }),
    ),
  );
}
