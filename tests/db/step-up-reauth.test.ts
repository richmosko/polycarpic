// POLY-150h (ruling Addendum 3 A6 T1-T9 and C3, and Addendum 4's error table): Confirm it's you, through the real handler on poly_auth. Real Postgres.
// D7 is decided (b) (Addendum 5): a backup code is a re-check, so the backup-code path (A3.3, T6) is tested here, and `method_refused` is gone.
// Every refusal reads `recent_auth_at` back unchanged. Titles end [red if: ...]. Red today: the three routes are not in AUTH_ROUTES (404) and 0019 does not exist.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, post, teardown, type Env } from './helpers/auth';
import { sessionWithHandle } from './helpers/handle';
import { PATHS, factor, lapseLock, lockMinutes, recordCount, streakOf, wrongTotp, type Factor } from './helpers/lock';
import { codeOf, fails, fixture, refusedUnchanged, totp } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); fx = fixture(e.db, 151); });
afterAll(() => teardown(e));
void PATHS;

const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const stamp = (sid: string): string => must(`SELECT coalesce(recent_auth_at::text, 'NULL') FROM public.session WHERE id = '${sid}'`, e.db).rows[0]![0]!;
type S = { id: string; token: string; cookie: string };
/** An enrolled user with a session that has no step-up stamp (the state after the 5-minute window). */
async function stale(f: Factor): Promise<S> {
  const s = sessionWithHandle(e.db, f.u.id);
  return { ...s, cookie: await e.cookieForToken(s.token, f.auth) };
}
async function setup() { const f = await factor(e, mails); return { f, s: await stale(f) }; }
const call = (f: Factor, s: S, path: string, body: unknown) => e.handle(post(path, body, s.cookie), f.auth);
const begin = async (f: Factor, s: S, method: 'totp' | 'passkey' = 'totp') => { const r = await call(f, s, '/second-step/reauth/begin', { method }); return { r, j: await json(r) }; };
// The enrolment's verify spent the CURRENT step (A3.4: a code accepted at sign-in or first enrolment cannot then pass a re-check), so a re-check uses the NEXT step (30 s on, inside the +-1 window).
const reauth = (f: Factor, s: S, challengeId: string, o: Record<string, unknown> = {}) => call(f, s, '/second-step/reauth', { challengeId, password: PW, code: totp(f.secret, Date.now() + 30_000), ...o });
/** A step-up probe: BetterAuth's /two-factor/generate-backup-codes is the step-up class, so 200 means fresh and 403 means stale. */
const probe = async (f: Factor, s: S) => (await call(f, s, '/two-factor/generate-backup-codes', { password: PW })).status;
const setLock = (uid: string, minutes: number) => must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() + interval '${minutes} minutes' WHERE user_id = '${uid}'; COMMIT;`, e.db);
function addPasskey(uid: string, counter = 0) {
  const k = softAuthenticator();
  must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${uid}', '${k.credentialId}', ${counter}, 'singleDevice', false, 'internal')`, e.db);
  return k;
}
async function passkeyReauth(f: Factor, s: S, k: ReturnType<typeof softAuthenticator>, counter = 1) {
  const b = await begin(f, s, 'passkey');
  expect(b.r.status, `begin passkey: ${JSON.stringify(b.j)}`).toBe(200);
  const r = await call(f, s, '/second-step/reauth/passkey', { challengeId: b.j.challengeId, response: k.assert({ challenge: b.j.options.challenge }, counter) });
  return { b, r };
}

