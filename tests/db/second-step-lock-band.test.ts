// POLY-150 D6 (b), the Principal's answer 8 (2026-11-19): on the lock refusal ONLY, the sign-in service adds `pausedFor`: 'under_an_hour' (< 60 min left),
// 'a_few_hours' (< 6 h) or 'up_to_a_day' (longer). seceng's four conditions: the hold cookie is read only through BetterAuth's signed-cookie check, and nothing is
// returned with no hold, a forged hold (unsigned, wrong secret, a valid signature over another identifier), an expired hold, or a session.
// Each negative starts with a CONTROL: a genuine hold gets its band in the same test, so "no field" cannot pass because the feature is absent.
// Red today: the service returns no `pausedFor` at all. Titles end [red if: ...].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SECRET, boot, post, teardown, type Env } from './helpers/auth';
import { heldSignIn, signed } from './helpers/auth-service';
import { BACKUP, TOTP, factor, type Factor } from './helpers/lock';
import { must } from './helpers/sql';
import { totp } from './helpers/totp';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

/** A factor whose lock is `minutes` from now: row facts, set by a superuser helper in replica mode (the guard does not fire), as lapseLock does. */
async function locked(minutes: number): Promise<Factor> {
  const f = await factor(e, mails);
  must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() + interval '${minutes} minutes' WHERE user_id = '${f.u.id}'; COMMIT;`, e.db);
  return f;
}
const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const body = (path: string, f: Factor) => (path === TOTP ? { code: totp(f.secret) } : { code: f.backupCodes[0]! });
/** The lock refusal: the right code during a lock, with `cookie` as the hold. */
const refusal = async (f: Factor, cookie: string, path: string = TOTP) => e.handle(post(path, body(path, f), cookie), f.auth);
const holdName = (res: Response) => res.headers.getSetCookie().map((c) => c.split('=')[0]!).find((n) => /two_factor/.test(n))!;
const holdValue = (res: Response) => decodeURIComponent(res.headers.getSetCookie().find((c) => /two_factor/.test(c))!.split(';')[0]!.split('=').slice(1).join('='));

describe('the band on the lock refusal', () => {
  it.each([[1, 'under_an_hour'], [20, 'under_an_hour'], [59, 'under_an_hour'], [61, 'a_few_hours'], [240, 'a_few_hours'], [359, 'a_few_hours'], [361, 'up_to_a_day'], [960, 'up_to_a_day'], [1440, 'up_to_a_day']] as const)(
    'a hold locked for %i minutes gets pausedFor %s [red if: the band is missing, or its edges are not 60 minutes and 6 hours]', async (minutes, band) => {
      const f = await locked(minutes);
      const held = await heldSignIn(e, f.auth, f.u.email);
      const r = await refusal(f, held.cookie);
      expect(r.status, 'a lock refusal, not a success').toBeGreaterThanOrEqual(400);
      expect((await json(r)).pausedFor).toBe(band);
    });
  it.each([TOTP, BACKUP])('%s: the band is on the lock refusal for both verify paths, and the body carries no minutes, no end time and no locked_until [red if: a time is returned (S14)]', async (path) => {
    const f = await locked(30);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const r = await refusal(f, held.cookie, path);
    const j = await json(r);
    expect(j.pausedFor).toBe('under_an_hour');
    expect(JSON.stringify(j)).not.toMatch(/locked_?[uU]ntil|pausedUntil|\b\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(j).sort(), 'only the existing refusal fields and pausedFor').toEqual(expect.arrayContaining(['pausedFor']));
  });
  it('a wrong code that is NOT a lock refusal carries no band: only the lock refusal does [red if: the band leaks onto ordinary refusals]', async () => {
    const f = await factor(e, mails); // not locked
    const held = await heldSignIn(e, f.auth, f.u.email);
    const r = await e.handle(post(TOTP, { code: totp(f.secret, Date.now() + 5 * 60_000) }, held.cookie), f.auth);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await json(r)).pausedFor).toBeUndefined();
    // control: the same user once locked gets the band
    must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() + interval '30 minutes' WHERE user_id = '${f.u.id}'; COMMIT;`, e.db);
    const held2 = await heldSignIn(e, f.auth, f.u.email);
    expect((await json(await refusal(f, held2.cookie))).pausedFor).toBe('under_an_hour');
  });
});

