// The Playwright webServer command (POLY-86 ruling R10). It stands in for a globalSetup, because Playwright starts the web
// server before globalSetup runs and the server needs its database at start. Order: a disposable Postgres (the db battery's
// harness), the migrated schema, ONE user seeded here and signed in through BetterAuth in this process, the browser state
// written to tests/e2e/.auth/user.json, then `vite build` and `vite preview` with the configuration passed as env.
// Nothing in apps/web or packages/auth reads a variable for this: the invitation check is untouched (seceng S18).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const { e2eAuth, storageCookies, cookieHeader } = await import('../../../../tests/db/helpers/e2e-auth.ts');
const { totp } = await import('../../../../tests/db/helpers/totp.ts');
const { softAuthenticator } = await import('../../../../tests/db/helpers/webauthn.ts');
// The seed's own delivery stand-in (POLY-150 R4): the in-process service sends second-step codes here; the running service's stand-in is auth-entry.ts.
const sent: { email: string; code: string }[] = [];
const auth = await e2eAuth(db, origin, 'e2e-auth-secret-0123456789abcdef0123456789abcdef', async (m) => { sent.push(m); });
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
// A manager with no second step, seated by a superuser statement (R1.3 as amended).
const addManager = (name: string, email: string): string => {
  const uid = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${name}', '${email}', true) RETURNING id`, db).rows[0]![0]!;
  must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${uid}', 'credential', '${uid}', '${hash}')`, db);
  must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${SHARED}', '${uid}', 'manager')`, db);
  return uid;
};
addManager('Manny Manager', 'manager@e2e.test');
mkdirSync(join(here, '.auth'), { recursive: true });
// A fresh run: no ledger, no outbox, no flow records from the last one.
for (const f of ['limiter.json', 'outbox.jsonl', 'flows.jsonl', 'slot-waits.jsonl', 'slot-calls.jsonl']) writeFileSync(join(here, '.auth', f), f === 'limiter.json' ? '{}' : '', { mode: 0o600 });
const writeSecret = (name: string, v: unknown) => writeFileSync(join(here, '.auth', name), JSON.stringify(v), { mode: 0o600 });
const state = (res: Response) => ({ cookies: storageCookies(res), origins: [] });
const need = (r: Response, what: string): Response => { if (!r.ok) { stop(); throw new Error(`seed: ${what} answered ${r.status}`); } return r; };