describe('success, and what a success leaves (Addendum 4: 200 {status: true}, no cookie, no rotation)', () => {
  it('begin -> reauth with password and a TOTP code: 200 {status: true}, no Set-Cookie, the session\'s stamp is set, and a step-up action now runs; before it, the action was refused [red if: the stamp is not written, or the route rotates the session (C3)]', async () => {
    const { f, s } = await setup();
    expect(stamp(s.id)).toBe('NULL');
    expect(await probe(f, s), 'C3: stale, so the step-up class refuses').toBe(403);
    const b = await begin(f, s);
    expect(b.r.status, JSON.stringify(b.j)).toBe(200);
    expect(b.j.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.j.options, 'options are for passkey only').toBeUndefined();
    const r = await reauth(f, s, b.j.challengeId);
    expect(r.status, JSON.stringify(await json(r))).toBe(200);
    expect(await json(r)).toEqual({ status: true });
    expect(r.headers.getSetCookie(), 'a success sets no cookie and does not rotate').toEqual([]);
    expect(stamp(s.id)).not.toBe('NULL');
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${f.u.id}' AND id = '${s.id}'`), 'the same session row').toBe(1);
    expect(await probe(f, s), 'C3: fresh now').toBe(200);
  });
  it('a wrong code, then the right code on the SAME challengeId, passes: a wrong password or code does not consume the challenge [red if: a wrong attempt burns the challenge]', async () => {
    const { f, s } = await setup();
    const b = await begin(f, s);
    const bad = await reauth(f, s, b.j.challengeId, { code: wrongTotp(f.secret) });
    expect(bad.status).toBe(403);
    expect((await json(bad)).code).toBe('step_up_failed');
    expect(stamp(s.id)).toBe('NULL');
    const bad2 = await reauth(f, s, b.j.challengeId, { password: 'not the password at all' });
    expect((await json(bad2)).code).toBe('step_up_failed');
    expect((await reauth(f, s, b.j.challengeId)).status).toBe(200);
    expect(stamp(s.id)).not.toBe('NULL');
  });
  it('T9: one step_up record row per success, with the method; none for a refusal [red if: a stamp stands without its record]', async () => {
    const { f, s } = await setup();
    const before = recordCount(e.db, f.u.id, 'step_up');
    const b = await begin(f, s);
    await reauth(f, s, b.j.challengeId, { code: wrongTotp(f.secret) });
    expect(recordCount(e.db, f.u.id, 'step_up'), 'a refusal writes no step_up row').toBe(before);
    await reauth(f, s, b.j.challengeId);
    expect(recordCount(e.db, f.u.id, 'step_up')).toBe(before + 1);
    expect(must(`SELECT method, session_id FROM app.sign_in_record WHERE user_id = '${f.u.id}' AND kind = 'step_up'`, e.db).rows[0]).toEqual(['totp', s.id]);
  });
});