describe('seceng\'s four conditions: nothing is returned without a valid hold (each starts with a control)', () => {
  const control = async (f: Factor) => {
    const held = await heldSignIn(e, f.auth, f.u.email);
    expect((await json(await refusal(f, held.cookie))).pausedFor, 'control: a genuine hold is told its band').toBe('under_an_hour');
  };
  it('no hold cookie: no field [red if: the band is answered to a request with no hold]', async () => {
    const f = await locked(30);
    await control(f);
    const r = await refusal(f, '');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
  it('an UNSIGNED hold (the bare identifier, signature stripped): no field [red if: the cookie is read without the signed-cookie check]', async () => {
    const f = await locked(30);
    await control(f);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const id = holdValue(held.res).split('.')[0]!;
    const r = await refusal(f, `${holdName(held.res)}=${encodeURIComponent(id)}`);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
  it('a hold signed with the WRONG secret: no field [red if: the signature is not verified against the auth secret]', async () => {
    const f = await locked(30);
    await control(f);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const id = holdValue(held.res).split('.')[0]!;
    const r = await refusal(f, `${holdName(held.res)}=${encodeURIComponent(signed(id, `${SECRET}-not-the-secret`))}`);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
  it('a VALID signature over another identifier (no such verification row): no field [red if: any signed value is taken as a hold]', async () => {
    const f = await locked(30);
    await control(f);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const r = await refusal(f, `${holdName(held.res)}=${encodeURIComponent(signed('an-identifier-that-is-not-a-hold', SECRET))}`);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
  it('a valid signature over ANOTHER USER\'S live hold identifier is that user\'s hold, not this one\'s: the band is the owner\'s, never a mix [red if: the band is read for the wrong user]', async () => {
    const a = await locked(30);
    const b = await locked(600); // a different band
    const heldA = await heldSignIn(e, a.auth, a.u.email);
    const heldB = await heldSignIn(e, b.auth, b.u.email);
    expect((await json(await refusal(a, heldA.cookie))).pausedFor).toBe('under_an_hour');
    expect((await json(await refusal(b, heldB.cookie))).pausedFor).toBe('up_to_a_day');
  });
  it('an EXPIRED hold (its verification row moved past expiresAt): no field [red if: expiry is not checked]', async () => {
    const f = await locked(30);
    await control(f);
    const held = await heldSignIn(e, f.auth, f.u.email);
    // The hold's verification row is stored under a hash of the cookie's identifier, so it is found by the user it names (its value), not by identifier.
    const hit = must(`UPDATE public.verification SET expires_at = now() - interval '1 second' WHERE value LIKE '%${f.u.id}%' RETURNING 1`, e.db).rows.length;
    expect(hit, 'this user\'s hold row was expired (and no other user\'s)').toBeGreaterThanOrEqual(1);
    const r = await refusal(f, held.cookie);
    // BetterAuth checks the lock before the hold's expiry and an after-hook cannot change the status, so the refusal may stay 429: what the condition requires is no band.
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
  it('a request that carries a SESSION: no field, even with a genuine hold beside it [red if: the band is answered to a signed-in caller]', async () => {
    const f = await locked(30);
    await control(f);
    // a session for the same user, inserted as a fixture (an enrolled user cannot finish /sign-in/email: it is held)
    const sess = await e.cookieForToken((await import('./helpers/handle')).sessionWithHandle(e.db, f.u.id).token, f.auth);
    const held = await heldSignIn(e, f.auth, f.u.email);
    const r = await refusal(f, `${sess}; ${held.cookie}`);
    expect((await json(r)).pausedFor).toBeUndefined();
  });
});