// POLY-150 R9: one user per state-changing spec, so specs share no state. Enid, Pia, Lou: managers with no second step, signed in here
// (the sign-in limiter is 5 a minute for one address across the suite, so a spec that is not about signing in starts from a state file).
for (const [key, name] of [['enid', 'Enid Enrol'], ['pia', 'Pia Passkey'], ['lou', 'Lou Order'], ['rae', 'Rae Recover']] as const) {
  addManager(name, `${key}@e2e.test`);
  writeFileSync(join(here, '.auth', `${key}.json`), JSON.stringify(state(need(await auth.signIn(`${key}@e2e.test`, PASSWORD), `${key} sign-in`))));
}
// A TOTP factor enrolled through the real handler: password, emailed code (the in-process stand-in), enable, verify.
async function enrolTotp(email: string): Promise<{ secret: string; backupCodes: string[]; verified: Response }> {
  const cookie = cookieHeader('', need(await auth.signIn(email, PASSWORD), `${email} sign-in`));
  sent.length = 0;
  need(await auth.call('/second-step/send-code', { password: PASSWORD }, cookie), 'send-code');
  const code = sent.find((m) => m.email.toLowerCase() === email)!.code;
  need(await auth.call('/second-step/confirm-code', { code }, cookie), 'confirm-code');
  const en = need(await auth.call('/two-factor/enable', { password: PASSWORD }, cookie), 'enable');
  const j = (await en.json()) as { totpURI: string; backupCodes: string[] };
  const secret = new URL(j.totpURI).searchParams.get('secret')!;
  return { secret, backupCodes: j.backupCodes, verified: need(await auth.call('/two-factor/verify-totp', { code: totp(secret) }, cookie), 'verify-totp') };
}
// Tess: a manager with TOTP (specs 3, 4). Her secret and backup codes go to .auth/ for the spec's totp() helper.
addManager('Tess Totp', 'tess@e2e.test');
const tess = await enrolTotp('tess@e2e.test');
writeSecret('tess.json', { email: 'tess@e2e.test', password: PASSWORD, secret: tess.secret, backupCodes: tess.backupCodes });
// Kay: a manager with a passkey only (spec 5). The credential is made by the software authenticator for THIS origin; its key goes to .auth/
// so the spec can load the same credential into Chromium's virtual authenticator.
const kayId = addManager('Kay Passkey', 'kay@e2e.test');
const kayKey = softAuthenticator(origin);
must(`INSERT INTO public.passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('Kay laptop', '${kayKey.publicKey}', '${kayId}', '${kayKey.credentialId}', 0, 'singleDevice', false, 'internal')`, db);
must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${kayId}'`, db);
writeSecret('kay.json', { email: 'kay@e2e.test', password: PASSWORD, credentialId: kayKey.credentialId, privateKey: kayKey.privateKeyPkcs8, userHandle: Buffer.from(kayId).toString('base64'), rpId: new URL(origin).hostname });
// Una: TOTP and a passkey whose NAME is script-like (RC4), signed in, with a step-up stamp older than 5 minutes (specs 8, 9; R6's interim dialog).
const unaId = addManager('Una Both', 'una@e2e.test');
const una = await enrolTotp('una@e2e.test');
const unaKey = softAuthenticator(origin);
const XSS = '<img src=x onerror=window.__xss=1>';
must(`INSERT INTO public.passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${XSS}', '${unaKey.publicKey}', '${unaId}', '${unaKey.credentialId}', 0, 'singleDevice', false, 'internal')`, db);
must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.session SET recent_auth_at = now() - interval '1 hour' WHERE user_id = '${unaId}'; COMMIT;`, db);
writeFileSync(join(here, '.auth', 'una.json'), JSON.stringify(state(una.verified)));
writeSecret('una-secrets.json', { email: 'una@e2e.test', secret: una.secret, backupCodes: una.backupCodes, credentialId: unaKey.credentialId, publicKey: unaKey.publicKey, passkeyName: XSS });
writeSecret('seeds.json', { password: PASSWORD, forgedAddress: '198.51.100.9', testServer: server, db }); // the superuser read the address spec (R8) and the expiry checks use
writeFileSync(join(here, '.auth', 'user.json'), JSON.stringify({ cookies, origins: [] }));
await close();
const web = join(here, '..', '..');
// Web's and the service's output is teed to .auth/web.log and .auth/auth.log so a spec can assert no secret reached a log line (R10).
const tee = (child: ReturnType<typeof spawn>, file: string) => {
  const path = join(here, '.auth', file);
  writeFileSync(path, '', { mode: 0o600 });
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) stream?.on('data', (d: Buffer) => { appendFileSync(path, d); out.write(d); });
  return child;
};
const run = (args: string[]) => tee(spawn('pnpm', ['exec', ...args], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...appEnv } }), 'web.log');
// The sign-in service starts before `vite preview` and is waited for on /api/auth/ok (R1.7).
// POLY-150 R4: through auth-entry.ts, the real service with the delivery stand-in as its one injected dependency.
const service = tee(spawn('node', [join(here, '..', '..', '..', '..', 'tests', 'db', 'helpers', 'auth-entry.ts')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...authEnv } }), 'auth.log');
for (let i = 0; ; i++) {
  if (i > 100) { service.kill(); stop(); throw new Error('the sign-in service did not start'); }
  if (await fetch(`http://127.0.0.1:${authPort}/api/auth/ok`, { headers: { 'x-forwarded-for': '127.0.0.1' } }).then((r) => r.ok, () => false)) break;
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