describe('T1 replay, and the errors table (status and code, one per row)', () => {
  it('T1: the same /second-step/reauth request twice: the second answers 403 challenge_expired and the challenge row is gone after the first [red if: a challenge can be spent twice]', async () => {
    const { f, s } = await setup();
    const b = await begin(f, s);
    const body = { challengeId: b.j.challengeId, password: PW, code: totp(f.secret, Date.now() + 30_000) };
    expect((await call(f, s, '/second-step/reauth', body)).status).toBe(200);
    expect(e.count(`SELECT 1 FROM app.step_up_challenge WHERE id = '${b.j.challengeId}'`), 'the challenge is deleted by the success').toBe(0);
    const again = await call(f, s, '/second-step/reauth', body);
    expect(again.status).toBe(403);
    expect((await json(again)).code, 'a used challengeId').toBe('challenge_expired');
  });
  it('401 with no session on all three routes [red if: a route answers without a session]', async () => {
    const f = await factor(e, mails);
    for (const [p, b] of [['/second-step/reauth/begin', { method: 'totp' }], ['/second-step/reauth', {}], ['/second-step/reauth/passkey', {}]] as const) {
      expect((await e.handle(post(p, b), f.auth)).status, p).toBe(401);
    }
  });
  it('400 invalid_request: a missing field, an extra field, a challengeId that is not a uuid, a code that is not 6 digits, both code and backupCode, an unknown method [red if: a malformed body reaches the checks]', async () => {
    const { f, s } = await setup();
    const b = await begin(f, s);
    const id = b.j.challengeId;
    const cases: [string, string, unknown][] = [
      ['/second-step/reauth', 'missing password', { challengeId: id, code: '123456' }],
      ['/second-step/reauth', 'extra field', { challengeId: id, password: PW, code: '123456', userId: f.u.id }],
      ['/second-step/reauth', 'challengeId not a uuid', { challengeId: 'not-a-uuid', password: PW, code: '123456' }],
      ['/second-step/reauth', 'code not 6 digits', { challengeId: id, password: PW, code: '12345' }],
      ['/second-step/reauth', 'code not a string', { challengeId: id, password: PW, code: 123456 }],
      ['/second-step/reauth', 'both code and backupCode', { challengeId: id, password: PW, code: '123456', backupCode: 'abc' }],
      ['/second-step/reauth/begin', 'unknown method', { method: 'sms' }],
      ['/second-step/reauth/begin', 'no method', {}],
      ['/second-step/reauth/passkey', 'missing response', { challengeId: id }],
    ];
    for (const [path, label, body] of cases) {
      const r = await call(f, s, path, body);
      expect(r.status, label).toBe(400);
      expect((await json(r)).code, label).toBe('invalid_request');
    }
    expect(stamp(s.id)).toBe('NULL');
  });
  it('403 no_second_step for a user with no second step; 403 method_unavailable for a method the user has not set up [red if: begin opens a challenge it cannot finish]', async () => {
    const u = e.seedUser();
    const sess = sessionWithHandle(e.db, u.id);
    const cookie = await e.cookieForToken(sess.token);
    const none = await e.handle(post('/second-step/reauth/begin', { method: 'totp' }, cookie));
    expect([none.status, (await json(none)).code]).toEqual([403, 'no_second_step']);
    const { f, s } = await setup(); // TOTP only
    const pk = await begin(f, s, 'passkey');
    expect([pk.r.status, pk.j.code]).toEqual([403, 'method_unavailable']);
  });
  it('403 step_up_failed is ONE answer: a wrong password and a wrong code give the same status and body [red if: the answer tells which was wrong (M6)]', async () => {
    const { f, s } = await setup();
    const b = await begin(f, s);
    const wrongPw = await reauth(f, s, b.j.challengeId, { password: 'wrong wrong wrong' });
    const wrongCode = await reauth(f, s, b.j.challengeId, { code: wrongTotp(f.secret) });
    expect([wrongPw.status, await json(wrongPw)]).toEqual([403, { code: 'step_up_failed', message: 'step_up_failed' }]);
    expect([wrongCode.status, await json(wrongCode)]).toEqual([403, { code: 'step_up_failed', message: 'step_up_failed' }]);
  });
  it('403 challenge_expired: no such challenge, another session\'s challenge, another method\'s challenge, and an expired one [red if: a challenge is honoured outside its session, method or 5 minutes]', async () => {
    const { f, s } = await setup();
    const none = await reauth(f, s, '00000000-0000-4000-8000-000000000000');
    expect([none.status, (await json(none)).code]).toEqual([403, 'challenge_expired']);
    const s2 = await stale(f);
    const b2 = await begin(f, s2);
    const foreign = await reauth(f, s, b2.j.challengeId);
    expect([foreign.status, (await json(foreign)).code], 'another session\'s challenge').toEqual([403, 'challenge_expired']);
    expect(stamp(s.id)).toBe('NULL');
    const k = addPasskey(f.u.id);
    const bp = await begin(f, s, 'passkey');
    const wrongMethod = await reauth(f, s, bp.j.challengeId); // a passkey challenge used by the code route
    expect([wrongMethod.status, (await json(wrongMethod)).code], 'another method\'s challenge').toEqual([403, 'challenge_expired']);
    void k;
    const b = await begin(f, s);
    must(`UPDATE app.step_up_challenge SET expires_at = now() - interval '1 second' WHERE id = '${b.j.challengeId}'`, e.db);
    const old = await reauth(f, s, b.j.challengeId);
    expect([old.status, (await json(old)).code], 'an expired challenge').toEqual([403, 'challenge_expired']);
    expect(stamp(s.id)).toBe('NULL');
  });
});

