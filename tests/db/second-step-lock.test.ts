// POLY-149c, ruling R2 (growing second-step lock) and seceng's T-L1..T-L4. The lock runs 15, 30, 60, 120, 240, 480, 960 minutes, then 1440 for
// every later one; only a correct code resets it; the database (not the service) refuses a right code, a shortening write or a delete during a
// lock. Red today (BetterAuth's default: 900 s every time, no streak table, no guard). Titles end [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { cloneMigrated, dbEnv } from './helpers/api';
import { hasSessionCookie, heldSignIn, enrolTotp } from './helpers/auth-service';
import { PW } from './helpers/auth';
import { BACKUP, GROWTH, PATHS, TOTP, captureStatements, factor, isLocked, lapseLock, lockMinutes, lockOnce, rightCode, sessionsOf, streakOf, recordCount, wrongCodes, type Path } from './helpers/lock';
import { codeOf, fails, fixture, msgOf, refusedUnchanged, totp, type Q } from './helpers/second-step';
import { softAuthenticator } from './helpers/webauthn';
import { url } from './helpers/pg';
import { pgmod } from './helpers/second-step';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));
const near = (got: number, want: number) => expect(Math.abs(got - want), `lock length ${got} min, want ${want} ±1`).toBeLessThanOrEqual(1);

describe('L1 consecutive locks double: 15, 30, 60, 120, 240, 480, 960, then 1440 for every later one', () => {
  for (const path of PATHS) {
    it(`${path}: nine locks, each reached by 10 counted wrong codes across holds, last length ${GROWTH.at(-1)} ±1 [red if: BetterAuth's 900 s write is not replaced by the guard, or the cap is wrong]`, async () => {
      const f = await factor(e, mails);
      const streaks: (number | null)[] = [];
      for (let k = 0; k < GROWTH.length; k++) {
        near(await lockOnce(e, f, path), GROWTH[k]!);
        streaks.push((() => { try { return streakOf(e.db, f.u.id); } catch { return null; } })()); // a missing table reads as null; the lengths above fail first
        // L4: while the lock is in force the right code is refused and creates no session, at every length
        const n0 = sessionsOf(e.db, f.u.id);
        const r = await rightCode(e, f, path);
        expect(r.status, `lock ${k + 1}: the right code`).toBeGreaterThanOrEqual(400);
        expect(hasSessionCookie(r)).toBe(false);
        expect(sessionsOf(e.db, f.u.id) - n0, 'the refusal created no completed session').toBeLessThanOrEqual(1); // the hold's own temporary session only
        expect(isLocked(e.db, f.u.id)).toBe(true);
        lapseLock(e.db, f.u.id);
      }
      expect(streaks, 'the streak counts the locks').toEqual(GROWTH.map((_, k) => k + 1));
    }, 600_000);
  }
});

describe('L2 only a correct code resets the doubling', () => {
  for (const path of PATHS) {
    it(`${path}: two locks, a lapse, then a correct code: the streak is 0 and the next lock is 15 minutes [red if: the reset is missing or the doubling survives a correct code]`, async () => {
      const f = await factor(e, mails);
      near(await lockOnce(e, f, path), 15); lapseLock(e.db, f.u.id);
      near(await lockOnce(e, f, path), 30); lapseLock(e.db, f.u.id);
      expect(streakOf(e.db, f.u.id)).toBe(2);
      const ok = await rightCode(e, f, path);
      expect(ok.status).toBe(200);
      expect(hasSessionCookie(ok)).toBe(true);
      expect(streakOf(e.db, f.u.id) ?? 0, 'a correct code resets').toBe(0);
      near(await lockOnce(e, f, path), 15);
    }, 300_000);
  }
  it('a lapse, a held email sign-in and a passkey sign-in each leave the doubling where it was [red if: any of them resets the streak]', async () => {
    const f = await factor(e, mails);
    near(await lockOnce(e, f, TOTP), 15);
    lapseLock(e.db, f.u.id);
    expect(streakOf(e.db, f.u.id), 'a lapse alone').toBe(1);
    await heldSignIn(e, f.auth, f.u.email); // a new (held) session by email
    expect(streakOf(e.db, f.u.id), 'a new session by email').toBe(1);
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${f.u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'), f.auth);
    const opt: any = await g.clone().json();
    const pk = await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g)), f.auth);
    expect(pk.status).toBe(200);
    expect(streakOf(e.db, f.u.id), 'a passkey sign-in').toBe(1);
    near(await lockOnce(e, f, TOTP), 30); // the doubling continued
  }, 300_000);
  it('a magic-link sign-in and a password change leave the doubling where it was [red if: either resets the streak]', async () => {
    const f = await factor(e, mails);
    near(await lockOnce(e, f, TOTP), 15);
    lapseLock(e.db, f.u.id);
    const sent: { token: string }[] = [];
    const a2 = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendMagicLink: async (m: any) => { sent.push(m); } }), rateLimit: { enabled: false } });
    await e.handle(post('/sign-in/magic-link', { email: f.u.email }), a2);
    await e.handle(get(`/magic-link/verify?token=${sent[0]!.token}&callbackURL=/`), a2);
    expect(streakOf(e.db, f.u.id), 'a magic-link sign-in').toBe(1);
    const before = must(`SELECT password FROM public.account WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0];
    must(`UPDATE public.account SET password = 'changed-${Date.now()}' WHERE user_id = '${f.u.id}' AND provider_id = 'credential'`, e.db); // a password reset is a row write on account, not on two_factor
    expect(must(`SELECT password FROM public.account WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0]).not.toBe(before);
    expect(streakOf(e.db, f.u.id), 'a password write').toBe(1);
  }, 300_000);
});

