// POLY-152 R9, seceng F1 / §6.1: the session-creating paths commit in one transaction (withSignInTx), and a refused second-step code
// commits only what it may. Red today: withSignInTx does not exist, so a late failure leaves the session row (no outer transaction).
import { createAuthMiddleware } from 'better-auth/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { capture, enrolTotp, hasSessionCookie, heldSignIn } from './helpers/auth-service';
import { softAuthenticator } from './helpers/webauthn';
import { totp } from './helpers/second-step';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

/** The ruling's forced failure: a final after-hook, last in plugins[], that throws once a session exists. */
const failing = () => ({ id: 'qa-fail-after-session', hooks: { after: [{ matcher: () => true, handler: createAuthMiddleware(async (ctx: any) => { if (ctx.context.newSession) throw new Error('qa: forced failure after the session INSERT'); }) }] } });
async function withFailingLast(): Promise<any> {
  const o: any = { ...e.optionsOf('real-domain'), rateLimit: { enabled: false } };
  o.plugins = [...o.plugins, failing()];
  return e.A.createAuth(o);
}
const sessions = (uid: string) => e.count(`SELECT 1 FROM public.session WHERE user_id = '${uid}'`);

describe('F1 a failure after the session INSERT leaves no session row and sets no cookie, on each path', () => {
  it('/sign-in/email [red if: the session commits before the later failure]', async () => {
    const auth = await withFailingLast();
    const u = e.seedUser();
    const r = await e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(hasSessionCookie(r)).toBe(false);
    expect(sessions(u.id)).toBe(0);
  });
  it('/magic-link/verify [red if: same]', async () => {
    const u = e.seedUser();
    const sent: { token: string }[] = [];
    const a2 = await (async () => { const o: any = e.optionsOf('real-domain', { sendMagicLink: async (m: any) => { sent.push(m); } }); o.rateLimit = { enabled: false }; o.plugins = [...o.plugins, failing()]; return e.A.createAuth(o); })();
    await e.handle(post('/sign-in/magic-link', { email: u.email }), a2);
    const r = await e.handle(get(`/magic-link/verify?token=${sent[0]!.token}&callbackURL=/`), a2);
    expect(hasSessionCookie(r)).toBe(false);
    expect(sessions(u.id)).toBe(0);
  });
  it('/callback/:id (Google) [red if: same]', async () => {
    const auth = await withFailingLast();
    const u = e.seedUser({ password: false });
    const r = await e.oauth(u.email, auth);
    expect(hasSessionCookie(r)).toBe(false);
    expect(sessions(u.id)).toBe(0);
  });
  it('/passkey/verify-authentication [red if: same; the counter update also rolls back]', async () => {
    const auth = await withFailingLast();
    const u = e.seedUser();
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${u.id}'`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'), auth);
    const opt: any = await g.clone().json();
    const r = await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g)), auth);
    expect(hasSessionCookie(r)).toBe(false);
    expect(sessions(u.id)).toBe(0);
    expect(must(`SELECT counter FROM public.passkey WHERE credential_id = '${k.credentialId}'`, e.db).rows[0]![0]).toBe('0');
  });
  it('/two-factor/verify-totp and /two-factor/verify-backup-code from a held sign-in: no session row, no cookie, and the backup code is not consumed [red if: same]', async () => {
    const good = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
    const u = e.seedUser();
    const { secret, backupCodes } = await enrolTotp(e, good, u, mails);
    const o: any = { ...e.optionsOf('real-domain', { sendSecondStepCode: async () => {} }), rateLimit: { enabled: false } };
    o.plugins = [...o.plugins, failing()];
    const bad = await e.A.createAuth(o);
    const before = must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0];
    const n0 = sessions(u.id);
    const h1 = await heldSignIn(e, bad, u.email);
    const t = await e.handle(post('/two-factor/verify-totp', { code: totp(secret, Date.now() + 30_000) }, h1.cookie), bad);
    expect(hasSessionCookie(t)).toBe(false);
    const h2 = await heldSignIn(e, bad, u.email);
    const b = await e.handle(post('/two-factor/verify-backup-code', { code: backupCodes[0] }, h2.cookie), bad);
    expect(hasSessionCookie(b)).toBe(false);
    expect(sessions(u.id)).toBe(n0);
    expect(must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0]).toBe(before);
  });
});