describe('D7 (b): a backup code is a re-check, with the password (A3.3: the stamp first, then the list, under the deferred evidence check)', () => {
  const listOf = (uid: string) => must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${uid}'`, e.db).rows[0]![0]!;
  const bc = (f: Factor, s: S, challengeId: string, backupCode: string, password = PW) => call(f, s, '/second-step/reauth', { challengeId, password, backupCode });
  it('begin accepts backup_code; a right code with the password stamps the session, shortens the stored list, and writes a step_up row saying backup_code; the same code a second time is refused [red if: a backup code cannot re-check, is reusable, or the list is not written (T6)]', async () => {
    const { f, s } = await setup();
    const before = listOf(f.u.id);
    const b = await call(f, s, '/second-step/reauth/begin', { method: 'backup_code' });
    expect(b.status, JSON.stringify(await json(b))).toBe(200);
    const id = (await json(b)).challengeId;
    const r = await bc(f, s, id, f.backupCodes[0]!);
    expect(r.status, JSON.stringify(await json(r))).toBe(200);
    expect(stamp(s.id)).not.toBe('NULL');
    expect(listOf(f.u.id), 'the stored list changed in the same transaction').not.toBe(before);
    expect(must(`SELECT method FROM app.sign_in_record WHERE user_id = '${f.u.id}' AND kind = 'step_up'`, e.db).rows[0]![0]).toBe('backup_code');
    // used twice: refused, in a fresh session
    const s2 = await stale(f);
    const b2 = await call(f, s2, '/second-step/reauth/begin', { method: 'backup_code' });
    const again = await bc(f, s2, (await json(b2)).challengeId, f.backupCodes[0]!);
    expect([again.status, (await json(again)).code], 'a used code never works twice').toEqual([403, 'step_up_failed']);
    expect(stamp(s2.id)).toBe('NULL');
    // a different code still works
    const b3 = await call(f, s2, '/second-step/reauth/begin', { method: 'backup_code' });
    expect((await bc(f, s2, (await json(b3)).challengeId, f.backupCodes[1]!)).status).toBe(200);
  });
  it('a wrong password with a right code, and a wrong code with the right password, are the one step_up_failed answer and consume no code [red if: a refusal spends a backup code]', async () => {
    const { f, s } = await setup();
    const before = listOf(f.u.id);
    const id = (await json(await call(f, s, '/second-step/reauth/begin', { method: 'backup_code' }))).challengeId;
    const a = await bc(f, s, id, f.backupCodes[0]!, 'wrong wrong wrong');
    const b = await bc(f, s, id, 'not-a-backup-code');
    expect([a.status, (await json(a)).code, b.status, (await json(b)).code]).toEqual([403, 'step_up_failed', 403, 'step_up_failed']);
    expect(listOf(f.u.id)).toBe(before);
    expect(stamp(s.id)).toBe('NULL');
  });
  it('A3.3 in both orders, as poly_auth SQL: a stamp with the list unwritten fails at COMMIT and rolls everything back; the list written before the stamp is refused by guard #5 [red if: a stamp can stand without the list write, or the list can be written without the stamp]', async () => {
    const { f, s } = await setup();
    const before = listOf(f.u.id);
    const step = 0;
    const noList = await fails(fx.committed('poly_auth', f.u.id, s.id, async (q) => {
      const id = (await q('SELECT app.begin_step_up($1, $2)', ['backup_code', null])).rows[0].begin_step_up;
      await q('SELECT app.complete_step_up($1, $2, $3)', ['backup_code', id, step]); // the stamp, and the list is never written
    }));
    expect(noList, 'the deferred evidence check raises at commit').not.toBeNull();
    expect(stamp(s.id), 'the whole transaction rolled back, the stamp included').toBe('NULL');
    expect(e.count(`SELECT 1 FROM app.step_up_challenge WHERE session_id = '${s.id}'`), 'and the challenge is as it was (none: begin rolled back too)').toBe(0);
    const first = await fails(fx.marked('poly_auth', f.u.id, s.id, (q) => q(`UPDATE public.two_factor SET backup_codes = 'replaced' WHERE user_id = $1`, [f.u.id])));
    expect(codeOf(first), 'the list written before any stamp is refused by guard #5').toBe('42501');
    expect(listOf(f.u.id)).toBe(before);
  });
  it('the shared counter and lock: 10 wrong backup codes lock the factor; during the lock a backup-code re-check answers 429 ACCOUNT_TEMPORARILY_LOCKED with no pausedFor and the code is not spent [red if: backup codes have their own counter or bypass the lock]', async () => {
    const { f, s } = await setup();
    const id = (await json(await call(f, s, '/second-step/reauth/begin', { method: 'backup_code' }))).challengeId;
    for (let i = 0; i < 10; i++) expect((await json(await bc(f, s, id, `wrong-${i}`))).code, `wrong backup code ${i + 1}`).toBe('step_up_failed');
    expect(recordCount(e.db, f.u.id, 'second_step_failure')).toBe(10);
    const before = listOf(f.u.id);
    const locked = await bc(f, s, id, f.backupCodes[0]!);
    expect(locked.status).toBe(429);
    const j = await json(locked);
    expect([j.code, j.pausedFor]).toEqual(['ACCOUNT_TEMPORARILY_LOCKED', undefined]);
    expect(listOf(f.u.id), 'the right code during a lock is not consumed').toBe(before);
    expect(stamp(s.id)).toBe('NULL');
  });
  it('an unknown method is still 400 invalid_request (nothing refuses a method by name now) [red if: the route is missing]', async () => {
    const { f, s } = await setup();
    const r = await call(f, s, '/second-step/reauth/begin', { method: 'sms' });
    expect([r.status, (await json(r)).code]).toEqual([400, 'invalid_request']);
  });
});

