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
// A second session, so the Sessions spec can end another session. The step-up stamp it needs is NOT written here: this seed runs before `vite build`,
// and a slow build outlived the 5-minute window. The spec writes it (support.ts stampStepUp) right before its action (POLY-137 R8).
await auth.signIn(EMAIL, PASSWORD);
// POLY-89 (R7): a manager with no second step, which is the state `polycarpic cli user reset-mfa` leaves behind. The entity belongs to an
// enrolled owner (a verified factor and the flag as superuser, then the Business as poly_app under the marker, as the db fixtures do).
const OWNER_ID = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('Grace Owner', 'owner@e2e.test', true) RETURNING id`, db).rows[0]![0]!;
must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${OWNER_ID}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${OWNER_ID}'; COMMIT;`, db);
const SHARED = must(`BEGIN; ${asUserSql(OWNER_ID, db)}
  INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'Shared Co', 'business_pass_through');
  SELECT id FROM public.entity WHERE name = 'Shared Co'; COMMIT;`, db, { role: 'poly_app' }).rows.at(-1)![0]!;
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
writeSecret('db.json', { db, server }); // the database and server the specs' own helpers reach (support.ts stampStepUp)
const state = (res: Response) => ({ cookies: storageCookies(res), origins: [] });
const need = (r: Response, what: string): Response => { if (!r.ok) { stop(); throw new Error(`seed: ${what} answered ${r.status}`); } return r; };

// POLY-150 R9: one user per state-changing spec, so specs share no state. Enid, Pia, Lou: managers with no second step, signed in here
// (the sign-in limiter is 5 a minute for one address across the suite, so a spec that is not about signing in starts from a state file).
// Pia and Vic hold no manager seat, so the gate never holds them (R9 spec 2 has Pia open /entities and see the message; a held manager is redirected away from it).
const addPlain = (name: string, email: string): void => {
  const uid = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${name}', '${email}', true) RETURNING id`, db).rows[0]![0]!;
  must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${uid}', 'credential', '${uid}', '${hash}')`, db);
};
for (const [key, name, held] of [['enid', 'Enid Enrol', true], ['pia', 'Pia Passkey', false], ['vic', 'Vic Viewer', false], ['lou', 'Lou Order', true]] as const) {
  if (held) addManager(name, `${key}@e2e.test`); else addPlain(name, `${key}@e2e.test`);
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
// Sven: a manager with TOTP for the safeNext spec (POLY-161 R13), so no other spec's wrong-code count or replay window is shared with it.
addManager('Sven Safenext', 'safe@e2e.test');
const sven = await enrolTotp('safe@e2e.test');
writeSecret('safe.json', { email: 'safe@e2e.test', password: PASSWORD, secret: sven.secret, backupCodes: sven.backupCodes });
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
// Confirm it's you (Addendum 3 T10): managers with an authenticator app AND a passkey, signed in, with a step-up stamp older than 5 minutes.
// Rex re-checks by code (a wrong code first); Kit re-checks by passkey through Chromium's virtual authenticator (his credential is exported to .auth/).
const reauthUsers: Record<string, unknown> = {};
for (const key of ['rex', 'kit'] as const) {
  const email = `${key}@e2e.test`;
  const id = addManager(`${key[0]!.toUpperCase()}${key.slice(1)} Recheck`, email);
  const f = await enrolTotp(email);
  const pk = softAuthenticator(origin);
  must(`INSERT INTO public.passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${key} key', '${pk.publicKey}', '${id}', '${pk.credentialId}', 0, 'singleDevice', false, 'internal')`, db);
  must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.session SET recent_auth_at = now() - interval '1 hour' WHERE user_id = '${id}'; COMMIT;`, db);
  writeFileSync(join(here, '.auth', `${key}.json`), JSON.stringify(state(f.verified)));
  reauthUsers[key] = { email, secret: f.secret, passkeyName: `${key} key`, credentialId: pk.credentialId, privateKey: pk.privateKeyPkcs8, userHandle: Buffer.from(id).toString('base64'), rpId: new URL(origin).hostname };
}
writeSecret('reauth-users.json', reauthUsers);
// Locked users for the lock-band checks (R7, D6 b): a TOTP factor whose lock has the given minutes left, set by a superuser statement in replica mode (the
// guard does not fire), one user per band plus one for the fallback (the spec removes the band from the response).
const lockUsers: Record<string, { email: string; secret: string }> = {};
for (const [key, minutes] of [['lock30', 30], ['lock120', 120], ['lock600', 600], ['lockfb', 30], ['lockexp', 30]] as const) {
  const email = `${key}@e2e.test`;
  const id = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${key}', '${email}', true) RETURNING id`, db).rows[0]![0]!;
  must(`INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${id}', 'credential', '${id}', '${hash}')`, db);
  const f = await enrolTotp(email);
  must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() + interval '${minutes} minutes' WHERE user_id = '${id}'; COMMIT;`, db);
  lockUsers[key] = { email, secret: f.secret };
}
writeSecret('lock-users.json', lockUsers);
writeSecret('seeds.json', { password: PASSWORD, forgedAddress: '198.51.100.9', sharedEntityId: SHARED, sharedEntityName: 'Shared Co', testServer: server, db }); // the superuser read the address spec (R8) and the expiry checks use
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