describe('§6.1 a refused second-step code commits its count, and only what it may', () => {
  let auth: any;
  let u: { id: string; email: string };
  let secret: string;
  let backupCodes: string[];
  const holdRow = () => must(`SELECT id, identifier, value, expires_at FROM public.verification ORDER BY identifier`, e.db).rows;
  const wrong = (s: string) => { const c = totp(s); return c === '000000' ? '000001' : '000000'; };
  async function setup() {
    auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
    u = e.seedUser();
    ({ secret, backupCodes } = await enrolTotp(e, auth, u, mails));
  }
  const paths: [string, (s: string) => unknown][] = [['/two-factor/verify-totp', (s) => ({ code: wrong(s) })], ['/two-factor/verify-backup-code', () => ({ code: 'wrong-code-000' })]];
  for (const [path, mk] of paths) {
    it(`${path}: the hold keeps its identifier and user, no other verification row is added, only expired rows or the hold are deleted, backup_codes untouched, and the count lands [red if: the refusal rolls back, re-points the hold, or leaves a stray row]`, async () => {
      await setup();
      const held = await heldSignIn(e, auth, u.email);
      const holdBefore = must(`SELECT id, identifier, value FROM public.verification WHERE value LIKE '%${u.id}%' OR identifier LIKE '%${u.id}%'`, e.db).rows;
      const all0 = holdRow();
      const verBefore = new Map(must(`SELECT identifier, value FROM public.verification WHERE expires_at > now()`, e.db).rows.map((r) => [r[0]!, r[1]!] as const));
      const bc0 = must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0];
      must(`INSERT INTO public.verification (identifier, value, expires_at) VALUES ('qa-expired', 'x', now() - interval '1 hour')`, e.db);
      const { result: r, sql } = await capture(() => e.handle(post(path, mk(secret), held.cookie), auth));
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      const verAfter = new Map(must(`SELECT identifier, value FROM public.verification WHERE expires_at > now()`, e.db).rows.map((r) => [r[0]!, r[1]!] as const));
      expect([...verAfter.keys()].filter((id) => !verBefore.has(id)), 'seceng §9: no verification row is added by a refusal').toEqual([]);
      for (const [id, v] of verBefore) if (/^\d+$/.test(v) && verAfter.has(id)) expect(Number(verAfter.get(id)), `seceng §9: the attempts counter ${id.slice(0, 6)} only goes up`).toBeGreaterThanOrEqual(Number(v));
      const holdAfter = must(`SELECT id, identifier, value FROM public.verification WHERE value LIKE '%${u.id}%' OR identifier LIKE '%${u.id}%'`, e.db).rows;
      expect(holdAfter.map((x) => [x[1], x[2]])).toEqual(holdBefore.map((x) => [x[1], x[2]])); // same identifier, same user
      const after = holdRow();
      expect(after.length).toBeLessThanOrEqual(all0.length); // no verification row added; the expired one is the only other deletion
      expect(after.some((x) => x[1] === 'qa-expired')).toBe(false);
      expect(must(`SELECT backup_codes FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0]).toBe(bc0);
      expect(Number(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0])).toBe(1);
      // the write set (statement log): verification and two_factor.failed_verification_count / locked_until only
      const writes = sql.filter((s) => /^\s*(insert|update|delete)\b/i.test(s));
      for (const w of writes) {
        if (/^\s*(insert into|delete from)\s+"?(public"?\."?)?"?verification/i.test(w)) continue;
        expect(w, 'a refusal writes only verification and the failure count').toMatch(/^\s*update\s+"?(public"?\."?)?"?two_factor"?\s+set\s+"?failed_verification_count"?|locked_until/i);
      }
      expect(writes.every((w) => !/\b(session|account|user|passkey)\b/i.test(w.replace(/"?user_id"?/gi, '')))).toBe(true);
    });
    it(`${path}: across held sign-ins (a hold allows 5 tries, measured), 9 refusals leave count 9 and no lock; the 10th locks for 900 s ± 60; an 11th try with the RIGHT code is refused and makes no session [red if: a refusal rolls its count back, the lock is not committed, or a pin bump shortens or removes it]`, async () => {
      await setup();
      // MEASURED against 1.7.18: each hold (the two_factor cookie's verification row) allows 5 wrong codes; the 6th is TOO_MANY_ATTEMPTS and the hold is
      // dead. So the 10 tries that lock the FACTOR need two holds, each opened by a fresh password sign-in. The count is the factor's, not the hold's.
      let held = await heldSignIn(e, auth, u.email);
      const sessionsBefore = sessions(u.id);
      const state = () => must(`SELECT failed_verification_count, locked_until IS NOT NULL FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]!;
      for (let i = 1; i <= 9; i++) {
        if (i > 1 && (i - 1) % 5 === 0) held = await heldSignIn(e, auth, u.email);
        const r = await e.handle(post(path, mk(secret), held.cookie), auth);
        if (process.env.QA_DEBUG) console.log('[try]', i, r.status, await r.clone().text());
        expect(r.status, `try ${i}`).toBeLessThan(500);
        expect(r.status, `try ${i}`).toBeGreaterThanOrEqual(400);
        expect(hasSessionCookie(r)).toBe(false);
      }
      expect(state(), 'after 9 refusals: the count survived each refusal and nothing is locked').toEqual(['9', 'f']);
      const tenth = await e.handle(post(path, mk(secret), held.cookie), auth);
      held = await heldSignIn(e, auth, u.email); // the hold the 11th try uses
      expect(hasSessionCookie(tenth)).toBe(false);
      expect(state()[1], 'the 10th refusal sets locked_until').toBe('t');
      const secs = Number(must(`SELECT extract(epoch FROM (locked_until - now())) FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0]);
      expect(Math.abs(secs - 900), `locked_until - now() = ${secs} s`).toBeLessThan(60); // seceng §8: the duration is pinned
      const right = path.endsWith('totp') ? { code: totp(secret) } : { code: backupCodes[0] };
      const eleventh = await e.handle(post(path, right, held.cookie), auth);
      expect(eleventh.status).toBeGreaterThanOrEqual(400);
      expect(hasSessionCookie(eleventh)).toBe(false);
      expect(sessions(u.id), 'the locked factor made no session').toBe(sessionsBefore);
      // MEASURED, not asserted (seceng §8): once the lock lapses, does the count reset, giving 10 fresh tries? Recorded in red-run.md.
      must(`UPDATE public.two_factor SET locked_until = now() - interval '1 second' WHERE user_id = '${u.id}'`, e.db);
      const countBefore = state()[0];
      const after = await e.handle(post(path, mk(secret), held.cookie), auth);
      const row = must(`SELECT failed_verification_count, locked_until FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]!;
      const line = `${path}: lapsed lock, then one wrong code -> status ${after.status}; failed_verification_count ${countBefore} -> ${row[0]}; locked_until ${row[1] === '' ? 'NULL' : 'set'}`;
      console.log(`[lock-expiry] ${line}`);
    });
  }
  it('a hold allows 5 wrong codes: the 6th answers TOO_MANY_ATTEMPTS without counting, and the hold is then dead (measured, 1.7.18; the factor count is separate) [red if: the per-hold cap is removed or counted twice]', async () => {
    await setup();
    const held = await heldSignIn(e, auth, u.email);
    for (let i = 1; i <= 5; i++) expect((await e.handle(post('/two-factor/verify-totp', { code: wrong(secret) }, held.cookie), auth)).status).toBe(401);
    const ver = () => new Map(must(`SELECT identifier, value FROM public.verification WHERE expires_at > now()`, e.db).rows.map((r) => [r[0]!, r[1]!] as const));
    const before6 = ver();
    const { result: sixth, sql: sixthSql } = await capture(() => e.handle(post('/two-factor/verify-totp', { code: wrong(secret) }, held.cookie), auth));
    // seceng §9 / architect 322c6174: the dead hold's 400 writes inside the allowed set (verification, failure count, lock) and COMMITS
    const writes6 = sixthSql.filter((q) => /^\s*(insert|update|delete)\b/i.test(q));
    expect(writes6.length, 'the 6th answer deletes the dead hold').toBeGreaterThan(0);
    for (const w of writes6) expect(w, 'the 6th answer writes only verification (or the failure count / lock)').toMatch(/^\s*(insert into|delete from|update)\s+"?(public"?\.")?(verification|two_factor)"?/i);
    expect(writes6.every((w) => !/\b(session|account|passkey)\b/i.test(w)), writes6.join('\n')).toBe(true);
    const gone = [...before6].filter(([id]) => !ver().has(id));
    expect(gone.length, 'committed: the cookie row and the attempts counter are both gone').toBe(2);
    expect(gone.some(([, v]) => v.includes(u.id)) && gone.some(([, v]) => v === '5'), JSON.stringify(gone)).toBe(true);
    expect([...ver().keys()].filter((id) => !before6.has(id)), 'nothing was added').toEqual([]);
    expect(sixth.status).toBe(400);
    expect(await sixth.clone().text()).toMatch(/TOO_MANY_ATTEMPTS/);
    const seventh = await e.handle(post('/two-factor/verify-totp', { code: totp(secret) }, held.cookie), auth);
    expect(seventh.status).toBe(401); // the dead hold refuses even the right code
    expect(hasSessionCookie(seventh)).toBe(false);
    expect(Number(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0])).toBe(5);
  });
  it('a 5xx on the second-step path rolls the whole request back, count included [red if: the commit rule commits a 5xx]', async () => {
    await setup();
    const o: any = { ...e.optionsOf('real-domain', { sendSecondStepCode: async () => {} }), rateLimit: { enabled: false } };
    const boom = { id: 'qa-5xx', hooks: { before: [{ matcher: (c: any) => /verify-totp/.test(c.path ?? ''), handler: createAuthMiddleware(async () => { throw new Error('qa 5xx'); }) }] } };
    o.plugins = [...o.plugins, boom];
    const b = await e.A.createAuth(o);
    const held = await heldSignIn(e, b, u.email);
    const r = await e.handle(post('/two-factor/verify-totp', { code: wrong(secret) }, held.cookie), b);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(Number(must(`SELECT failed_verification_count FROM public.two_factor WHERE user_id = '${u.id}'`, e.db).rows[0]![0])).toBe(0);
  });
  it('a held sign-in creates and deletes its session inside the one transaction: the statement log shows one BEGIN and no committed session row [red if: the hold commits then deletes]', async () => {
    await setup();
    const { result, sql } = await capture(() => e.handle(post('/sign-in/email', { email: u.email, password: PW }), auth));
    expect(hasSessionCookie(result)).toBe(false);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(1); // only the enrolment session
    expect(sql.filter((s) => /^\s*commit\b/i.test(s)).length).toBeLessThanOrEqual(1);
  });
});