describe('a refused reused TOTP step rolls back: it neither counts as a wrong code nor resets the counter (seceng, Addendum 4)', () => {
  it('with failed_verification_count at 3, a reused step is refused 403 step_up_failed and the count is still 3, no second_step_failure row is added [red if: a reuse counts as a wrong code, or resets the counter]', async () => {
    const f = await factor(e, mails);
    const { heldSignIn } = await import('./helpers/auth-service');
    const held = await heldSignIn(e, f.auth, f.u.email);
    const code = totp(f.secret);
    expect((await e.handle(post('/two-factor/verify-totp', { code }, held.cookie), f.auth)).status).toBe(200); // spends the step
    const s = await stale(f);
    must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET failed_verification_count = 3 WHERE user_id = '${f.u.id}'; COMMIT;`, e.db);
    const failures = recordCount(e.db, f.u.id, 'second_step_failure');
    const b = await begin(f, s);
    const r = await reauth(f, s, b.j.challengeId, { code });
    expect([r.status, (await json(r)).code]).toEqual([403, 'step_up_failed']);
    expect(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0], 'not +1 and not reset').toBe('3');
    expect(recordCount(e.db, f.u.id, 'second_step_failure')).toBe(failures);
  });
});

describe('T2 a TOTP code is spent once, across sessions and steps', () => {
  it('a code accepted at a held sign-in is refused at a re-check within its window; the same between two sessions; an earlier step is refused too [red if: the step guard is missing (M3)]', async () => {
    const f = await factor(e, mails);
    const { heldSignIn } = await import('./helpers/auth-service');
    const held = await heldSignIn(e, f.auth, f.u.email);
    const code = totp(f.secret);
    const ok = await e.handle(post('/two-factor/verify-totp', { code }, held.cookie), f.auth);
    expect(ok.status, 'the sign-in accepts it').toBe(200);
    const s = await stale(f);
    const b = await begin(f, s);
    const reuse = await reauth(f, s, b.j.challengeId, { code });
    expect([reuse.status, (await json(reuse)).code], 'the same code at a re-check').toEqual([403, 'step_up_failed']);
    expect(stamp(s.id)).toBe('NULL');
    // an earlier step (a code from 30 s ago) is not later than the one accepted
    const earlier = await reauth(f, s, b.j.challengeId, { code: totp(f.secret, Date.now() - 30_000) });
    expect((await json(earlier)).code, 'an earlier step').toBe('step_up_failed');
    // a later step passes once, then neither it nor an earlier one passes in a second session of the same user
    const later = await reauth(f, s, b.j.challengeId, { code: totp(f.secret, Date.now() + 30_000) });
    expect(later.status, 'a later step passes').toBe(200);
    const s2 = await stale(f);
    const b2 = await begin(f, s2);
    const again = await reauth(f, s2, b2.j.challengeId, { code: totp(f.secret, Date.now() + 30_000) });
    expect([again.status, (await json(again)).code], 'the same code in a second session of the same user').toEqual([403, 'step_up_failed']);
    expect(stamp(s2.id)).toBe('NULL');
  });
});

describe('T3 forgery and confusion; T4 catalog', () => {
  it('begin_step_up and complete_step_up as poly_app: permission denied [red if: poly_app can execute either]', async () => {
    const { f, s } = await setup();
    for (const sql of ['SELECT app.begin_step_up($1, $2)', 'SELECT app.complete_step_up($1, $2, $3)']) {
      const x = await fails(fx.marked('poly_app', f.u.id, s.id, (q) => q(sql, sql.includes('begin') ? ['totp', null] : ['totp', '00000000-0000-4000-8000-000000000000', 1])));
      expect(x, sql).not.toBeNull();
      expect(codeOf(x), sql).toBe('42501');
    }
  });
  it('as poly_auth with no marker, under a signup marker, and outside the exact call: 42501 and the stamp unchanged [red if: the marker kind or the exact-call check is not enforced]', async () => {
    const { f, s } = await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    const noMarker = await fails(fx.marked('poly_auth', null, null, (q) => q('SELECT app.complete_step_up($1, $2, $3)', ['totp', id, 1])));
    expect(codeOf(noMarker), 'no marker').toBe('42501');
    const signup = await fails(fx.marked('poly_auth', null, null, async (q) => { await q('SELECT app.enter_new_user($1)', [f.u.id]); return q('SELECT app.begin_step_up($1, $2)', ['totp', null]); }));
    expect(codeOf(signup), 'a signup marker').toBe('42501');
    const literal = await fails(fx.marked('poly_auth', f.u.id, s.id, (q) => q(`SELECT app.complete_step_up('totp', '${id}', 1)`)));
    expect(codeOf(literal), 'outside the exact call').toBe('42501');
    expect(stamp(s.id)).toBe('NULL');
  });
  it('a direct UPDATE of session.recent_auth_at as poly_auth is refused, and the value is unchanged [red if: any writer but complete_step_up can stamp]', async () => {
    const { f, s } = await setup();
    const x = await refusedUnchanged(() => stamp(s.id), () => fx.marked('poly_auth', f.u.id, s.id, (q) => q('UPDATE public.session SET recent_auth_at = now() WHERE id = $1', [s.id]), { code: '42501', message: /recent_auth_at is written only by/ }));
    expect(codeOf(x)).toBe('42501');
  });
  it('begin_step_up for a user with no second step, and under a session id with no row, is refused [red if: a challenge can be opened for a user who cannot finish it, or for no session]', async () => {
    const plain = e.seedUser();
    const ps = sessionWithHandle(e.db, plain.id);
    const x = await fails(fx.marked('poly_auth', plain.id, ps.id, (q) => q('SELECT app.begin_step_up($1, $2)', ['totp', null])));
    expect(codeOf(x), 'a user with no second step').toBe('42501');
    const y = await fails(fx.marked('poly_auth', plain.id, '00000000-0000-4000-8000-0000000000aa', (q) => q('SELECT app.begin_step_up($1, $2)', ['totp', null])));
    expect(y, 'a session id with no row cannot even enter').not.toBeNull();
    // (another user's session cannot be built as a marker: enter_auth_session takes the user from the session row, so the wrong-session case is the
    // other-session challenge, covered by "403 challenge_expired" above)
  });
  it('T4: the four definers are owned by poly_govern, SECURITY DEFINER, search_path empty, EXECUTE poly_auth only; only complete_step_up (and 0013\'s two) assign recent_auth_at; only poly_govern holds UPDATE (recent_auth_at) on session [red if: a grant or a second writer exists]', () => {
    for (const fn of ['begin_step_up(text,bytea)', 'complete_step_up(text,uuid,bigint)', 'note_totp_step(uuid,bigint)', 'record_step_up_failure()', 'step_up_challenge_hash(uuid)']) {
      const r = must(`SELECT pg_get_userbyid(proowner), prosecdef, array_to_string(proconfig, ','), (SELECT string_agg(grantee::regrole::text, ',' ORDER BY grantee::regrole::text) FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) WHERE privilege_type = 'EXECUTE' AND grantee <> proowner) FROM pg_proc WHERE oid = to_regprocedure('app.${fn}')`, e.db).rows[0];
      expect(r, `app.${fn} exists`).toBeTruthy();
      expect(r!.slice(0, 2), fn).toEqual(['poly_govern', 't']);
      expect(r![2], fn).toMatch(/search_path=""/);
      expect(r![3], `${fn}: EXECUTE`).toBe('poly_auth');
    }
    const writers = must(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app','public') AND p.prosrc ~* 'recent_auth_at\\s*=' ORDER BY 1`, e.db).rows.map((x: any) => x[0]);
    expect(writers.filter((w: string) => w === 'complete_step_up'), 'complete_step_up assigns it').toEqual(['complete_step_up']);
    expect(writers.length, 'complete_step_up plus 0013\'s two and no other').toBeLessThanOrEqual(3);
    const holders = must(`SELECT r.rolname FROM pg_roles r WHERE r.rolcanlogin = false OR r.rolcanlogin = true`, e.db).rows.map((x: any) => x[0]).filter((r: string) => must(`SELECT has_column_privilege('${r}', 'public.session', 'recent_auth_at', 'UPDATE')`, e.db).rows[0]![0] === 't' && !/^(postgres|poly_owner|poly_migrator|pg_)/.test(r));
    expect(holders.sort(), 'effective UPDATE (recent_auth_at)').toEqual(['poly_govern']);
  });
});

