// POLY-150d: the database and service half of the second-step screens (ruling R2, R3, R7, R8, R10; seceng RC1). Real Postgres, real handler.
// Titles end [red if: ...]. Red today: app.my_second_step() and migration 0018 do not exist; send-code has no 503, no sentTo; trustDevice and
// the missing client address are accepted; `Cache-Control: no-store` is not set. The browser half is apps/web/tests/e2e.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, jar, post, teardown, type Env } from './helpers/auth';
import { enrolTotp, heldSignIn, hasSessionCookie } from './helpers/auth-service';
import { dbEnv } from './helpers/api';
import { codeOf, fails, fixture, totp } from './helpers/second-step';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const mails: { email: string; code: string }[] = [];
const mailer = async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); };
let withMail: any;
let noMail: any;
beforeAll(async () => {
  e = await boot();
  withMail = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: mailer }), rateLimit: { enabled: false } });
  noMail = await e.mk();
});
afterAll(() => teardown(e));
const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const COLUMNS = ['second_step_at', 'totp_added_at', 'passkeys', 'challenge_expires_at', 'resend_available_at', 'grant_expires_at', 'needs_a_method', 'codes_paused'];

describe('R3 no mailer: send-code answers 503 mailer_unavailable first', () => {
  const body = (b: unknown, cookie: string) => post('/second-step/send-code', b, cookie);
  it('a right password, a wrong password, an empty body and no body all answer the same 503 {code: mailer_unavailable}, and no challenge is written [red if: the password is checked, a 403 is returned or the call counts before the 503]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, noMail);
    const seen: string[] = [];
    for (const b of [{ password: PW }, { password: 'not the password' }, {}, undefined]) {
      const r = await e.handle(body(b, cookie), noMail);
      expect(r.status, JSON.stringify(b)).toBe(503);
      expect((await json(r)).code).toBe('mailer_unavailable');
      seen.push(JSON.stringify(await json(r)));
    }
    expect(new Set(seen).size, 'one body for every caller').toBe(1);
    expect(e.count(`SELECT 1 FROM app.email_challenge WHERE user_id = '${u.id}'`)).toBe(0);
  });
  it('the 503 body carries no error string, no status number and no word about configuration [red if: the answer says why]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, noMail);
    const res = await e.handle(body({ password: PW }, cookie), noMail);
    expect(res.status).toBe(503);
    const text = JSON.stringify(await json(res));
    expect(text.replace('mailer_unavailable', '')).not.toMatch(/config|sendSecondStepCode|mailer|503|Error/i);
  });
  it('an unverified-email user and a session-less caller: 503 is first only after the session middleware (401 with no session) [red if: the route answers 503 to an anonymous caller]', async () => {
    const r = await e.handle(body({ password: PW }, ''), noMail);
    expect(r.status).toBe(401);
  });
});

describe('R3 with a mailer: sent and suppressed answer the same 200 {status, sentTo}', () => {
  it('sentTo is the masked current address, identical for the sent and the suppressed answer; the mailer ran only for the sent ones [red if: no sentTo, the address is whole, or a suppression is visible]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, withMail);
    mails.length = 0;
    const answers: any[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), withMail);
      expect(r.status).toBe(200);
      answers.push(await json(r));
    }
    expect(mails.filter((m) => m.email.toLowerCase() === u.email.toLowerCase()).length, 'the 3-in-15-minutes cap held').toBeLessThan(5);
    for (const a of answers) {
      expect(typeof a.sentTo).toBe('string');
      expect(a.sentTo).not.toBe(u.email);
      expect(a.sentTo).not.toContain(u.email.split('@')[0]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size, 'sent and suppressed are one answer').toBe(1);
  });
});