describe('L3 the streak lives in the database, so a restart of auth leaves it unchanged', () => {
  it('a fresh createAuth and fresh pools between two locks: the next lock is the doubled one [red if: the count lives in the process]', async () => {
    const f = await factor(e, mails);
    near(await lockOnce(e, f, TOTP), 15);
    lapseLock(e.db, f.u.id);
    await e.dbm.close(); await e.dba.close();
    e.dbm.configure({ app: dbEnv('poly_app', e.db), auth: dbEnv('poly_auth', e.db), worker: dbEnv('poly_worker', e.db), operator: dbEnv('poly_operator', e.db) });
    const auth2 = await e.mk();
    const f2 = { ...f, auth: auth2 };
    near(await lockOnce(e, f2, TOTP), 30);
  }, 300_000);
  it('BetterAuth\'s own 900 s write loses to the guard: the 2nd lock is 30 minutes, not 15 [red if: the guard does not overwrite locked_until]', async () => {
    const f = await factor(e, mails);
    await lockOnce(e, f, BACKUP); lapseLock(e.db, f.u.id);
    const second = await lockOnce(e, f, BACKUP);
    expect(second).toBeGreaterThan(29);
  }, 300_000);
});

describe('T-L1 the database refuses the right code during a lock even when the service\'s own check is skipped', () => {
  for (const path of PATHS) {
    it(`${path}: Date faked past locked_until so BetterAuth's check passes: the lazy clear or success write is refused, no session, no 'session' record row [red if: the guard is absent or lets a clear through]`, async () => {
      const f = await factor(e, mails);
      await lockOnce(e, f, path);
      const sessions0 = sessionsOf(e.db, f.u.id);
      const rec0 = recordCount(e.db, f.u.id, 'session');
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 20 * 60_000 });
      try {
        const held = await heldSignIn(e, f.auth, f.u.email); // the hold is created under the faked clock
        const rec1 = recordCount(e.db, f.u.id, 'session'); // the hold's own temporary session is a 'session' row
        const sessions1 = sessionsOf(e.db, f.u.id);
        const r = await e.handle(post(path, path === TOTP ? { code: totp(f.secret) } : { code: f.next() }, held.cookie), f.auth);
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(hasSessionCookie(r)).toBe(false);
        expect(sessionsOf(e.db, f.u.id), 'no completed session').toBeLessThanOrEqual(sessions1);
        expect(recordCount(e.db, f.u.id, 'session'), 'no session record row was added by the refused code').toBe(rec1);
        expect(isLocked(e.db, f.u.id), 'the lock is still in force').toBe(true);
        void sessions0; void rec0;
      } finally { vi.useRealTimers(); }
    }, 300_000);
  }
});

describe('T-L2 a race at the 10th code leaves one lock, one lock record and the doubled length', () => {
  it('two wrong codes at once at count 9 (second lock): one second_step_lock row for the 2nd lock, 30 minutes [red if: the guard counts two locks or leaves 15]', async () => {
    const f = await factor(e, mails);
    await lockOnce(e, f, TOTP); lapseLock(e.db, f.u.id);
    await wrongCodes(e, f, TOTP, 9);
    expect(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0]).toBe('9');
    const [h1, h2] = [await heldSignIn(e, f.auth, f.u.email), await heldSignIn(e, f.auth, f.u.email)];
    const rs = await Promise.all([h1, h2].map((h) => e.handle(post(TOTP, { code: totp(f.secret) === '000000' ? '000001' : '000000' }, h.cookie), f.auth)));
    for (const r of rs) expect(hasSessionCookie(r)).toBe(false);
    near(lockMinutes(e.db, f.u.id), 30);
    expect(streakOf(e.db, f.u.id), 'one new lock, not two').toBe(2);
    expect(recordCount(e.db, f.u.id, 'second_step_lock'), 'one lock record per lock').toBe(2);
  }, 300_000);
});