describe('Addendum 6: app.step_up_challenge_hash(uuid) returns the stored hash only for the caller\'s own user and session, passkey only, unexpired; it does not consume', () => {
  const HASH = 'ab'.repeat(32);
  it('the own session reads the hash; another session of the same user, another user, a totp challenge and an expired challenge all read NULL, and the challenge is not consumed [red if: the hash can be read across sessions or users, or reading spends the challenge]', async () => {
    const { f, s } = await setup();
    addPasskey(f.u.id);
    const s2 = await stale(f);
    const other = await factor(e, mails);
    addPasskey(other.u.id);
    const so = await stale(other);
    const open = (sid: string, uid: string, method: string, hash: string | null) => fx.committed('poly_auth', uid, sid, async (q) => (await q('SELECT app.begin_step_up($1, $2)', [method, hash ? Buffer.from(hash, 'hex') : null])).rows[0].begin_step_up as string);
    const read = (sid: string, uid: string, id: string) => fx.marked('poly_auth', uid, sid, async (q) => (await q('SELECT app.step_up_challenge_hash($1)', [id])).rows[0].step_up_challenge_hash as Buffer | null);
    const id = await open(s.id, f.u.id, 'passkey', HASH);
    expect((await read(s.id, f.u.id, id))?.toString('hex'), 'own user and session').toBe(HASH);
    expect(await read(s2.id, f.u.id, id), 'another session of the same user').toBeNull();
    expect(await read(so.id, other.u.id, id), 'another user').toBeNull();
    expect(e.count(`SELECT 1 FROM app.step_up_challenge WHERE id = '${id}'`), 'reading does not consume the challenge').toBe(1);
    const totpId = await open(s2.id, f.u.id, 'totp', null);
    expect(await read(s2.id, f.u.id, totpId), 'a totp challenge has no hash').toBeNull();
    must(`UPDATE app.step_up_challenge SET expires_at = now() - interval '1 second' WHERE id = '${id}'`, e.db);
    expect(await read(s.id, f.u.id, id), 'an expired challenge').toBeNull();
    const x = await fails(fx.marked('poly_app', f.u.id, s.id, (q) => q('SELECT app.step_up_challenge_hash($1)', [id])));
    expect(codeOf(x), 'poly_app cannot execute it').toBe('42501');
  });
});

