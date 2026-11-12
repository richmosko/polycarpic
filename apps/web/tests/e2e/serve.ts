// The Playwright webServer command (POLY-86 ruling R10). It stands in for a globalSetup, because Playwright starts the web
// server before globalSetup runs and the server needs its database at start. Order: a disposable Postgres (the db battery's
// harness), the migrated schema, ONE user seeded here and signed in through BetterAuth in this process, the browser state
// written to tests/e2e/.auth/user.json, then `vite build` and `vite preview` with the configuration passed as env.
// Nothing in apps/web or packages/auth reads a variable for this: the invitation check is untouched (seceng S18).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneMigrated, dbEnv, setRolePasswords } from '../../../../tests/db/helpers/api.ts';
import { ensureBootstrapLockDir, releaseBootstrapLockDir } from '../../../../tests/db/helpers/bootstrap-lock.ts';
import { must, startServer } from '../../../../tests/db/helpers/pg.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4173);
const origin = `http://localhost:${port}`;
const NAME = 'Ada Lovelace';
const EMAIL = 'ada@e2e.test';
const PASSWORD = 'e2e correct horse battery staple';

const { server, stop: stopServer } = startServer();
process.env.POLY_TEST_SERVER = JSON.stringify(server);
// Outside vitest's globalSetup, so this entry point makes the bootstrap lock directory itself (the lock throws when it is unset).
ensureBootstrapLockDir();
const stop = () => { stopServer(); releaseBootstrapLockDir(); };
setRolePasswords();
const db = cloneMigrated();

const secretFile = join(mkdtempSync(join(tmpdir(), 'poly86-e2e-')), 'auth_secret');
writeFileSync(secretFile, 'e2e-auth-secret-0123456789abcdef0123456789abcdef\n');
const appEnv = {
  ...dbEnv('poly_app', db),
  AUTH_SECRET_FILE: secretFile,
  APP_ENV: 'development',
  TLS_MODE: 'private-ca',
  PUBLIC_ORIGIN: origin,
};
Object.assign(process.env, appEnv);

// In-process sign-in through the same exported configuration the app uses.
const { authOptions, createAuth } = await import('@poly/auth');
const { close } = await import('@poly/db');
const auth = await createAuth(authOptions({ secret: 'e2e-auth-secret-0123456789abcdef0123456789abcdef', baseURL: origin, tlsMode: 'private-ca', requireClientIp: false, sendMagicLink: async () => {} }));
const hash = await (await auth.$context).password.hash(PASSWORD);
const id = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${NAME}', '${EMAIL}', true) RETURNING id`, db).rows[0]![0];
must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${id}', 'credential', '${id}', '${hash}')`, db);
const signed = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
const cookies = signed.headers.getSetCookie().map((c: string) => {
  const [pair = ''] = c.split(';');
  const eq = pair.indexOf('=');
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
});
// A second session and a step-up stamp (what POLY-89's definers will write), so the Sessions spec can revoke another session.
await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
must(`UPDATE public.session SET recent_auth_at = now() WHERE user_id = '${id}'`, db);
mkdirSync(join(here, '.auth'), { recursive: true });
writeFileSync(join(here, '.auth', 'user.json'), JSON.stringify({ cookies, origins: [] }));
await close();

const web = join(here, '..', '..');
const run = (args: string[]) => spawn('pnpm', ['exec', ...args], { cwd: web, stdio: 'inherit', env: { ...process.env, ...appEnv } });
const build = run(['vite', 'build']);
build.on('exit', (code) => {
  if (code !== 0) { stop(); process.exit(code ?? 1); }
  const preview = run(['vite', 'preview', '--port', String(port), '--strictPort']);
  const done = () => { preview.kill(); stop(); process.exit(0); };
  process.on('SIGTERM', done);
  process.on('SIGINT', done);
  preview.on('exit', () => { stop(); process.exit(0); });
});
