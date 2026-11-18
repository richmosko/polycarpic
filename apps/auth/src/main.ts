// The sign-in service entrypoint (POLY-152 R1): `polycarpic auth` runs this; `polycarpic auth check-config` validates and exits.
// Order: configuration (refuse before any pool exists), the role and schema checks, then BetterAuth, then the two listeners.
// startAuthService(env) is the testable core; the process wrapper at the bottom runs only when this file is the entry point.
import { pathToFileURL } from 'node:url';
import { authOptions, createAuth } from '@poly/auth';
import { ConfigError, loadConfig, runCheckConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { assertRole, assertSchemaNotBehind, closePools, configureAuthPool } from '@poly/db/startup';
import { internalBind, publicPort } from './bind.ts';
import { closeServer, listen, listener } from './http.ts';
import { handleInternal } from './internal.ts';
import { handlePublic } from './public.ts';

export interface AuthService {
  publicOrigin: string;
  internalOrigin: string;
  close(): Promise<void>;
}

/** Starts the service from `env`. Throws (and starts nothing) on a config fault, the wrong database role, a schema behind the image, or an unreadable secret. */
export async function startAuthService(env: Record<string, string | undefined> = process.env): Promise<AuthService> {
  const log = createLogger({ service: 'auth' });
  const config = loadConfig('auth', env);
  const bind = internalBind(env);
  const port = publicPort(env);
  const secret = config.secrets.AUTH_SECRET_FILE;
  if (!secret) throw new ConfigError([{ var: 'AUTH_SECRET_FILE', fault: 'not_set', message: 'AUTH_SECRET_FILE is not set' }]);
  configureAuthPool(env);
  try {
    await assertRole('poly_auth');
    await assertSchemaNotBehind('auth');
  } catch (e) {
    await closePools();
    throw e;
  }
  const auth = await createAuth(
    authOptions({
      secret: secret.reveal(),
      baseURL: config.publicOrigin,
      tlsMode: config.tlsMode,
      requireClientIp: config.appEnv !== 'development',
      // Providers arrive with POLY-88; the mailer with POLY-137. Until then a magic link answers 503.
      sendMagicLink: async () => {
        throw new Error('mailer not configured');
      },
      sendSecondStepCode: async () => {
        throw new Error('mailer not configured');
      },
    }),
  );
  const onError = (e: unknown) => log.error('auth.request_failed', { outcome: 'error', err: e });
  const pub = listener(config.publicOrigin, (r) => handlePublic(r, auth), onError);
  const internal = listener('http://auth.internal', (r) => handleInternal(r, auth), onError);
  try {
    await listen(pub, { host: env.AUTH_PUBLIC_HOST || '0.0.0.0', port });
    await listen(internal, bind);
  } catch (e) {
    await Promise.all([closeServer(pub), closeServer(internal)]);
    await closePools();
    throw e;
  }
  const publicOrigin = `http://127.0.0.1:${port}`;
  const internalOrigin = 'path' in bind ? `unix:${bind.path}` : `http://${bind.host.includes(':') ? `[${bind.host}]` : bind.host}:${bind.port}`;
  log.info('auth.started', { outcome: 'ok', ...(config.imageRevision ? { commit: config.imageRevision } : {}) });
  return {
    publicOrigin,
    internalOrigin,
    close: async () => {
      await Promise.all([closeServer(pub), closeServer(internal)]);
      await closePools();
    },
  };
}

const crash = (log: ReturnType<typeof createLogger>) => (e: unknown): never => {
  log.fatal('process.crash', { outcome: 'error', err: e });
  process.exit(1);
};

async function cli(): Promise<void> {
  const log = createLogger({ service: 'auth' });
  process.on('uncaughtException', crash(log));
  process.on('unhandledRejection', crash(log));
  if (process.argv[2] === 'check-config') process.exit(runCheckConfig('auth'));
  try {
    const svc = await startAuthService(process.env);
    const stop = () => void svc.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const p of e.problems) log.error('config.refused', { var: p.var, fault: p.fault, outcome: 'refused' });
    } else {
      log.fatal('auth.refused', { outcome: 'refused', err: e });
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli();