describe('T5 the shared counter and the lock; a passkey re-check passes during a lock', () => {
  it('10 wrong re-check codes lock the factor with 10 second_step_failure rows; the 2nd lock is 30 minutes; during a lock the code paths answer 429 ACCOUNT_TEMPORARILY_LOCKED with no pausedFor and a passkey re-check still passes [red if: the re-check has its own counter, no lock, or a band]', async () => {
    const { f, s } = await setup();
    const k = addPasskey(f.u.id);
    const b = await begin(f, s);
    for (let i = 0; i < 10; i++) expect((await json(await reauth(f, s, b.j.challengeId, { code: wrongTotp(f.secret) }))).code, `wrong code ${i + 1}`).toBe('step_up_failed');
    expect(recordCount(e.db, f.u.id, 'second_step_failure'), 'refusals commit: ten counted wrong codes').toBe(10);
    expect(lockMinutes(e.db, f.u.id)).toBeGreaterThan(14);
    expect(lockMinutes(e.db, f.u.id)).toBeLessThan(16);
    const locked = await reauth(f, s, b.j.challengeId);
    expect(locked.status).toBe(429);
    const lj = await json(locked);
    expect(lj.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(lj.pausedFor, 'this caller has a session: no band (Addendum 4)').toBeUndefined();
    const beginLocked = await call(f, s, '/second-step/reauth/begin', { method: 'totp' });
    expect([beginLocked.status, (await json(beginLocked)).code], 'begin totp during a lock').toEqual([429, 'ACCOUNT_TEMPORARILY_LOCKED']);
    expect(stamp(s.id)).toBe('NULL');
    const { r } = await passkeyReauth(f, s, k);
    expect(r.status, 'the passkey path stays open during a lock').toBe(200);
    expect(stamp(s.id)).not.toBe('NULL');
    // the second lock is the doubled one
    lapseLock(e.db, f.u.id);
    const s2 = await stale(f);
    const b2 = await begin(f, s2);
    for (let i = 0; i < 10; i++) await reauth(f, s2, b2.j.challengeId, { code: wrongTotp(f.secret) });
    expect(Math.abs(lockMinutes(e.db, f.u.id) - 30), 'the 2nd lock').toBeLessThanOrEqual(1);
    expect(streakOf(e.db, f.u.id)).toBe(2);
  });
});

describe('T7 the passkey path', () => {
  it('stamps the EXISTING session: no new session row, no Set-Cookie; the counter is written back; a step_up record says passkey [red if: the passkey check signs in, rotates, or does not stamp]', async () => {
    const { f, s } = await setup();
    const k = addPasskey(f.u.id, 0);
    const sessionsBefore = e.count(`SELECT 1 FROM public.session WHERE user_id = '${f.u.id}'`);
    const { b, r } = await passkeyReauth(f, s, k, 5);
    expect(b.j.options.userVerification, 'user verification required').toBe('required');
    expect(b.j.options.allowCredentials?.length, 'allowCredentials: this user\'s passkeys').toBe(1);
    expect(r.status, JSON.stringify(await json(r))).toBe(200);
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${f.u.id}'`), 'no new session').toBe(sessionsBefore);
    expect(stamp(s.id)).not.toBe('NULL');
    expect(must(`SELECT counter FROM public.passkey WHERE credential_id = '${k.credentialId}'`, e.db).rows[0]![0]).toBe('5');
    expect(must(`SELECT method FROM app.sign_in_record WHERE user_id = '${f.u.id}' AND kind = 'step_up'`, e.db).rows[0]![0]).toBe('passkey');
  });
  it('an assertion for ANOTHER USER\'s credential is refused 403 step_up_failed, the challenge is consumed and a step_up_failure row is written; nothing is stamped [red if: a foreign passkey passes, or a failed assertion leaves the challenge open]', async () => {
    const { f, s } = await setup();
    addPasskey(f.u.id);
    const other = await factor(e, mails);
    const foreign = addPasskey(other.u.id);
    const b = await begin(f, s, 'passkey');
    const before = recordCount(e.db, f.u.id, 'step_up_failure');
    const r = await call(f, s, '/second-step/reauth/passkey', { challengeId: b.j.challengeId, response: foreign.assert({ challenge: b.j.options.challenge }, 1) });
    expect([r.status, (await json(r)).code]).toEqual([403, 'step_up_failed']);
    expect(stamp(s.id)).toBe('NULL');
    expect(recordCount(e.db, f.u.id, 'step_up_failure'), 'the failed assertion is recorded').toBe(before + 1);
    const again = await call(f, s, '/second-step/reauth/passkey', { challengeId: b.j.challengeId, response: foreign.assert({ challenge: b.j.options.challenge }, 2) });
    expect((await json(again)).code, 'a failed passkey consumes the challenge').toBe('challenge_expired');
  });
  it('a counter LOWER than the stored one is refused; the stored counter does not go down [red if: a cloned authenticator replays (A3.5)]', async () => {
    const { f, s } = await setup();
    const k = addPasskey(f.u.id, 9);
    const { r } = await passkeyReauth(f, s, k, 3);
    expect([r.status, (await json(r)).code]).toEqual([403, 'step_up_failed']);
    expect(stamp(s.id)).toBe('NULL');
    expect(must(`SELECT counter FROM public.passkey WHERE credential_id = '${k.credentialId}'`, e.db).rows[0]![0]).toBe('9');
  });
});

describe('T8 the window, on the database clock', () => {
  it('a stamp 299 s old still unlocks the step-up class; one 301 s old does not [red if: the window is not 300 s]', async () => {
    const { f, s } = await setup();
    const age = (sec: number) => must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.session SET recent_auth_at = now() - interval '${sec} seconds' WHERE id = '${s.id}'; COMMIT;`, e.db);
    age(299);
    expect(await probe(f, s), '299 s').toBe(200);
    age(301);
    expect(await probe(f, s), '301 s').toBe(403);
  });
});

describe('T9 the record comes from the database; the measurements', () => {
  it('complete_step_up called directly as SQL on poly_auth (the route bypassed) still writes its step_up row [red if: the record is written by service code]', async () => {
    const { f, s } = await setup();
    const before = recordCount(e.db, f.u.id, 'step_up');
    const step = Math.floor(Date.now() / 1000 / 30) + 1;
    const ok = await fx.committed('poly_auth', f.u.id, s.id, async (q) => {
      const id = (await q('SELECT app.begin_step_up($1, $2)', ['totp', null])).rows[0].begin_step_up;
      return (await q('SELECT app.complete_step_up($1, $2, $3)', ['totp', id, step])).rows[0].complete_step_up;
    });
    expect(ok).toBe(true);
    expect(recordCount(e.db, f.u.id, 'step_up'), 'the row comes from the database').toBe(before + 1);
    expect(stamp(s.id)).not.toBe('NULL');
  });
  it('M15 measured: /change-email answers a refusal today (BetterAuth\'s changeEmail is not enabled), and never a success [red if: the route changes the email]', async () => {
    const { f, s } = await setup();
    const r = await call(f, s, '/change-email', { newEmail: 'new-address@qa.test' });
    expect(r.status, `answered ${r.status} ${JSON.stringify(await json(r))}`).toBeGreaterThanOrEqual(400);
    expect(must(`SELECT email FROM public."user" WHERE id = '${f.u.id}'`, e.db).rows[0]![0]).toBe(f.u.email);
  });
  it('backup-code storage measured: the stored list is one encrypted string, not a JSON array of plain codes [red if: backup codes are readable in the row]', async () => {
    const f = await factor(e, mails);
    const raw = must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0]!;
    for (const c of f.backupCodes) expect(raw).not.toContain(c);
    expect(raw.length).toBeGreaterThan(40);
  });
});
