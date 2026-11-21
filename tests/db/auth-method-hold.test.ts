// POLY-137 R3 (ruling @ a5e9ce4f; seceng ruling-review §5): the 24-hour hold on a method added after the first, the cancel link, the outbox rows the
// database writes, and the R0 attacker (SQL as poly_auth with a forged marker and stamp). Real Postgres, the real handler on poly_auth.
// Every refusal asserts its SQLSTATE and message and has a positive case beside it. Titles end [red if: ...].
// Red today: app.method_hold and app.mail_outbox do not exist (0020/0021 are the build), so a later add is not held and writes no notice.
// ASSUMED (not worded by the ruling; the builder reconciles in the constants below): D1's refusal message matches /email/i; the exact-call refusal
// is a 42501 that is not "permission denied".
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { tx } from './helpers/auth-tx';
import { sessionWithHandle } from './helpers/handle';
import { enrol, operatorReset, freshCookie, mailAuth, holds, markSent, memMailer, outbox, type Mem } from './helpers/mail';
import { codeOf, fails, fixture, msgOf, totp } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';
import { hasSessionCookie } from './helpers/auth-service';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
let auth: any;
let mm: Mem;
beforeAll(async () => {
  e = await boot();
  fx = fixture(e.db, 137);
  mm = memMailer();
  auth = await mailAuth(e, mm);
});
afterAll(() => teardown(e));

const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const ONHOLD = { code: '42501', message: /method_on_hold/ };
const sessions = (uid: string) => e.count(`SELECT 1 FROM public.session WHERE user_id = '${uid}'`);
const stamp = (sid: string): string => must(`SELECT coalesce(recent_auth_at::text, 'NULL') FROM public.session WHERE id = '${sid}'`, e.db).rows[0]![0]!;

/** A passkey added over the real handler, with the fresh step-up a Confirm it's you leaves; returns the authenticator. */
async function addPasskey(uid: string, counterless = true) {
  const { cookie } = await freshCookie(e, auth, uid);
  const k = softAuthenticator();
  const g = await e.handle(get('/passkey/generate-register-options', cookie), auth);
  expect(g.status, `register options ${JSON.stringify(await json(g))}`).toBe(200);
  const ok = await e.handle(post('/passkey/verify-registration', { response: k.register(await json(g)), name: 'qa' }, jar(cookie, g)), auth);
  expect(ok.status, `verify-registration ${JSON.stringify(await json(ok))}`).toBe(200);
  void counterless;
  return { k, id: must(`SELECT id FROM public.passkey WHERE credential_id = '${k.credentialId}'`, e.db).rows[0]![0]! };
}
/** Passkey sign-in over HTTP; the authenticator's counter stays 0 (a constant-0 authenticator: Kysely still names `counter` in its SET). */
async function passkeySignIn(k: ReturnType<typeof softAuthenticator>) {
  const g = await e.handle(get('/passkey/generate-authenticate-options'), auth);
  const opt = await json(g);
  const r = await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 0) }, jar('', g)), auth);
  return { r, j: await json(r) };
}
/** First set-up with a passkey (emailed-code grant), no TOTP: a user whose first method is a passkey. */
async function firstPasskeyUser() {
  const u = e.seedUser();
  const { cookie } = await e.signIn(u.email, auth);
  const n0 = mm.sent.length;
  expect((await e.handle(post('/second-step/send-code', { password: PW }, cookie), auth)).status).toBe(200);
  const code = /\b(\d{6})\b/.exec(mm.sent[n0]!.text)![1];
  expect((await e.handle(post('/second-step/confirm-code', { code }, cookie), auth)).status).toBe(200);
  const k = softAuthenticator();
  const g = await e.handle(get('/passkey/generate-register-options', cookie), auth);
  const ok = await e.handle(post('/passkey/verify-registration', { response: k.register(await json(g)), name: 'first' }, jar(cookie, g)), auth);
  expect(ok.status, JSON.stringify(await json(ok))).toBe(200);
  return { u, k };
}
/**
 * A TOTP added to a user who already has a second step, with a fresh stamp: held. `/two-factor/enable` makes the encrypted secret and backup codes
 * over HTTP; the verify step is the same two writes BetterAuth's verify route makes, in one transaction as poly_auth under the session's marker
 * (the route itself refuses this user with email_confirmation_required, an existing behaviour that is not under test here).
 */