describe('L5 poly_auth cannot shorten, clear, lower or delete a lock (own database, own fixture)', () => {
  let db: string; let fx: ReturnType<typeof fixture>; let u: { id: string }; let sid: string; let rowId: string;
  const snap = () => must(`SELECT id, failed_verification_count, locked_until, verified, secret, backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows;
  beforeAll(async () => {
    db = cloneMigrated(); fx = fixture(db, 1492);
    u = await fx.user({ enrolled: true });
    must(`UPDATE public.two_factor SET failed_verification_count = 10, locked_until = now() + interval '15 minutes' WHERE user_id = '${u.id}'`, db);
    rowId = must(`SELECT id FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]!;
    sid = fx.session(u.id);
  });
  const attempts: [string, string, unknown[]][] = [
    ['SET locked_until = NULL', `UPDATE public.two_factor SET locked_until = NULL WHERE user_id = $1`, []],
    ['SET locked_until = now()', `UPDATE public.two_factor SET locked_until = now() WHERE user_id = $1`, []],
    ['SET locked_until one minute out (replace)', `UPDATE public.two_factor SET locked_until = now() + interval '1 minute' WHERE user_id = $1`, []],
    ['the lazy-clear statement (count 0, NULL, locked_until <= a far-future $2)', `UPDATE public.two_factor SET failed_verification_count = 0, locked_until = NULL WHERE user_id = $1 AND locked_until <= now() + interval '1 year'`, []],
    ['the success-reset statement', `UPDATE public.two_factor SET failed_verification_count = 0, locked_until = NULL WHERE user_id = $1`, []],
    ['DELETE FROM two_factor', `DELETE FROM public.two_factor WHERE user_id = $1`, []],
  ];
  for (const [label, sql] of attempts.map((a) => [a[0], a[1]] as const)) {
    it(`${label}: refused 42501 and the row (and the streak) is read back unchanged [red if: the guard or the delete guard is missing]`, async () => {
      const streak0 = streakOf(db, u.id);
      const x = await fx.marked('poly_auth', u.id, sid, (q) => refusedUnchanged(snap, () => q(sql, [u.id])));
      expect(codeOf(x), msgOf(x)).toBe('42501');
      expect(streakOf(db, u.id)).toBe(streak0);
    });
  }
  it('T-L3: setting failed_verification_count = 0 and leaving locked_until alone is no reset: streak and lock unchanged (the ruling refuses it outright, step 1) [red if: the count can be lowered during a lock, or it counts as a reset]', async () => {
    const streak0 = streakOf(db, u.id);
    const before = snap();
    await fx.marked('poly_auth', u.id, sid, async (q) => { await fails(q(`UPDATE public.two_factor SET failed_verification_count = 0 WHERE user_id = $1`, [u.id])); });
    expect(snap()).toEqual(before);
    expect(streakOf(db, u.id)).toBe(streak0);
    expect(streak0, 'the setup lock is the first lock').toBe(1);
  });
  it('the streak table: no statement as any login role (permission denied) [red if: a login role holds a privilege on it]', async () => {
    for (const role of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator']) {
      for (const sql of ['SELECT * FROM app.second_step_streak', `INSERT INTO app.second_step_streak (user_id, locks) VALUES ('${u.id}', 0)`, 'UPDATE app.second_step_streak SET locks = 0', 'DELETE FROM app.second_step_streak']) {
        const c = new pgmod.Client({ connectionString: url(role, db) }); await c.connect();
        try {
          const x = await fails(c.query({ text: sql, queryMode: 'extended' }));
          expect(x, `${role}: ${sql}`).not.toBeNull();
          expect(codeOf(x), `${role}: ${sql}: ${msgOf(x)}`).toMatch(/42501|42P01/); // 42P01 only on the red tree (no table); 42501 is the pin
          expect(msgOf(x)).not.toMatch(/does not exist/); // the red run reports the missing table here
        } finally { await c.end(); }
      }
    }
  });
});