// seceng (risk figure scales with it): the TOTP acceptance window, measured against @better-auth/utils 0.5.1 (otp.mjs: window 1) and pinned.
// The clock is controlled, not slept: only Date is faked, set to the middle of a 30 s step, so the server's step is known.
describe('the TOTP acceptance window is one step either side', () => {
  const STEP = 30_000;
  const T = (Math.floor(Date.UTC(2026, 10, 17, 12, 0, 0) / STEP) * STEP) + 15_000;
  it('accepted: the current step and the steps at t-30 s and t+30 s; refused: t-60 s, t+60 s and t±90 s [red if: a pin bump widens (or narrows) the window]', async () => {
    const auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
    const u = e.seedUser();
    const { secret } = await enrolTotp(e, auth, u, mails);
    const verdicts: Record<string, number> = {};
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T);
      for (const offset of [-90, -60, -30, 0, 30, 60, 90]) {
        vi.setSystemTime(T);
        const held = await heldSignIn(e, auth, u.email);
        const code = totp(secret, T + offset * 1000);
        const r = await e.handle(post('/two-factor/verify-totp', { code }, held.cookie), auth);
        verdicts[`${offset >= 0 ? '+' : ''}${offset}s`] = r.status;
        const accepted = Math.abs(offset) <= 30;
        // a code equal to the current one can coincide with a neighbour's by chance (1 in 10^6); the offsets are fixed, so the run is deterministic
        expect(hasSessionCookie(r), `offset ${offset}s -> ${r.status}`).toBe(accepted);
      }
    } finally { vi.useRealTimers(); }
    console.log(`[totp-window] ${JSON.stringify(verdicts)}`); // recorded in red-run.md; a test never writes into temp/ (it does not exist in CI)
  });
});