async function addTotp(uid: string) {
  const { cookie, id: sid } = await freshCookie(e, auth, uid);
  const en = await e.handle(post('/two-factor/enable', { password: PW }, cookie), auth);
  expect(en.status, JSON.stringify(await json(en))).toBe(200);
  const j = await json(en);
  const secret = new URL(j.totpURI).searchParams.get('secret')!;
  await fx.committed('poly_auth', uid, sid, async (q) => {
    await q('SELECT app.set_two_factor_enabled($1)', [true]);
    await q('UPDATE public.two_factor SET verified = true WHERE user_id = $1', [uid]);
  });
  return { secret, backupCodes: (j.backupCodes ?? []) as string[] };
}
const tokenOf = () => randomBytes(32);
/** What the worker's drain does for a held row: arm a token's hash, then record the mail as accepted. Returns the token (the fragment in the mail). */
async function arm(uid: string, token = tokenOf()) {
  const mail = outbox(e, uid, 'method_added').at(-1)![0]!;
  const hash = createHash('sha256').update(token).digest();
  const until = await tx(e.db, 'poly_worker', async (q) => (await q('SELECT app.arm_hold_cancel($1, $2)', [mail, hash])).rows[0].arm_hold_cancel, true);
  await tx(e.db, 'poly_worker', (q) => q('SELECT app.mail_sent($1)', [mail]), true);
  return { token: token.toString('base64url'), until: until as Date | null };
}
const cancel = (token: unknown, cookie = '') => e.handle(post('/second-step/cancel-hold', { token }, cookie), auth);

