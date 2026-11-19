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
import { asUserSql } from '../../../../tests/db/helpers/marker.ts';
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
const authPort = port + 1000; // the sign-in service's one listener (POLY-153 R9: the internal /session listener is gone)
const common = { APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: origin };
// Web holds no auth secret (R1.3) and no address of the service's internal listener (POLY-153 R9).
const appEnv = { ...dbEnv('poly_app', db), ...common, AUTH_PUBLIC_PORT: String(authPort) };
const authEnv = { ...dbEnv('poly_auth', db), ...common, AUTH_SECRET_FILE: secretFile, AUTH_PUBLIC_PORT: String(authPort) };
Object.assign(process.env, appEnv);

// In-process sign-in through the same exported configuration the app uses.
const { e2eAuth, storageCookies } = await import('../../../../tests/db/helpers/e2e-auth.ts');
const auth = await e2eAuth(db, origin, 'e2e-auth-secret-0123456789abcdef0123456789abcdef');
const { close } = auth;
const hash = await auth.hash(PASSWORD);
const id = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${NAME}', '${EMAIL}', true) RETURNING id`, db).rows[0]![0];
must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${id}', 'credential', '${id}', '${hash}')`, db);
const signed = await auth.signIn(EMAIL, PASSWORD);
// Each cookie keeps its own Path: __Secure-better-auth.session_token at /api/auth, __Host-poly_handle at / (POLY-153 R10).
const cookies = storageCookies(signed);
if (!cookies.some((c) => c.name === '__Host-poly_handle') || !cookies.some((c) => c.name.startsWith('__Secure-better-auth.') && c.path === '/api/auth')) { stop(); throw new Error('the seeded sign-in did not set both cookies'); }
// A second session and a step-up stamp (what POLY-89's definers will write), so the Sessions spec can end another session.
await auth.signIn(EMAIL, PASSWORD);
must(`UPDATE public.session SET recent_auth_at = now() WHERE user_id = '${id}'`, db);
// POLY-89 (R7): a manager with no second step, which is the state `polycarpic cli user reset-mfa` leaves behind. The entity belongs to an
// enrolled owner (a verified factor and the flag as superuser, then the Business as poly_app under the marker, as the db fixtures do).
const OWNER_ID = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('Grace Owner', 'owner@e2e.test', true) RETURNING id`, db).rows[0]![0]!;
must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${OWNER_ID}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${OWNER_ID}'; COMMIT;`, db);
const SHARED = must(`BEGIN; ${asUserSql(OWNER_ID, db)}
  INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'E2E Shared', 'business_pass_through');
  SELECT id FROM public.entity WHERE name = 'E2E Shared'; COMMIT;`, db, { role: 'poly_app' }).rows.at(-1)![0]!;
const MGR_ID = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('Manny Manager', 'manager@e2e.test', true) RETURNING id`, db).rows[0]![0]!;
must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${MGR_ID}', 'credential', '${MGR_ID}', '${hash}')`, db);
// A superuser seat passes every guard (R1.3 as amended), so the manager is seated with no second step: the state reset-mfa leaves behind.
must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${SHARED}', '${MGR_ID}', 'manager')`, db);
mkdirSync(join(here, '.auth'), { recursive: true });
writeFileSync(join(here, '.auth', 'user.json'), JSON.stringify({ cookies, origins: [] }));
await close();
const web = join(here, '..', '..');
const run = (args: string[]) => spawn('pnpm', ['exec', ...args], { cwd: web, stdio: 'inherit', env: { ...process.env, ...appEnv } });
// The sign-in service starts before `vite preview` and is waited for on /api/auth/ok (R1.7).
const service = spawn('node', [join(here, '..', '..', '..', 'auth', 'src', 'main.ts')], { stdio: 'inherit', env: { ...process.env, ...authEnv } });
for (let i = 0; ; i++) {
  if (i > 100) { service.kill(); stop(); throw new Error('the sign-in service did not start'); }
  if (await fetch(`http://127.0.0.1:${authPort}/api/auth/ok`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 200));
}
const build = run(['vite', 'build']);
build.on('exit', (code) => {
  if (code !== 0) { service.kill(); stop(); process.exit(code ?? 1); }
  const preview = run(['vite', 'preview', '--port', String(port), '--strictPort']);
  const done = () => { preview.kill(); service.kill(); stop(); process.exit(0); };
  process.on('SIGTERM', done);
  process.on('SIGINT', done);
  preview.on('exit', () => { service.kill(); stop(); process.exit(0); });
});