describe('T-L4 a factor DELETE during a lock is refused; after a lapse delete and re-enrol keeps the streak', () => {
  it('delete during a lock: refused, row there; lapse; delete + re-insert as poly_auth; the streak survives and the next lock doubles [red if: the delete guard is missing or the streak is keyed by the factor row]', async () => {
    const db = cloneMigrated(); const fx = fixture(db, 1493);
    const u = await fx.user({ enrolled: true });
    const sid = fx.session(u.id);
    must(`UPDATE public.two_factor SET failed_verification_count = 10, locked_until = now() + interval '15 minutes' WHERE user_id = '${u.id}'`, db);
    const snap = () => must(`SELECT id, locked_until FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows;
    const x = await fx.marked('poly_auth', u.id, sid, (q) => refusedUnchanged(snap, () => q('DELETE FROM public.two_factor WHERE user_id = $1', [u.id])));
    expect(codeOf(x)).toBe('42501');
    expect(streakOf(db, u.id)).toBe(1);
    lapseLock(db, u.id);
    await fx.committed('poly_auth', u.id, sid, async (q) => {
      await q('DELETE FROM public.two_factor WHERE user_id = $1', [u.id]);
      await q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s2', 'b2', $1, true)`, [u.id]);
    });
    expect(streakOf(db, u.id), 'the streak survives re-enrolment').toBe(1);
    must(`UPDATE public.two_factor SET failed_verification_count = 10, locked_until = now() + interval '15 minutes' WHERE user_id = '${u.id}'`, db);
    near(lockMinutes(db, u.id), 30);
  });
});

describe('a passkey sign-in passes during a lock; reset-mfa works on a locked user and clears the streak', () => {
  it('passkey during a lock: 200 and a session [red if: the lock reaches the passkey path]', async () => {
    const f = await factor(e, mails);
    await lockOnce(e, f, TOTP);
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${f.u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'), f.auth);
    const opt: any = await g.clone().json();
    const r = await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g)), f.auth);
    expect(r.status).toBe(200);
    expect(hasSessionCookie(r)).toBe(true);
    expect(isLocked(e.db, f.u.id)).toBe(true);
  }, 300_000);
  it('app.reset_second_step as poly_operator on a locked user: true, the factor row and the streak row are gone [red if: reset_second_step leaves the streak]', async () => {
    const f = await factor(e, mails);
    await lockOnce(e, f, TOTP);
    expect(streakOf(e.db, f.u.id)).toBe(1);
    const c = new pgmod.Client({ connectionString: url('poly_operator', e.db) }); await c.connect();
    try { await c.query('BEGIN'); const r = await c.query({ text: 'SELECT app.reset_second_step($1)', values: [f.u.email], queryMode: 'extended' }); await c.query('COMMIT'); expect(r.rows[0].reset_second_step).toBe(true); } finally { await c.end(); }
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${f.u.id}'`, e.db).rows[0]![0]).toBe('0');
    expect(streakOf(e.db, f.u.id), 'reset-mfa is the only path that clears the doubling').toBeNull();
  }, 300_000);
});

describe('unmeasured (R2): no other BetterAuth write sends the reset shape (count 0 AND locked_until NULL on an unlocked row), outside a correct code', () => {
  const touches = (s: { text: string }) => /^\s*update\s+"?(public"?\.")?two_factor"?\s+set/i.test(s.text) && /failed_verification_count|locked_until/i.test(s.text);
  it('a held sign-in sends no statement listing either column; a correct TOTP and a correct backup code each send exactly one; enrolment, regenerate and disable are measured and printed for red-run.md [red if: a held sign-in resets, or a correct code sends no reset or two]', async () => {
    const f = await factor(e, mails);
    const lines: string[] = [];
    const run = async (label: string, fn: () => Promise<unknown>, wantResets: number) => {
      const { stmts } = await captureStatements(fn);
      const hits = stmts.filter(touches);
      lines.push(`${label}: ${hits.map((h) => `${h.text.replace(/\s+/g, ' ').slice(0, 120)} <- ${JSON.stringify(h.values)}`).join(' | ') || 'none'}`);
      if (wantResets >= 0) expect(hits.length, `${label}: ${lines.at(-1)}`).toBe(wantResets);
    };
    await run('held sign-in', () => heldSignIn(e, f.auth, f.u.email), 0);
    await run('correct TOTP', () => rightCode(e, f, TOTP), 1);
    await run('correct backup code', () => rightCode(e, f, BACKUP), 1);
    const g = await factor(e, mails); // enrolment is part of factor(); measure a second one in the log
    await run('enrolment of a second user', async () => { const u2 = e.seedUser(); await enrolTotp(e, g.auth, u2, mails); }, -1); // enrolment's first verify is MEASURED and printed (red-run.md), not asserted
    const ok = await rightCode(e, f, TOTP);
    const cookie = jar('', ok);
    await run('regenerate backup codes', () => e.handle(post('/two-factor/generate-backup-codes', { password: PW }, cookie), f.auth), -1);
    await run('disable', () => e.handle(post('/two-factor/disable', { password: PW }, cookie), f.auth), -1);
    console.log(`[reset-shape] ${lines.join('\n')}`);
  }, 300_000);
});

export type { Path, Q };