describe('R2 app.my_second_step()', () => {
  let fx: ReturnType<typeof fixture>;
  beforeAll(() => { fx = fixture(e.db, 150); });
  const read = async (userId: string, sessionId: string) => (await fx.marked('poly_app', userId, sessionId, (q) => q('SELECT * FROM app.my_second_step()'))).rows;
  const fresh = async (o: { enrolled?: boolean } = {}) => { const u = await fx.user(o); return { ...u, sid: fx.session(u.id, true) }; };

  it('catalog: owner poly_govern, SECURITY DEFINER, search_path empty, EXECUTE poly_app only [red if: the function is missing, owned wrongly or granted to PUBLIC or another role]', () => {
    const r = must(`SELECT pg_get_userbyid(proowner), prosecdef, array_to_string(proconfig, ','), (SELECT string_agg(grantee::regrole::text, ',' ORDER BY grantee::regrole::text) FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) WHERE privilege_type = 'EXECUTE' AND grantee <> proowner) FROM pg_proc WHERE oid = to_regprocedure('app.my_second_step()')`, e.db).rows[0];
    expect(r, 'app.my_second_step() exists').toBeTruthy();
    expect(r![0]).toBe('poly_govern');
    expect(r![1]).toBe('t');
    expect(r![2]).toMatch(/search_path=""/);
    expect(r![3]).toBe('poly_app');
  });
  it('returns exactly eight columns: no secret, backup codes, public key, credential id, code hash, attempt count or email (S16) [red if: a column is added or renamed]', () => {
    const cols = must(`SELECT unnest(proargnames) FROM pg_proc WHERE oid = to_regprocedure('app.my_second_step()')`, e.db).rows.map((x: any) => x[0]);
    expect(cols).toEqual(COLUMNS);
  });
  it('0018 adds two_factor.created_at timestamptz NOT NULL DEFAULT now(), and a row BetterAuth inserts without naming it gets a value [red if: the column or its default is missing]', () => {
    const r = must(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'two_factor' AND column_name = 'created_at'`, e.db).rows[0];
    expect(r, 'column exists').toBeTruthy();
    expect(r![0]).toBe('timestamp with time zone');
    expect(r![1]).toBe('NO');
    expect(r![2]).toMatch(/now\(\)/);
  });
  it('refused 42501 with no marker, with a poly_auth marker, and with no session behind the marker [red if: any caller reads another user\'s state]', async () => {
    const u = await fresh();
    const none = await fails(fx.marked('poly_app', null, null, (q) => q('SELECT * FROM app.my_second_step()')));
    expect(none, 'no marker').not.toBeNull();
    expect(codeOf(none)).toBe('42501');
    const auth = await fails(fx.marked('poly_auth', u.id, u.sid, (q) => q('SELECT * FROM app.my_second_step()')));
    expect(codeOf(auth), 'poly_auth holds no EXECUTE').toBe('42501');
  });
  it('a fresh user: nothing set, no methods, no challenge, no grant, not paused, no method needed [red if: a default is wrong]', async () => {
    const u = await fresh();
    const rows = await read(u.id, u.sid);
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(Object.keys(r)).toEqual(COLUMNS);
    expect(r.second_step_at).toBeNull();
    expect(r.totp_added_at).toBeNull();
    expect(r.passkeys).toEqual([]);
    expect(r.challenge_expires_at).toBeNull();
    expect(r.grant_expires_at).toBeNull();
    expect(r.needs_a_method).toBe(false);
    expect(r.codes_paused).toBe(false);
  });
  it('a verified TOTP row gives totp_added_at (the row\'s created_at); an unverified one does not [red if: 0018 fills no created_at or an unverified factor shows]', async () => {
    const u = await fresh();
    must(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${u.id}', false)`, e.db);
    expect((await read(u.id, u.sid))[0].totp_added_at).toBeNull();
    must(`UPDATE public.two_factor SET verified = true WHERE user_id = '${u.id}'`, e.db);
    const row = (await read(u.id, u.sid))[0];
    expect(row.totp_added_at).not.toBeNull();
    const at = must(`SELECT created_at FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0];
    expect(new Date(row.totp_added_at).getTime()).toBe(new Date(at).getTime());
  });
  it('passkeys: id, name and created_at only, in created_at order; another user\'s are absent [red if: a key, credential id or counter appears, or the order is wrong]', async () => {
    const u = await fresh();
    const other = await fresh();
    const ins = (uid: string, name: string, at: string) => must(`INSERT INTO public.passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at) VALUES ('${name}', 'PUBKEY-${name}', '${uid}', 'CRED-${name}', 0, 'singleDevice', false, '${at}')`, e.db);
    ins(u.id, 'second', '2026-02-01T00:00:00Z');
    ins(u.id, 'first', '2026-01-01T00:00:00Z');
    ins(other.id, 'theirs', '2026-01-15T00:00:00Z');
    const r = (await read(u.id, u.sid))[0];
    expect(r.passkeys.map((p: any) => p.name)).toEqual(['first', 'second']);
    for (const p of r.passkeys) expect(Object.keys(p).sort()).toEqual(['created_at', 'id', 'name']);
    expect(JSON.stringify(r)).not.toMatch(/PUBKEY|CRED-|theirs/);
  });
  it('an open first_enrolment challenge for this session gives challenge_expires_at; one for another session does not [red if: the challenge is not session-scoped]', async () => {
    const u = await fresh();
    const other = fx.session(u.id, true);
    must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, expires_at) VALUES ('${u.id}', '${other}', 'first_enrolment', '\\x00', now() + interval '10 minutes')`, e.db);
    expect((await read(u.id, u.sid))[0].challenge_expires_at).toBeNull();
    must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, expires_at) VALUES ('${u.id}', '${u.sid}', 'first_enrolment', '\\x00', now() + interval '10 minutes')`, e.db);
    const at = (await read(u.id, u.sid))[0].challenge_expires_at;
    expect(at).not.toBeNull();
    expect(new Date(at).getTime() - Date.now()).toBeGreaterThan(8 * 60_000);
  });
  it('three challenges inside 15 minutes: resend_available_at is in the future, from the 3-in-15 rule; the answer carries no attempt count [red if: resend is available at once or a count leaks]', async () => {
    const u = await fresh();
    for (const ago of [1, 2, 3]) must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, created_at, expires_at, used_at) VALUES ('${u.id}', '${u.sid}', 'first_enrolment', '\\x00', now() - interval '${ago} minutes', now() + interval '5 minutes', now())`, e.db);
    const r = (await read(u.id, u.sid))[0];
    expect(r.resend_available_at).not.toBeNull();
    expect(new Date(r.resend_available_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(r.resend_available_at).getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5000);
  });
  it('resend_available_at (Addendum 2): NULL with no sends; NULL with two sends; NULL after 10 wrong entries in 24 hours with fewer than three sends; only the 3-in-15 rule gives a future time, the third-newest created_at + 15 minutes [red if: now() is returned when a send would issue, or the 24-hour rule shows a time]', async () => {
    const none = await fresh();
    expect((await read(none.id, none.sid))[0].resend_available_at, 'no sends').toBeNull();
    const two = await fresh();
    for (const ago of [1, 2]) must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, created_at, expires_at, used_at) VALUES ('${two.id}', '${two.sid}', 'first_enrolment', '\\x00', now() - interval '${ago} minutes', now() + interval '5 minutes', now())`, e.db);
    expect((await read(two.id, two.sid))[0].resend_available_at, 'two sends would issue now').toBeNull();
    const wrong = await fresh();
    must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, created_at, expires_at, attempts) VALUES ('${wrong.id}', '${wrong.sid}', 'first_enrolment', '\\x00', now() - interval '2 hours', now() - interval '110 minutes', 10)`, e.db);
    expect((await read(wrong.id, wrong.sid))[0].resend_available_at, '10 wrong in 24 hours suppresses, and says nothing about when').toBeNull();
    const three = await fresh();
    for (const ago of [1, 2, 3]) must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, created_at, expires_at, used_at) VALUES ('${three.id}', '${three.sid}', 'first_enrolment', '\\x00', now() - interval '${ago} minutes', now() + interval '5 minutes', now())`, e.db);
    const at = new Date((await read(three.id, three.sid))[0].resend_available_at).getTime();
    expect(Math.abs(at - (Date.now() - 3 * 60_000 + 15 * 60_000)), 'third-newest created_at + 15 minutes').toBeLessThan(10_000);
  });
  it('a live grant for this user and session gives grant_expires_at; a grant for another session does not [red if: the grant is read across sessions]', async () => {
    const u = await fresh();
    const other = fx.session(u.id, true);
    must(`INSERT INTO app.enrolment_grant (user_id, session_id, expires_at) VALUES ('${u.id}', '${other}', now() + interval '10 minutes')`, e.db);
    expect((await read(u.id, u.sid))[0].grant_expires_at).toBeNull();
    must(`UPDATE app.enrolment_grant SET revoked_at = now() WHERE user_id = '${u.id}'`, e.db);
    must(`INSERT INTO app.enrolment_grant (user_id, session_id, expires_at) VALUES ('${u.id}', '${u.sid}', now() + interval '10 minutes')`, e.db);
    expect((await read(u.id, u.sid))[0].grant_expires_at).not.toBeNull();
  });
  it('needs_a_method: false on the own Person alone, true with manager on a shared entity; the gate\'s second_step_required() cannot say this once enrolled [red if: the rule is not refuse_last_method\'s]', async () => {
    const u = await fresh({ enrolled: true });
    expect((await read(u.id, u.sid))[0].needs_a_method).toBe(false);
    const owner = await fresh({ enrolled: true });
    await fx.committed('poly_app', owner.id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), 'Shared-150', 'business_pass_through')`));
    const ent = must(`SELECT id FROM public.entity WHERE name = 'Shared-150'`, e.db).rows[0]![0];
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${u.id}', 'manager')`, e.db);
    expect((await read(u.id, u.sid))[0].needs_a_method).toBe(true);
    expect(await fx.marked('poly_app', u.id, u.sid, async (q) => (await q('SELECT app.second_step_required() AS r')).rows[0].r)).toBe(false);
  });
  it('codes_paused is a boolean while the verified factor\'s lock runs, and the time is not returned [red if: locked_until, or any time of the lock, is in the row]', async () => {
    const u = await fresh({ enrolled: true });
    expect((await read(u.id, u.sid))[0].codes_paused).toBe(false);
    must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() + interval '15 minutes' WHERE user_id = '${u.id}'; COMMIT;`, e.db);
    const r = (await read(u.id, u.sid))[0];
    expect(r.codes_paused).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/locked|minutes/i);
    expect(typeof r.codes_paused).toBe('boolean');
  });
  it('definers.json lists it (owner poly_govern, EXECUTE poly_app) [red if: the allowlist and the catalog disagree]', async () => {
    const { readFileSync } = await import('node:fs');
    const list = JSON.parse(readFileSync(join(process.cwd(), 'packages/db/sql/definers.json'), 'utf8'));
    const rows: any[] = Array.isArray(list) ? list : list.definers;
    const hit = rows.find((d) => /^app\.my_second_step\(/.test(d.function));
    expect(hit, 'definers.json entry').toBeTruthy();
    expect(hit.owner).toBe('poly_govern');
    expect(hit.execute).toEqual(['poly_app']);
  });
});

describe('R7 trustDevice is refused on both verify paths', () => {
  const PATHS = ['/two-factor/verify-totp', '/two-factor/verify-backup-code'] as const;
  it.each(PATHS)('%s with trustDevice: true answers 400 trust_device_refused: no session, no handle, no trust_device cookie; the same body without it signs in [red if: a 30-day trusted-device skip is possible]', async (path) => {
    const u = e.seedUser();
    const { secret, backupCodes } = await enrolTotp(e, withMail, u, mails);
    const enrolSessions = e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`); // the enrolment's own session stays
    const held = await heldSignIn(e, withMail, u.email);
    const code = path === PATHS[0] ? totp(secret) : backupCodes[0]!;
    const r = await e.handle(post(path, { code, trustDevice: true }, held.cookie), withMail);
    expect(r.status).toBe(400);
    expect((await json(r)).code).toBe('trust_device_refused');
    expect(hasSessionCookie(r)).toBe(false);
    expect(r.headers.getSetCookie().join('\n')).not.toMatch(/trust_device|poly_handle=[^;]/);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`), "no new session from the refused code").toBe(enrolSessions);
    for (const v of ['true', 1, 'yes']) {
      const again = await e.handle(post(path, { code, trustDevice: v }, held.cookie), withMail);
      expect(again.status, String(v)).toBe(400);
    }
    const ok = await e.handle(post(path, { code }, held.cookie), withMail);
    expect(ok.status, 'control: the same hold and code without trustDevice').toBe(200);
    expect(hasSessionCookie(ok)).toBe(true);
  });
});

describe('R7 the hold\'s lifetime (unmeasured in the ruling)', () => {
  it('the hold cookie\'s Max-Age is 600 and its verification row expires 600 s (±5) after the sign-in [red if: another lifetime: DESIGN\'s "10 minutes" changes]', async () => {
    const u = e.seedUser();
    await enrolTotp(e, withMail, u, mails);
    const before = Date.now();
    const held = await heldSignIn(e, withMail, u.email);
    const hold = held.res.headers.getSetCookie().find((c) => /two_factor/.test(c));
    expect(hold, 'the hold cookie').toBeTruthy();
    expect(Number(/max-age=(\d+)/i.exec(hold!)![1])).toBe(600);
    const secs = Number(must(`SELECT extract(epoch FROM (expires_at - now())) FROM public.verification ORDER BY created_at DESC LIMIT 1`, e.db).rows[0]![0]);
    expect(Math.abs(secs - 600)).toBeLessThanOrEqual(5 + (Date.now() - before) / 1000);
  });
  it('a hold whose row is moved past expiresAt answers 401, and no session follows [red if: an expired hold still verifies]', async () => {
    const u = e.seedUser();
    const { secret } = await enrolTotp(e, withMail, u, mails);
    const held = await heldSignIn(e, withMail, u.email);
    must(`UPDATE public.verification SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM public.verification ORDER BY created_at DESC LIMIT 1)`, e.db);
    const r = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, held.cookie), withMail);
    expect(r.status).toBe(401);
    expect(hasSessionCookie(r)).toBe(false);
  });
});

describe('R10 Cache-Control: no-store on every /api/auth response', () => {
  it('sign-in, send-code, confirm-code, enable, verify-totp and a refusal all carry no-store; enable especially (it returns the key and ten codes) [red if: a response is cacheable]', async () => {
    const u = e.seedUser();
    const seen: [string, Response][] = [];
    const go = async (name: string, req: Request) => { const r = await e.handle(req, withMail); seen.push([name, r]); return r; };
    const si = await go('sign-in', post('/sign-in/email', { email: u.email, password: PW }));
    let cookie = jar('', si);
    mails.length = 0;
    await go('send-code', post('/second-step/send-code', { password: PW }, cookie));
    const code = mails.find((m) => m.email.toLowerCase() === u.email.toLowerCase())!.code;
    await go('confirm-code', post('/second-step/confirm-code', { code }, cookie));
    const en = await go('enable', post('/two-factor/enable', { password: PW }, cookie));
    const secret = new URL((await json(en)).totpURI).searchParams.get('secret')!;
    const ver = await go('verify-totp', post('/two-factor/verify-totp', { code: totp(secret) }, cookie));
    cookie = jar(cookie, ver);
    const regen = await go('generate-backup-codes', post('/two-factor/generate-backup-codes', { password: PW }, cookie));
    expect(regen.status, 'the step-up is fresh after a first enrolment').toBe(200);
    await go('refusal', post('/sign-in/email', { email: u.email, password: 'wrong wrong wrong' }));
    cookie = '';
    for (const [name, r] of seen) expect((r.headers.get('cache-control') ?? '').toLowerCase(), name).toContain('no-store');
  });
  it('no log line and no response from the 503 path carries the password or any code (R3: nothing falls back) [red if: a secret is logged]', async () => {
    const lines: string[] = [];
    const saved = { log: console.log, error: console.error, warn: console.warn };
    for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try {
      const u = e.seedUser();
      const { cookie } = await e.signIn(u.email, noMail);
      const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), noMail);
      lines.push(await r.text());
    } finally { Object.assign(console, saved); }
    expect(lines.join('\n')).not.toContain(PW);
    expect(lines.join('\n')).toMatch(/mailer_unavailable/);
  });
});

describe('R8 a client address is required in every APP_ENV (development included)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poly150-ip-'));
  const secretFile = join(dir, 'secret');
  writeFileSync(secretFile, 'qa-ip-secret-0123456789abcdef0123456789abcdef\n');
  let port = 42100 + (process.pid % 300);
  it('a development service answers 503 to a request with no x-forwarded-for, and serves one that has it [red if: development skips the check]', async () => {
    const { startAuthService } = (await import('../../apps/auth/src/main.ts')) as any;
    const svc = await startAuthService({
      ...(process.env as Record<string, string>), APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'https://app.qa.test',
      ...dbEnv('poly_auth', e.db), AUTH_SECRET_FILE: secretFile, AUTH_PUBLIC_PORT: String(++port),
    });
    try {
      const bare = await fetch(`${svc.publicOrigin}/api/auth/ok`);
      expect(bare.status, 'no x-forwarded-for').toBe(503);
      const withIp = await fetch(`${svc.publicOrigin}/api/auth/ok`, { headers: { 'x-forwarded-for': '127.0.0.1' } });
      expect(withIp.status).toBe(200);
      const forged = await fetch(`${svc.publicOrigin}/api/auth/ok`, { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
      expect(forged.status, 'two entries are not an address').toBe(503);
    } finally { await svc.close(); }
  });
});