describe('R3.1 the tables: forced RLS, and no login role holds any privilege on either', () => {
  it('app.method_hold and app.mail_outbox exist with row-level security enabled and forced [red if: a table is missing or RLS is off]', () => {
    for (const t of ['app.method_hold', 'app.mail_outbox']) {
      expect(must(`SELECT to_regclass('${t}')::text`, e.db).rows[0]![0], t).toBe(t);
      expect(must(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '${t}'::regclass`, e.db).rows[0], t).toEqual(['t', 't']);
    }
  });
  it('no login role holds SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on either table, at table level; poly_backup reads them [red if: a runtime role can read a cancel hash or a recipient]', () => {
    for (const t of ['app.method_hold', 'app.mail_outbox']) {
      for (const r of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator']) {
        for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          expect(must(`SELECT has_table_privilege('${r}', '${t}', '${p}')`, e.db).rows[0]![0], `${r} ${p} ${t}`).toBe('f');
        }
      }
      expect(must(`SELECT has_table_privilege('poly_backup', '${t}', 'SELECT')`, e.db).rows[0]![0], `poly_backup reads ${t}`).toBe('t');
    }
  });
});

describe('R3.2, R3.3 a method added after the first is held, and its notice is written by the database', () => {
  it('a passkey added to an enrolled user: one hold (24 h, not cancelled, no hash, notice unsent) and one method_added outbox row, to the account address [red if: nothing is held or no notice is written]', async () => {
    const x = await enrol(e, auth, mm);
    expect(holds(e, x.u.id), 'the first set-up is not held').toEqual([]);
    const { id } = await addPasskey(x.u.id);
    const h = holds(e, x.u.id);
    expect(h).toHaveLength(1);
    const [, method, tf, pk, secs, hash, cancelled, noticeAt, mailId] = h[0]!;
    expect([method, tf, pk, hash, cancelled, noticeAt]).toEqual(['passkey', '', id, '', '', '']);
    expect(Number(secs), 'usable_at = created_at + 24 h').toBeGreaterThanOrEqual(86_399);
    expect(Number(secs)).toBeLessThanOrEqual(86_401);
    const ob = outbox(e, x.u.id, 'method_added');
    expect(ob.map((r) => r[0]), 'the hold names the outbox row that announces it').toContain(mailId);
    const added = ob.find((r) => r[0] === mailId)!;
    expect(added[2]).toBe(x.u.email);
    expect(added[4], 'unsent').toBe('');
    const p = JSON.parse(added[3]!);
    expect(p.methods).toEqual(['passkey']);
    expect(Object.keys(p).sort(), 'no token, code, name or user agent in a payload').toEqual(expect.arrayContaining(['at', 'methods', 'usable_at']));
    expect(Object.keys(p).every((k) => ['methods', 'at', 'usable_at', 'hold_id'].includes(k))).toBe(true);
  });
  it('R3.10.4 first set-up (second step NULL, emailed-code grant) writes no hold, one method_added notice with no usable_at, and the method works at once [red if: a first set-up is held, or not announced]', async () => {
    const x = await enrol(e, auth, mm);
    expect(holds(e, x.u.id)).toEqual([]);
    const ob = outbox(e, x.u.id, 'method_added');
    expect(ob).toHaveLength(1);
    expect(JSON.parse(ob[0]![3]!).usable_at, 'first set-up: no usable_at').toBeUndefined();
    const s = await e.handle(post('/sign-in/email', { email: x.u.email, password: PW }), auth);
    const v = await e.handle(post('/two-factor/verify-totp', { code: totp(x.secret, Date.now() + 30_000) }, jar('', s)), auth);
    expect(v.status, JSON.stringify(await json(v))).toBe(200);
    expect(hasSessionCookie(v)).toBe(true);
  });
  it('R3.10.4 after the user removed every method themselves, an add is held (rule 2); after the operator\'s reset it is not [red if: a self-removal followed by a re-enrolment is a free first set-up]', async () => {
    const x = await enrol(e, auth, mm);
    const { cookie } = await freshCookie(e, auth, x.u.id);
    expect((await e.handle(post('/two-factor/disable', { password: PW }, cookie), auth)).status).toBe(200);
    expect(must(`SELECT second_step_at IS NULL FROM public."user" WHERE id = '${x.u.id}'`, e.db).rows[0]![0], 'second step is NULL again').toBe('t');
    const again = await enrol(e, auth, mm, x.u);
    expect(holds(e, x.u.id), 'rule 2: re-enrolling after removing your own methods is held').toHaveLength(1);
    expect(again.u.id).toBe(x.u.id);
    // the operator's reset is the exemption: it removes a method (an `operator` audit row), so the next add is a first set-up again
    const y = await enrol(e, auth, mm);
    const { cookie: c2 } = await freshCookie(e, auth, y.u.id);
    expect((await e.handle(post('/two-factor/disable', { password: PW }, c2), auth)).status).toBe(200);
    await enrol(e, auth, mm, y.u);
    expect(holds(e, y.u.id), 'rule 2: held after the user removed their own').toHaveLength(1);
    await operatorReset(e, y.u.email);
    await enrol(e, auth, mm, y.u);
    expect(holds(e, y.u.id), 'after reset-mfa the add is a first set-up: no new hold').toHaveLength(1);
  });
  it('R3.10.7 two passkeys added in one transaction write ONE method_added row naming both methods, and two holds sharing its id [red if: a merged add writes two mails, or one hold]', async () => {
    const x = await enrol(e, auth, mm);
    const { id: sid } = await freshCookie(e, auth, x.u.id);
    await fx.committed('poly_auth', x.u.id, sid, async (q) => {
      for (const k of [softAuthenticator(), softAuthenticator()]) {
        await q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, x.u.id, k.credentialId]);
      }
    });
    const ob = outbox(e, x.u.id, 'method_added');
    expect(ob.filter((r) => JSON.parse(r[3]!).methods.length === 2)).toHaveLength(1);
    const h = holds(e, x.u.id);
    expect(h).toHaveLength(2);
    expect(new Set(h.map((r) => r[8])).size, 'one mail for both holds').toBe(1);
  });
  it('R3.10.7 a superuser fixture insert writes no hold and no notice (restores and seeds are not announced) [red if: fixtures get held]', async () => {
    const u = await fx.user({ enrolled: true });
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    expect(holds(e, u.id)).toEqual([]);
    expect(outbox(e, u.id).filter((r) => r[1] === 'method_added')).toEqual([]);
    expect(must(`SELECT app.method_held('passkey', (SELECT id FROM public.passkey WHERE credential_id = '${k.credentialId}'))`, e.db, { role: 'poly_auth' }).rows[0]![0]).toBe('f');
  });
  it('R3.10.7 every removal writes exactly one method_removed row per transaction: an operator reset of three methods is one mail [red if: a removal is silent, or one mail per method]', async () => {
    const x = await enrol(e, auth, mm);
    await addPasskey(x.u.id);
    await addPasskey(x.u.id);
    expect(outbox(e, x.u.id, 'method_removed')).toEqual([]);
    await operatorReset(e, x.u.email);
    const rm = outbox(e, x.u.id, 'method_removed');
    expect(rm).toHaveLength(1);
    expect(JSON.parse(rm[0]![3]!).methods.sort()).toEqual(['passkey', 'passkey', 'totp']);
  });
});

describe('R3.4 a held method cannot sign in, and nothing it touched survives', () => {
  it('R3.10.1 a held passkey on a counter-0 authenticator is refused at passkey sign-in over HTTP: AUTHENTICATION_FAILED, no session row, no cookie [red if: the hold is not enforced on the passkey path]', async () => {
    const x = await enrol(e, auth, mm);
    const { k } = await addPasskey(x.u.id);
    const n = sessions(x.u.id);
    const { r, j } = await passkeySignIn(k);
    expect([r.status, j.code]).toEqual([400, 'AUTHENTICATION_FAILED']);
    expect(hasSessionCookie(r)).toBe(false);
    expect(sessions(x.u.id), 'no session row was created').toBe(n);
  });
  it('R3.10.1 still refused when usable_at is in the past but the notice is not sent (M6, RC2); and with the notice sent but usable_at 1 s ahead; and it signs in once both are satisfied [red if: the hold ends on the clock alone]', async () => {
    const x = await enrol(e, auth, mm);
    const { k } = await addPasskey(x.u.id);
    must(`UPDATE app.method_hold SET usable_at = now() - interval '1 second' WHERE user_id = '${x.u.id}'`, e.db);
    expect((await passkeySignIn(k)).j.code, 'notice unsent').toBe('AUTHENTICATION_FAILED');
    must(`UPDATE app.method_hold SET notice_sent_at = now(), usable_at = now() + interval '1 second' WHERE user_id = '${x.u.id}'`, e.db);
    expect((await passkeySignIn(k)).j.code, 'usable_at 1 s ahead').toBe('AUTHENTICATION_FAILED');
    must(`UPDATE app.method_hold SET usable_at = now() - interval '1 second' WHERE user_id = '${x.u.id}'`, e.db);
    const ok = await passkeySignIn(k);
    expect(ok.r.status, JSON.stringify(ok.j)).toBe(200);
    expect(hasSessionCookie(ok.r)).toBe(true);
  });
  it('R3.10.2 a held TOTP: the right code at sign-in creates no session; a held row\'s backup code is refused and stays unspent; wrong codes still count toward the lock; after release it signs in [red if: TOTP or backup-code sign-in ignores the hold]', async () => {
    const { u } = await firstPasskeyUser();
    const t = await addTotp(u.id);
    expect(holds(e, u.id)).toHaveLength(1);
    const codes = () => must(`SELECT backup_codes, failed_verification_count FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]!;
    const held = async () => jar('', await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth));
    const n = sessions(u.id);
    const right = await e.handle(post('/two-factor/verify-totp', { code: totp(t.secret, Date.now() + 30_000) }, await held()), auth);
    expect(right.status, 'the exception escapes BetterAuth and the transaction rolls back').toBeGreaterThanOrEqual(400);
    expect(hasSessionCookie(right)).toBe(false);
    expect(sessions(u.id)).toBe(n);
    const before = codes();
    const bk = await e.handle(post('/two-factor/verify-backup-code', { code: t.backupCodes[0] }, await held()), auth);
    expect(bk.status).toBeGreaterThanOrEqual(400);
    expect(hasSessionCookie(bk)).toBe(false);
    expect(codes()[0], 'the backup code stays unspent').toBe(before[0]);
    const wrong = await e.handle(post('/two-factor/verify-totp', { code: totp(t.secret, Date.now() + 30_000) === '000000' ? '000001' : '000000' }, await held()), auth);
    expect(wrong.status).toBe(401);
    expect(Number(codes()[1]), 'a wrong code during the hold still counts').toBeGreaterThan(Number(before[1]));
    markSent(e, u.id);
    const ok = await e.handle(post('/two-factor/verify-totp', { code: totp(t.secret, Date.now() + 30_000) }, await held()), auth);
    expect(ok.status, JSON.stringify(await json(ok))).toBe(200);
    expect(hasSessionCookie(ok)).toBe(true);
  });
  it('R3.10.3 Confirm it\'s you with a held TOTP answers 403 method_on_hold and writes no stamp [red if: a held method can re-confirm]', async () => {
    const { u } = await firstPasskeyUser();
    const t = await addTotp(u.id);
    const s = sessionWithHandle(e.db, u.id);
    const cookie = await e.cookieForToken(s.token, auth);
    const b = await e.handle(post('/second-step/reauth/begin', { method: 'totp' }, cookie), auth);
    expect(b.status, JSON.stringify(await json(b))).toBe(200);
    const r = await e.handle(post('/second-step/reauth', { challengeId: (await json(b)).challengeId, password: PW, code: totp(t.secret, Date.now() + 30_000) }, cookie), auth);
    expect([r.status, (await json(r)).code]).toEqual([403, 'method_on_hold']);
    expect(stamp(s.id)).toBe('NULL');
  });
  it('R3.10.3 Confirm it\'s you with a held passkey answers 403 method_on_hold, before complete_step_up, and writes no stamp [red if: the passkey re-check path ignores the hold]', async () => {
    const x = await enrol(e, auth, mm);
    const { k } = await addPasskey(x.u.id);
    const s = sessionWithHandle(e.db, x.u.id);
    const cookie = await e.cookieForToken(s.token, auth);
    const b = await e.handle(post('/second-step/reauth/begin', { method: 'passkey' }, cookie), auth);
    const bj = await json(b);
    expect(b.status, JSON.stringify(bj)).toBe(200);
    const r = await e.handle(post('/second-step/reauth/passkey', { challengeId: bj.challengeId, response: k.assert({ challenge: bj.options.challenge }, 0) }, cookie), auth);
    expect([r.status, (await json(r)).code]).toEqual([403, 'method_on_hold']);
    expect(stamp(s.id)).toBe('NULL');
  });
  it('a rename of a held passkey (only `name`) passes: the hold refuses counter writes, not metadata [red if: the trigger fires on every update]', async () => {
    const x = await enrol(e, auth, mm);
    const { id } = await addPasskey(x.u.id);
    const { cookie } = await freshCookie(e, auth, x.u.id);
    const r = await e.handle(post('/passkey/update-passkey', { id, name: 'renamed' }, cookie), auth);
    expect(r.status, JSON.stringify(await json(r))).toBe(200);
  });
  it('at the database: as poly_auth, a success reset of failed_verification_count and a backup_codes write on a held row are refused 42501 method_on_hold, a wrong-code increment passes, and all pass once released [red if: the guard is absent or fires for another reason]', async () => {
    const { u } = await firstPasskeyUser();
    await addTotp(u.id);
    const run = (sql: string) => fails(tx(e.db, 'poly_auth', (q) => q(sql, [u.id]), true));
    const reset = 'UPDATE public.two_factor SET failed_verification_count = 0 WHERE user_id = $1';
    const spend = `UPDATE public.two_factor SET backup_codes = backup_codes || 'x' WHERE user_id = $1`;
    const bump = 'UPDATE public.two_factor SET failed_verification_count = 3 WHERE user_id = $1';
    for (const sql of [reset, spend]) {
      const x = await run(sql);
      expect(x, sql).not.toBeNull();
      expect([codeOf(x), msgOf(x)]).toEqual([ONHOLD.code, expect.stringMatching(ONHOLD.message)]);
    }
    expect(await run(bump), 'a wrong-code increment is not a success').toBeNull();
    markSent(e, u.id);
    expect(await run(reset), 'released: the success reset passes').toBeNull();
  });
});

describe('R3.5 a held method does not count as a remaining method', () => {
  it('R3.10.8 a manager with one working TOTP and one held passkey cannot remove the TOTP: 42501 second_step_required, the row stays; once the passkey is released the removal passes [red if: a planted method satisfies the last-method rule]', async () => {
    const owner = await fx.user({ enrolled: true });
    const u = await fx.user({ enrolled: true });
    await fx.committed('poly_app', owner.id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_pass_through')`, [`H137-${owner.id}`]));
    const ent = must(`SELECT id FROM public.entity WHERE name = 'H137-${owner.id}'`, e.db).rows[0]![0];
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${u.id}', 'manager')`, e.db);
    const sid = (await freshCookie(e, auth, u.id)).id;
    await fx.committed('poly_auth', u.id, sid, async (q) => {
      const k = softAuthenticator();
      await q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, u.id, k.credentialId]);
    });
    expect(holds(e, u.id)).toHaveLength(1);
    // the flag goes first (two_factor_consistent, 0013), in the same transaction as the delete
    const del = () => fails(fx.committed('poly_auth', u.id, sid, async (q) => { await q('SELECT app.set_two_factor_enabled($1)', [false]); await q('DELETE FROM public.two_factor WHERE user_id = $1', [u.id]); }));
    const x = await del();
    expect(x).not.toBeNull();
    expect([codeOf(x), msgOf(x)]).toEqual(['42501', expect.stringMatching(/second_step_required/)]);
    expect(e.count(`SELECT 1 FROM public.two_factor WHERE user_id = '${u.id}'`), 'the working method is still there').toBe(1);
    markSent(e, u.id);
    expect(await del(), 'with a usable passkey the TOTP may go').toBeNull();
  });
});

