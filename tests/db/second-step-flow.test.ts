// POLY-89c (ruling 6eed53f8, R3 #1; D1 = (b); criterion 16). The BetterAuth-facing half: hook behaviour measured against the pinned 1.7.18, and
// the HTTP flows. Every title ends [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { softAuthenticator } from './helpers/webauthn';
import { pgmod, totp } from './helpers/second-step';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

describe('C3/C9 the enrolment class and the route policy (R3, R5)', () => {
  const body = async (r: Response) => JSON.stringify(await r.clone().json().catch(() => ({})));
  it('an unenrolled signed-in user with no live grant is refused 403 email_confirmation_required on /two-factor/enable, not the flat second_step_required [red if: routePolicyHook still answers the flat refusal or never calls enrolment_grant_live()]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/two-factor/enable', { password: 'correct horse battery staple 1' }, cookie));
    expect(r.status).toBe(403);
    expect(await body(r)).toContain('email_confirmation_required');
  });
  it('/passkey/verify-registration with createSession is refused 400 before any grant check [red if: the enrolment class does not refuse body.createSession (S16)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/passkey/verify-registration', { response: {}, createSession: true }, cookie));
    expect(r.status).toBe(400);
  });
  it('/two-factor/enable refuses any method other than totp with 400 [red if: method otp is allowed through (S17)]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    const r = await e.handle(post('/two-factor/enable', { password: 'correct horse battery staple 1', method: 'otp' }, cookie));
    expect(r.status).toBe(400);
  });
  it('createAuth refuses to start when twoFactor is given otpOptions [red if: the startup refusal is absent (S17)]', async () => {
    await expect(e.mk('real-domain', (o) => {
      const p = o.plugins.find((x: any) => x.id === 'two-factor');
      p.options = { ...(p.options ?? {}), otpOptions: { sendOTP: async () => {} } };
      return o;
    })).rejects.toThrow(/otp/i);
  });
  it('the anchor class exists: /second-step/send-code and /second-step/confirm-code are routes of a fifth class, "anchor", each needing a session [red if: AUTH_ROUTES lacks them]', async () => {
    const u = e.seedUser();
    const anon = await e.handle(post('/second-step/send-code', { password: 'x' }));
    expect(anon.status).toBe(401);
    const { cookie } = await e.signIn(u.email);
    const authed = await e.handle(post('/second-step/confirm-code', { code: '000000' }, cookie));
    expect([200, 400, 403]).toContain(authed.status); // never 404: the route exists
  });
  // ---- the enrolment end to end through the real handler (C3, C4, C5, C15), with the SQL actually sent captured (R3 #1, #3) ----
  const mails: { email: string; code: string }[] = [];
  const mkWithMailer = () => e.A.createAuth({
    ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => {
      const code = Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string;
      mails.push({ email: String(m.email ?? m.to ?? ''), code });
    } }),
    rateLimit: { enabled: false },
  });
  const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
  async function enrol(auth: any, u: { id: string; email: string }, captured?: string[]) {
    let { cookie } = await e.signIn(u.email, auth);
    mails.length = 0;
    const sent = await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
    expect(sent.status).toBe(200);
    const code = mails.find((m) => m.email.toLowerCase() === u.email.toLowerCase())!.code;
    expect(code).toMatch(/^\d{6}$/);
    const conf = await e.handle(post('/second-step/confirm-code', { code }, cookie), auth);
    expect(conf.status).toBe(200);
    const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
    expect(en.status).toBe(200);
    const enJson = await json(en);
    const secret = new URL(enJson.totpURI).searchParams.get('secret')!;
    const orig = pgmod.Client.prototype.query;
    if (captured) pgmod.Client.prototype.query = function (this: unknown, ...a: any[]) { const q = a[0]; captured.push(typeof q === 'string' ? q : String(q?.text)); return orig.apply(this, a); };
    try {
      const ver = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, cookie), auth);
      expect(ver.status).toBe(200);
      cookie = jar(cookie, ver);
    } finally { pgmod.Client.prototype.query = orig; }
    return { cookie, secret, backupCodes: (enJson.backupCodes ?? []) as string[] };
  }
  it('C3/C15: password + emailed code + TOTP verify enrols: the first-verify rotation inserts its session, the flag and second_step_at are set, the new session is stamped [red if: the anchor routes, the grant path or the session.create.before strip is absent]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    await enrol(auth, u);
    expect(must(`SELECT two_factor_enabled, second_step_at IS NOT NULL FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]).toEqual(['t', 't']);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}' AND recent_auth_at IS NOT NULL`)).toBe(1);
  });
  it('R3 #1 and #3 on the statement: the SQL sent by verify-totp names two_factor_enabled in no UPDATE of "user" and recent_auth_at in no INSERT into session (the hooks return the keys as undefined), and the flag still ends set through the definer [red if: a hook leaves the key in the data]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const sql: string[] = [];
    await enrol(auth, u, sql);
    const upd = sql.filter((t) => /update\s+("public"\.)?"user"\s/i.test(t));
    const ins = sql.filter((t) => /insert\s+into\s+("public"\.)?"session"/i.test(t));
    expect(upd.length, 'the update of user was seen').toBeGreaterThan(0);
    expect(ins.length, 'the session insert was seen').toBeGreaterThan(0);
    for (const t of upd) expect(t).not.toMatch(/two_factor_enabled/);
    for (const t of ins) expect(t).not.toMatch(/recent_auth_at/);
    expect(must(`SELECT two_factor_enabled FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('t');
  });
  it('C3: a wrong password sends no code; a wrong code leaves the factor inactive and /two-factor/enable stays 403 email_confirmation_required [red if: the anchor routes are absent or a first factor needs only the password]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    mails.length = 0;
    await e.handle(post('/second-step/send-code', { password: 'not the password' }, cookie), auth);
    expect(mails.length).toBe(0);
    await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
    expect(mails.length).toBe(1);
    const wrongCode = mails[0]!.code === '000000' ? '000001' : '000000';
    const conf = await e.handle(post('/second-step/confirm-code', { code: wrongCode }, cookie), auth);
    expect(conf.status).not.toBe(200);
    const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
    expect(en.status).toBe(403);
    expect(JSON.stringify(await json(en))).toContain('email_confirmation_required');
    expect(must(`SELECT second_step_at IS NULL AND NOT two_factor_enabled FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('t');
  });
  it('C8: the 4th send-code in 15 minutes answers exactly as a real send does (status and body keys) [red if: suppression is distinguishable]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    const shapes: string[] = [];
    for (let i = 0; i < 4; i++) { const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth); shapes.push(`${r.status}:${Object.keys(await json(r)).sort().join(',')}`); }
    expect(new Set(shapes).size).toBe(1);
    expect(shapes[0]).toMatch(/^200:/);
  });
  it('C4: after enrolment a NEW device is held (no session cookie); a step-up route works right after enrolment (it counts as the step-up) and says step_up_required once the stamp is over 300 s old [red if: the hold, the stamp or the window is missing]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await enrol(auth, u);
    const fresh = await e.handle(post('/two-factor/generate-backup-codes', { password: PW }, cookie), auth);
    expect(JSON.stringify(await json(fresh))).not.toContain('step_up_required');
    must(`UPDATE public.session SET recent_auth_at = now() - interval '301 seconds' WHERE user_id = '${u.id}'`, e.db);
    const stale = await e.handle(post('/two-factor/generate-backup-codes', { password: PW }, cookie), auth);
    expect(stale.status).toBe(403);
    expect(JSON.stringify(await json(stale))).toContain('step_up_required');
    const device = await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth);
    expect(device.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(false);
  });
  it('C5: Google sign-in satisfies neither the step nor a step-up: an unenrolled user\'s Google session is not stamped, and an enrolled user\'s Google sign-in is held [red if: the callback stamps recent_auth_at or skips the hold]', async () => {
    const un = e.seedUser({ password: false });
    await e.oauth(un.email, e.auth);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${un.id}' AND recent_auth_at IS NULL`)).toBe(1);
    const en = e.seedUser({ twoFactor: true, password: false });
    const r = await e.oauth(en.email, e.auth);
    expect(r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(false);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${en.id}'`)).toBe(0);
  });
  it('C5/C-a: a passkey assertion signs in as poly_auth: 200, a session cookie, and the unmarked passkey.counter update commits (0 -> 1) [red if: guard_passkey refuses the unmarked counter update, or the commit-time check uses the marker]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${u.id}'`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'), auth);
    expect(g.status).toBe(200);
    const opt = await json(g);
    const r = await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g)), auth);
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(true);
    expect(must(`SELECT counter FROM public.passkey WHERE credential_id = '${k.credentialId}'`, e.db).rows[0]![0]).toBe('1');
  });
  it('C3/C5: a passkey is a first factor through the same anchor: password + emailed code, then register-options and verify-registration enrol it, second_step_at is set and the session that asked is stamped; createSession stays refused [red if: guard_passkey does not consume the grant or stamp the marker session exactly once]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    mails.length = 0;
    await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
    const conf = await e.handle(post('/second-step/confirm-code', { code: mails[0]!.code }, cookie), auth);
    expect(conf.status).toBe(200);
    const k = softAuthenticator();
    const g = await e.handle(get('/passkey/generate-register-options', cookie), auth);
    expect(g.status).toBe(200);
    const gc = jar(cookie, g);
    const refused = await e.handle(post('/passkey/verify-registration', { response: k.register(await json(g)), name: 'k', createSession: true }, gc), auth);
    expect(refused.status).toBe(400);
    const g2 = await e.handle(get('/passkey/generate-register-options', cookie), auth);
    const ok = await e.handle(post('/passkey/verify-registration', { response: k.register(await json(g2)), name: 'k' }, jar(cookie, g2)), auth);
    expect(ok.status).toBe(200);
    expect(must(`SELECT second_step_at IS NOT NULL FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('t');
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}' AND recent_auth_at IS NOT NULL`)).toBe(1);
    expect(must(`SELECT consumed_by FROM app.enrolment_grant WHERE user_id = '${u.id}'`, e.db).rows[0]![0]).toBe('passkey');
  });
  it('D1(b) over HTTP: after enrolment a new device is held, and /two-factor/verify-backup-code with a generated code signs it in as poly_app; the consumed code is rewritten and cannot be used twice [red if: the unmarked backup_codes carve-out or the commit-time check refuses the sign-in]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { backupCodes } = await enrol(auth, u);
    expect(backupCodes.length).toBeGreaterThan(1);
    const before = must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0];
    const held = await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth);
    const heldCookie = jar('', held);
    expect(held.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(false);
    const ok = await e.handle(post('/two-factor/verify-backup-code', { code: backupCodes[0] }, heldCookie), auth);
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(true);
    expect(must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0]).not.toBe(before);
    const held2 = await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth);
    const again = await e.handle(post('/two-factor/verify-backup-code', { code: backupCodes[0] }, jar('', held2)), auth);
    expect(again.status).not.toBe(200);
  });
  it('seceng: a wrong emailed code answers 403 and the response reaching the client carries no x-poly-commit header [red if: the commit header leaks]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    mails.length = 0;
    await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
    const wrong = mails[0]!.code === '000000' ? '000001' : '000000';
    const r = await e.handle(post('/second-step/confirm-code', { code: wrong }, cookie), auth);
    expect(r.status).toBe(403);
    expect(r.headers.has('x-poly-commit')).toBe(false);
    expect(must(`SELECT attempts FROM app.email_challenge WHERE user_id = '${u.id}'`, e.db).rows[0]![0]).toBe('1'); // the attempt was committed
  });
  it('seceng: the handler commits on x-poly-commit only for /second-step/confirm-code with a 403; the same header on a 403 from any other path rolls back [red if: the header is honoured on every path]', async () => {
    const { createAuthMiddleware, APIError } = await import('better-auth/api');
    const forged = { id: 'qa-forge', hooks: { after: [{
      matcher: (c: { path?: string }) => c.path === '/update-user',
      handler: createAuthMiddleware(async (ctx: any) => { ctx.setHeader('x-poly-commit', '1'); throw new APIError('FORBIDDEN', { message: 'forged' }); }),
    }] } };
    const auth = await e.mk('real-domain', (o) => { o.plugins.push(forged); return o; });
    const u = e.seedUser({ name: 'Before' });
    const { cookie } = await e.signIn(u.email, auth);
    const r = await e.handle(post('/update-user', { name: 'Forged' }, cookie), auth);
    expect(r.status).toBe(403);
    expect(r.headers.has('x-poly-commit')).toBe(false);
    expect(must(`SELECT name FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('Before'); // rolled back, not committed
  });
  it('seceng: send-code refuses a user whose email is not verified (403) and mails nothing, and no challenge row exists [red if: the code goes to an unverified address]', async () => {
    const auth = await mkWithMailer();
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    must(`UPDATE public."user" SET email_verified = false WHERE id = '${u.id}'`, e.db);
    mails.length = 0;
    const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth);
    expect(r.status).toBe(403);
    expect(mails.length).toBe(0);
    expect(e.count(`SELECT 1 FROM app.email_challenge WHERE user_id = '${u.id}'`)).toBe(0);
  });
});

describe('criterion 16: the IdP id_token is never stored (accountDropIdToken)', () => {
  // The shipped unit test (packages/auth/src/options.test.ts) checks only the hook's return value, which passes against the
  // bug: with-hooks.mjs merges the returned data over the original, so a key left out is still written. These read the STORED row.
  const idTokens = (email: string) => must(`SELECT a.id_token IS NULL, a.provider_id FROM public.account a JOIN public."user" u ON u.id = a.user_id WHERE u.email = '${email}' AND a.provider_id = 'google'`, e.db).rows;
  it('account CREATE through the real OAuth callback leaves account.id_token NULL [red if: the hook drops idToken by omitting the key]', async () => {
    const u = e.seedUser({ password: false });
    const r = await e.oauth(u.email, e.auth);
    expect([200, 302, 303]).toContain(r.status);
    const rows = idTokens(u.email);
    expect(rows.length).toBe(1);
    expect(rows[0]![0]).toBe('t');
  });
  it('account UPDATE (a second Google sign-in refreshes the tokens) leaves account.id_token NULL even when a token was stored before [red if: the update hook omits the key instead of returning idToken: null]', async () => {
    const u = e.seedUser({ password: false });
    await e.oauth(u.email, e.auth);
    must(`UPDATE public.account SET id_token = 'OLD-IDT-SECRET' WHERE user_id = '${u.id}' AND provider_id = 'google'`, e.db);
    await e.oauth(u.email, e.auth);
    const rows = idTokens(u.email);
    expect(rows.length).toBe(1);
    expect(rows[0]![0]).toBe('t');
  });
});

describe('R3 #1 the unmeasured claim: userUpdateBefore data replaces BetterAuth\'s update', () => {
  // MEASUREMENT, not a build test. twoFactorEnabled cannot be driven yet (the enrolment class is a flat 403 today), so the
  // same mechanism is measured on /update-user: a patched user.update.before drops `name` (as R3 #1's hook drops
  // twoFactorEnabled) and we read what BetterAuth wrote. Green today means the ruling's claim holds.
  const run = async (shape: (data: any) => any) => {
    const auth = await e.mk('real-domain', (o) => {
      o.databaseHooks.user.update.before = async (data: any) => ({ data: shape(data) });
      return o;
    });
    const u = e.seedUser({ name: 'Before' });
    const { cookie } = await e.signIn(u.email, auth);
    const res = await e.handle(post('/update-user', { name: 'After' }, cookie), auth);
    const row = must(`SELECT name, updated_at FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]!;
    return { status: res.status, name: row[0], updatedAt: row[1] };
  };
  // FINDING (better-auth 1.7.18 db/with-hooks.mjs:56): `actualData = {...actualData, ...result.data}`. The returned data is
  // MERGED over the original, so a hook that merely omits a key does not remove it. The ruling's claim is false as worded.
  it('MEASURED: a hook returning data without a key does NOT remove it; the original value is still written [red if: 1.7.18 stops merging]', async () => {
    const r = await run(() => ({ updatedAt: new Date('2031-01-02T03:04:05Z') }));
    expect(r.name).toBe('After');
  });
  it('MEASURED: a hook returning the key as undefined leaves the column untouched and the route still answers [red if: the adapter writes undefined as NULL or errors]', async () => {
    const r = await run(() => ({ name: undefined, updatedAt: new Date('2031-01-02T03:04:05Z') }));
    expect(r.status).toBe(200);
    expect(r.name).toBe('Before');
    expect(r.updatedAt).toContain('2031-01-02');
  });
});