describe('R3.6, R3.7 the definers, and the cancel link', () => {
  it('who may execute what: method_held and cancel_method_hold are poly_auth only; claim_mail, arm_hold_cancel, mail_sent, mail_failed are poly_worker only; sync is nobody\'s [red if: a role can reach a definer it should not]', () => {
    const can = (r: string, f: string) => must(`SELECT has_function_privilege('${r}', '${f}', 'EXECUTE')`, e.db).rows[0]![0];
    const only: [string, string][] = [['app.method_held(text,uuid)', 'poly_auth'], ['app.cancel_method_hold(text)', 'poly_auth'], ['app.claim_mail()', 'poly_worker'], ['app.arm_hold_cancel(uuid,bytea)', 'poly_worker'], ['app.mail_sent(uuid)', 'poly_worker'], ['app.mail_failed(uuid,integer)', 'poly_worker'], ['app.purge_mail_outbox()', 'poly_worker']];
    for (const [f, who] of only) for (const r of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator']) expect(can(r, f), `${r} on ${f}`).toBe(r === who ? 't' : 'f');
    for (const f of ['app.note_codes_replaced()', 'app.note_password_changed()']) for (const r of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator']) expect(can(r, f), `${r} on ${f}`).toBe('f');
  });
  it('the worker definers refuse any call that is not their exact statement: SELECT app.claim_mail() is refused (42501, not a missing grant), SELECT * FROM app.claim_mail() passes [red if: the exact-call check is absent]', async () => {
    const x = await fails(tx(e.db, 'poly_worker', (q) => q('SELECT app.claim_mail()', [])));
    expect(codeOf(x)).toBe('42501');
    expect(msgOf(x)).not.toMatch(/permission denied/);
    await expect(tx(e.db, 'poly_worker', (q) => q('SELECT * FROM app.claim_mail()', []))).resolves.toBeDefined();
  });
  it('R3.10.5 the armed token cancels: 200 {status:true}, the method row is gone, cancelled_at is set, every session is gone, and the method then fails to sign in even after a backdate [red if: a cancel leaves the method, a session, or a live hold]', async () => {
    const x = await enrol(e, auth, mm);
    const { k, id } = await addPasskey(x.u.id);
    const { token, until } = await arm(x.u.id);
    expect(until, 'arm_hold_cancel returns the database\'s own usable_at').not.toBeNull();
    expect(sessions(x.u.id)).toBeGreaterThan(0);
    const r = await cancel(token);
    expect([r.status, await json(r)]).toEqual([200, { status: true }]);
    expect(e.count(`SELECT 1 FROM public.passkey WHERE id = '${id}'`)).toBe(0);
    expect(holds(e, x.u.id)[0]![6], 'cancelled_at').not.toBe('');
    expect(sessions(x.u.id), 'signed out everywhere').toBe(0);
    markSent(e, x.u.id);
    expect((await passkeySignIn(k)).r.status).toBeGreaterThanOrEqual(400);
    expect(outbox(e, x.u.id, 'method_removed').length, 'the cancel is itself a removal and is announced').toBe(1);
  });
  it('R3.10.5 refusals are all 400 cancel_link_invalid and change nothing: the same token again, a lapsed hold, a 31-byte token, a non-canonical encoding, a malformed body [red if: any of them cancels, or answers differently]', async () => {
    const x = await enrol(e, auth, mm);
    await addPasskey(x.u.id);
    const raw = tokenOf();
    const { token } = await arm(x.u.id, raw);
    const noncanon = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A'); // the last character carries 4 spare bits: same 32 bytes, not canonical
    const thirtyOne = randomBytes(31).toString('base64url');
    for (const [label, bad] of [['non-canonical', noncanon], ['31 bytes', thirtyOne], ['padded', token + '='], ['empty', ''], ['a number', 7], ['null', null]] as const) {
      const r = await cancel(bad);
      expect([r.status, (await json(r)).code], label).toEqual([400, 'cancel_link_invalid']);
    }
    expect(holds(e, x.u.id)[0]![6], 'still not cancelled').toBe('');
    const ok = await cancel(token);
    expect(ok.status).toBe(200);
    const again = await cancel(token);
    expect([again.status, (await json(again)).code], 'the same token again').toEqual([400, 'cancel_link_invalid']);
    // a lapsed hold: the method is live, so the link no longer cancels (a mailbox thief cannot remove a working method)
    const y = await enrol(e, auth, mm);
    await addPasskey(y.u.id);
    const live = await arm(y.u.id);
    markSent(e, y.u.id);
    const lapsed = await cancel(live.token);
    expect([lapsed.status, (await json(lapsed)).code]).toEqual([400, 'cancel_link_invalid']);
    expect(e.count(`SELECT 1 FROM public.passkey WHERE user_id = '${y.u.id}'`), 'the working method is untouched').toBe(1);
  });
  it('R3.10.5 GET to the route never cancels: 404 (or 405) [red if: a mail scanner opening the link cancels, or the route does not exist as POST]', async () => {
    const x = await enrol(e, auth, mm);
    await addPasskey(x.u.id);
    const { token } = await arm(x.u.id);
    const r = await e.handle(get(`/second-step/cancel-hold?token=${token}`), auth);
    expect([404, 405]).toContain(r.status);
    expect(holds(e, x.u.id)[0]![6]).toBe('');
    expect((await cancel(token)).status, 'the same token still works as a POST: the GET did not spend it').toBe(200);
  });
  it('R3.10.5 a cancel for user A carrying user B\'s session cookie cancels A\'s hold, raises no refusal, and leaves B\'s sessions alive (RC9) [red if: the cancel runs under B\'s marker]', async () => {
    const a = await enrol(e, auth, mm);
    await addPasskey(a.u.id);
    const b = await enrol(e, auth, mm);
    const bs = sessionWithHandle(e.db, b.u.id);
    const bCookie = await e.cookieForToken(bs.token, auth);
    const nB = sessions(b.u.id);
    const { token } = await arm(a.u.id);
    const r = await cancel(token, bCookie);
    expect([r.status, await json(r)]).toEqual([200, { status: true }]);
    expect(holds(e, a.u.id)[0]![6]).not.toBe('');
    expect(sessions(b.u.id), 'B is not signed out').toBe(nB);
  });
  it('R3.10.5 two passkeys held in one transaction, one token: both rows are gone and both holds are cancelled (RC4) [red if: a merged mail arms or cancels one hold]', async () => {
    const x = await enrol(e, auth, mm);
    const sid = (await freshCookie(e, auth, x.u.id)).id;
    await fx.committed('poly_auth', x.u.id, sid, async (q) => {
      for (const k of [softAuthenticator(), softAuthenticator()]) await q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, x.u.id, k.credentialId]);
    });
    const { token } = await arm(x.u.id);
    expect((await cancel(token)).status).toBe(200);
    expect(e.count(`SELECT 1 FROM public.passkey WHERE user_id = '${x.u.id}'`)).toBe(0);
    expect(holds(e, x.u.id).every((h) => h[6] !== '')).toBe(true);
    const rm = outbox(e, x.u.id, 'method_removed');
    expect(rm, 'one removal transaction, one mail').toHaveLength(1);
  });
  it('R3.10.5 a mail still unsent 25 hours after the add leaves the method refused; arming 23 hours late makes it usable 24 h after the arming and not before (RC2) [red if: the hold ends on the add clock]', async () => {
    const x = await enrol(e, auth, mm);
    const { k } = await addPasskey(x.u.id);
    must(`UPDATE app.method_hold SET usable_at = now() - interval '1 hour' WHERE user_id = '${x.u.id}'`, e.db); // the add was 25 h ago
    expect((await passkeySignIn(k)).j.code, 'unsent at 25 h').toBe('AUTHENTICATION_FAILED');
    const { until } = await arm(x.u.id);
    const hrs = Number(must(`SELECT extract(epoch FROM (usable_at - clock_timestamp())) / 3600 FROM app.method_hold WHERE user_id = '${x.u.id}'`, e.db).rows[0]![0]);
    expect(hrs, 'arming moved usable_at to 24 h after the arming').toBeGreaterThan(23.9);
    expect(hrs).toBeLessThan(24.1);
    expect(new Date(until as Date).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    expect((await passkeySignIn(k)).j.code, 'accepted but not yet usable').toBe('AUTHENTICATION_FAILED');
  });
  it('arm_hold_cancel only moves usable_at later and a re-arm replaces the hash [red if: arming can shorten a hold, or two hashes stay live]', async () => {
    const x = await enrol(e, auth, mm);
    await addPasskey(x.u.id);
    must(`UPDATE app.method_hold SET usable_at = now() + interval '90 hours' WHERE user_id = '${x.u.id}'`, e.db);
    const first = await arm(x.u.id);
    const left = Number(must(`SELECT extract(epoch FROM (usable_at - clock_timestamp())) / 3600 FROM app.method_hold WHERE user_id = '${x.u.id}'`, e.db).rows[0]![0]);
    expect(left, 'greatest(): never shortened').toBeGreaterThan(89);
    const second = await arm(x.u.id);
    expect((await cancel(first.token)).status, 'the first link no longer works').toBe(400);
    expect((await cancel(second.token)).status, 'only the last mail\'s link works').toBe(200);
  });
});

describe('R3.10.6 the R0 attacker: SQL as poly_auth with a forged marker and stamp can plant a method, and cannot hide it', () => {
  it('the plant is held and announced; poly_auth cannot read, change or delete either table, run the worker definers, change user.email, or write audit_event [red if: any of these is open]', async () => {
    const x = await enrol(e, auth, mm);
    const sid = (await freshCookie(e, auth, x.u.id)).id; // the forged stamp
    const k = softAuthenticator();
    await fx.committed('poly_auth', x.u.id, sid, (q) => q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, x.u.id, k.credentialId]));
    expect(holds(e, x.u.id)).toHaveLength(1);
    expect(outbox(e, x.u.id, 'method_added').length).toBeGreaterThan(0);
    const attempt = (sql: string, vals: unknown[] = []) => fails(fx.committed('poly_auth', x.u.id, sid, (q) => q(sql, vals)));
    const denied: [string, string, unknown[]?][] = [
      ['select the hold', 'SELECT * FROM app.method_hold'], ['update the hold', `UPDATE app.method_hold SET usable_at = now()`], ['delete the hold', 'DELETE FROM app.method_hold'],
      ['select the outbox', 'SELECT * FROM app.mail_outbox'], ['update the outbox', `UPDATE app.mail_outbox SET sent_at = now()`], ['delete the outbox', 'DELETE FROM app.mail_outbox'],
      ['forge an audit row', `INSERT INTO public.audit_event (actor, kind, subject_user_id, payload) VALUES ('operator', 'second_step.method_removed', $1, '{}'::jsonb)`, [x.u.id]],
    ];
    for (const [label, sql, vals] of denied) {
      const r = await attempt(sql, vals ?? []);
      expect(r, label).not.toBeNull();
      expect([codeOf(r), msgOf(r)], label).toEqual(['42501', expect.stringMatching(/permission denied/)]);
    }
    for (const f of ['SELECT * FROM app.claim_mail()', 'SELECT app.mail_sent($1)', `SELECT app.arm_hold_cancel($1, decode('00', 'hex'))`]) {
      const r = await attempt(f, f.includes('$1') ? [crypto.randomUUID()] : []);
      expect([codeOf(r), msgOf(r)], f).toEqual(['42501', expect.stringMatching(/permission denied for function/)]);
    }
    const em = await attempt(`UPDATE public."user" SET email = 'attacker@evil.test' WHERE id = $1`, [x.u.id]);
    expect([codeOf(em), msgOf(em)], 'D1: no login role changes the address').toEqual(['42501', expect.stringMatching(/a user's email is changed by no login role/)]);
    expect(must(`SELECT email FROM public."user" WHERE id = '${x.u.id}'`, e.db).rows[0]![0]).toBe(x.u.email);
    // positive cases: the legitimate calls on the same connection pass
    expect(await attempt('SELECT app.method_held($1, $2)', ['passkey', crypto.randomUUID()]), 'method_held is poly_auth\'s').toBeNull();
    expect(await attempt(`UPDATE public."user" SET name = 'Renamed' WHERE id = $1`, [x.u.id]), 'other columns of user stay writable').toBeNull();
  });
});
