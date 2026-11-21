// POLY-137 R1.8, R1.9, R2, R4.1, R7, R8 (ruling @ a5e9ce4f; seceng ruling-review §5): the three token mails through the real handler with a
// recording mailer: magic link (members only), password reset (fragment link, 900 s, every session revoked), the second-step code; the
// per-recipient cap (10 per rolling 60 minutes, one counter, answers that never change); the 302 for a held magic-link sign-in;
// /change-password forcing revokeOtherSessions; and the limiter on the four new routes. Time moves with a fake Date only; no test sleeps
// longer than the 3 s a not-awaited sender is given. Real Postgres. Titles end [red if: ...].
// ASSUMED (the ruling names the event, not the sink): `mail.failed` and `mail.capped` reach console.* or process.stdout/stderr as text.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASE, PW, boot, get, jar, post, teardown, url, type Env } from './helpers/auth';
import { hasSessionCookie } from './helpers/auth-service';
import { sessionWithHandle } from './helpers/handle';
import { enrol, fragmentTokenIn, lastTo, magicUrlIn, mailAuth, memMailer, sentCount, settle, type Mem } from './helpers/mail';
import { totp } from './helpers/second-step';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let mm: Mem;
let auth: any;
beforeAll(async () => { e = await boot(); mm = memMailer(); auth = await mailAuth(e, mm); });
afterAll(() => teardown(e));
afterEach(() => { vi.useRealTimers(); mm.fail = false; });

const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const body = async (r: Response) => `${r.status} ${await r.clone().text()}`;
const magic = (email: string, a = auth) => e.handle(post('/sign-in/magic-link', { email }), a);
const reset = (email: string, o: Record<string, unknown> = {}, a = auth) => e.handle(post('/request-password-reset', { email, ...o }), a);
const advance = (ms: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + ms); };
const unknown = () => `nobody-${Math.random().toString(36).slice(2, 8)}@qa.test`;
const MAGIC_TEXT = (u: string) => `Use this link to sign in to polycarpic. It works once, for 5 minutes:\n\n${u}\n\nIf you did not ask for it, ignore this email. Nobody can sign in without the link.`;
const RESET_TEXT = (t: string) => `Use this link to choose a new password. It works once, for 15 minutes:\n\n${BASE}/sign-in/reset#${t}\n\nChoosing a new password signs your account out on every device. If you did not ask for this, ignore this email: your password has not changed.`;

const ageChallenges = (uid: string) => must(`UPDATE app.email_challenge SET created_at = created_at - interval '16 minutes' WHERE user_id = '${uid}'`, e.db);

function captureLogs() {
  const lines: string[] = [];
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')].map((s) => s.mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { lines.push(String(c)); return true; }) as never);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { lines.push(String(c)); return true; }) as never);
  return { lines, stop: () => [...spies, out, err].forEach((s) => s.mockRestore()) };
}

describe('R1.9 the magic link goes only to an address with an account', () => {
  it('a member: 200 {status:true}, one mail with the fixed subject and text, whose link verifies and signs in [red if: no mailer is wired, or the text drifts]', async () => {
    const u = e.seedUser();
    const n = mm.sent.length;
    const r = await magic(u.email);
    expect([r.status, await json(r)]).toEqual([200, { status: true }]);
    expect(await sentCount(mm, n + 1)).toBe(true);
    const m = lastTo(mm, u.email)!;
    expect(m, 'a mail to the member').toBeDefined();
    expect(m.subject).toBe('Your polycarpic sign-in link');
    expect(m.text).toBe(MAGIC_TEXT(magicUrlIn(m)));
    expect(magicUrlIn(m)).toMatch(/^https:\/\/app\.qa\.test\/api\/auth\/magic-link\/verify\?token=/);
    const v = await e.handle(new Request(magicUrlIn(m), { headers: { origin: BASE } }), auth);
    expect(hasSessionCookie(v), `verify: ${v.status}`).toBe(true);
  });
  it('an address with no account: the same status and body as a member, and NO mail, ever [red if: the route is an open relay to strangers, or tells members from strangers]', async () => {
    const member = e.seedUser();
    const n = mm.sent.length;
    const a = await magic(member.email);
    const stranger = unknown();
    const b = await magic(stranger);
    expect(await body(b)).toBe(await body(a));
    await settle();
    expect(mm.sent.slice(n).map((s) => s.to), 'only the member was mailed').toEqual([member.email]);
    expect(e.count(`SELECT 1 FROM public."user" WHERE email = '${stranger}'`), 'no account is made by asking').toBe(0);
  });
  it('a failing mailer never changes the answer: a member and a stranger get the same 200 and body [red if: a provider failure reveals which addresses have accounts]', async () => {
    const bad = memMailer({ fail: true });
    const a2 = await mailAuth(e, bad);
    const u = e.seedUser();
    const x = await magic(u.email, a2);
    const y = await magic(unknown(), a2);
    expect(x.status).toBe(200);
    expect(await body(x)).toBe(await body(y));
  });
  it('with no mailer configured (development only) the route answers as today: an error for a member, and the same for a stranger [red if: the unconfigured answer depends on the address]', async () => {
    const none = await mailAuth(e, undefined);
    const u = e.seedUser();
    const x = await magic(u.email, none);
    const y = await magic(unknown(), none);
    expect(x.status).toBeGreaterThanOrEqual(400);
    expect(await body(y)).toBe(await body(x));
  });
});

describe('R1.8 the per-recipient cap: 10 token mails per address per rolling 60 minutes, one counter, answers that never change', () => {
  it('the 11th magic link request for a member is byte-identical to the 10th and to a stranger\'s, and sends no mail; at 61 minutes it sends again [red if: the cap is absent, 11, or answers 429]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    let tenth = '';
    for (let i = 1; i <= 10; i++) { const r = await magic(u.email, a); if (i === 10) tenth = await body(r); expect(r.status).toBe(200); }
    expect(await sentCount(mx, 10)).toBe(true);
    const eleventh = await magic(u.email, a);
    expect(await body(eleventh)).toBe(tenth);
    expect(await body(await magic(unknown(), a))).toBe(tenth);
    await settle();
    expect(mx.sent, 'the 11th sent nothing').toHaveLength(10);
    advance(61 * 60_000);
    await magic(u.email, a);
    expect(await sentCount(mx, 11), 'at 61 minutes the address can be mailed again').toBe(true);
  });
  it('kinds share one counter: 6 magic links + 5 resets means the 11th mail is not sent, and its answer is the unknown-address answer [red if: each kind has its own counter]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    for (let i = 0; i < 6; i++) await magic(u.email, a);
    for (let i = 0; i < 5; i++) await reset(u.email, {}, a);
    expect(await sentCount(mx, 10)).toBe(true);
    const r = await reset(u.email, {}, a);
    const ref = await reset(unknown(), {}, a);
    expect(await body(r)).toBe(await body(ref));
    await settle();
    expect(mx.sent).toHaveLength(10);
  });
  it('the key is the stored address: case and padding of the request do not make a fresh counter [red if: A@QA.test and a@qa.test count separately]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser({ email: `case-${Math.random().toString(36).slice(2, 7)}@qa.test` });
    for (let i = 0; i < 10; i++) await magic(i % 2 ? u.email.toUpperCase() : u.email, a);
    expect(await sentCount(mx, 10)).toBe(true);
    await magic(u.email, a);
    await settle();
    expect(mx.sent).toHaveLength(10);
  });
  it('a failing mailer still counts: 10 failed sends, then a healthy provider still sends nothing [red if: a failing provider can be looped]', async () => {
    const healthy = memMailer();
    const h = await mailAuth(e, healthy);
    await magic(e.seedUser().email, h);
    expect(await sentCount(healthy, 1), 'precondition: a working mailer is wired and sends').toBe(true);
    const mx = memMailer({ fail: true });
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    for (let i = 0; i < 10; i++) await magic(u.email, a);
    await settle(400);
    mx.fail = false;
    await magic(u.email, a);
    await settle();
    expect(mx.sent, 'the count was taken before the failed sends').toHaveLength(0);
  });
  it('the second-step code shares the counter: the 11th send-code answers 429 mail_capped and writes no email_challenge row [red if: send-code is outside the cap, or the challenge is issued before the check]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, a);
    for (let i = 1; i <= 10; i++) {
      ageChallenges(u.id); // the database itself issues at most 3 codes per 15 minutes; the cap under test is the mailer's, so each earlier code is aged out
      const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), a);
      expect(r.status, `send ${i}: ${JSON.stringify(await json(r))}`).toBe(200);
    }
    ageChallenges(u.id);
    const snap = () => JSON.stringify(must(`SELECT id, created_at FROM app.email_challenge WHERE user_id = '${u.id}' ORDER BY id`, e.db).rows);
    const before = snap();
    const r = await e.handle(post('/second-step/send-code', { password: PW }, cookie), a);
    expect([r.status, (await json(r)).code]).toEqual([429, 'mail_capped']);
    expect(snap(), 'no challenge was issued').toBe(before);
    expect(mx.sent).toHaveLength(10);
  });
  it('a capped refusal logs mail.capped with the user id and never the address [red if: the cap is silent or logs the recipient]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, a);
    for (let i = 0; i < 10; i++) { ageChallenges(u.id); await e.handle(post('/second-step/send-code', { password: PW }, cookie), a); }
    ageChallenges(u.id);
    const cap = captureLogs();
    try { await e.handle(post('/second-step/send-code', { password: PW }, cookie), a); } finally { cap.stop(); }
    const text = cap.lines.join('\n');
    expect(text).toContain('mail.capped');
    expect(text).not.toContain(u.email);
  });
  it('notices are never counted or refused: after 10 token mails an outbox notice to the same address is still sent by the worker [red if: the worker shares the cap]', async () => {
    const mx = memMailer();
    const a = await mailAuth(e, mx);
    const u = e.seedUser();
    for (let i = 0; i < 10; i++) await magic(u.email, a);
    expect(await sentCount(mx, 10)).toBe(true);
    must(`INSERT INTO app.mail_outbox (user_id, kind, to_address, payload) VALUES ('${u.id}', 'password_changed', '${u.email}', '{}'::jsonb)`, e.db);
    const wm = memMailer();
    await ((await import('../../apps/worker/src/jobs/mail.ts')) as any).drainMail({ mailer: wm, origin: BASE });
    expect(wm.sent.map((s) => s.to)).toEqual([u.email]);
  });
});

describe('R2 password reset', () => {
  const ask = async (a = auth, m = mm, who = e.seedUser()) => {
    const n = m.sent.length;
    const r = await reset(who.email, {}, a);
    expect(r.status).toBe(200);
    expect(await sentCount(m, n + 1)).toBe(true);
    return { who, mail: lastTo(m, who.email)!, token: fragmentTokenIn(lastTo(m, who.email)!) };
  };
  const doReset = (token: string, a = auth, pw = 'a brand new long password 7') => e.handle(post('/reset-password', { token, newPassword: pw }), a);

  it('the mail: subject and text word for word, the link is origin/sign-in/reset#token and nothing else carries the token [red if: reset is off, or the link is a path or query]', async () => {
    const { mail, token } = await ask();
    expect(mail.subject).toBe('Reset your polycarpic password');
    expect(mail.text).toBe(RESET_TEXT(token));
    expect(mail.text).not.toMatch(/\/api\/auth\/|\?token=|callbackURL/);
  });
  it('R2.6(a) expiry: on a fake clock a token used at 899 s resets the password; one used at 901 s answers INVALID_TOKEN [red if: the lifetime is the library\'s 3600 s, or unset]', async () => {
    const early = await ask();
    advance(899_000);
    const ok = await doReset(early.token);
    expect([ok.status, (await json(ok)).status], JSON.stringify(await json(ok))).toEqual([200, true]);
    vi.useRealTimers();
    expect(hasSessionCookie((await e.signIn(early.who.email)).res), 'the old password is gone').toBe(false);
    const late = await ask();
    advance(901_000);
    const bad = await doReset(late.token);
    expect([bad.status, (await json(bad)).code]).toEqual([400, 'INVALID_TOKEN']);
  });
  it('R2.6(b) every session and handle of the user is gone after a reset, and the next sign-in still holds for the second step [red if: a reset leaves a session alive or clears the second step]', async () => {
    const x = await enrol(e, auth, mm);
    sessionWithHandle(e.db, x.u.id);
    sessionWithHandle(e.db, x.u.id);
    const { token } = await ask(auth, mm, x.u);
    expect((await doReset(token)).status).toBe(200);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${x.u.id}'`)).toBe(0);
    expect(e.count(`SELECT 1 FROM app.session_handle h WHERE NOT EXISTS (SELECT 1 FROM public.session s WHERE s.id = h.session_id)`), 'no orphan handle').toBe(0);
    const s = await e.handle(post('/sign-in/email', { email: x.u.email, password: 'a brand new long password 7' }), auth);
    expect((await json(s)).twoFactorRedirect, 'the second step still holds').toBe(true);
    expect(hasSessionCookie(s)).toBe(false);
  });
  it('R2.6(c) with no mailer, /request-password-reset answers 400 RESET_PASSWORD_DISABLED for a known and an unknown address alike [red if: reset is on with nothing to send with]', async () => {
    const none = await mailAuth(e, undefined);
    const u = e.seedUser();
    for (const email of [u.email, unknown()]) {
      const r = await reset(email, {}, none);
      expect([r.status, (await json(r)).code], email).toEqual([400, 'RESET_PASSWORD_DISABLED']);
    }
  });
  it('R2.6(d,g) a failing mailer: a known and an unknown address get the same 200 and body; mail.failed is logged once, with no address in any line [red if: the answer depends on the provider or on the account]', async () => {
    const bad = memMailer({ fail: true });
    const a = await mailAuth(e, bad);
    const u = e.seedUser();
    const cap = captureLogs();
    let known: Response, strange: Response;
    try {
      known = await reset(u.email, {}, a);
      strange = await reset(unknown(), {}, a);
      await settle(400);
    } finally { cap.stop(); }
    expect(known.status).toBe(200);
    expect(await body(known)).toBe(await body(strange));
    const text = cap.lines.join('\n');
    expect((text.match(/mail\.failed/g) ?? []).length, 'once: only the known address is ever sent to').toBe(1);
    expect(text).not.toContain(u.email);
  });
  it('R2.6(e) no verification row\'s identifier or value contains the token that was mailed [red if: the token is stored where a DB read can use it]', async () => {
    const { token } = await ask();
    const rows = must(`SELECT identifier, value FROM public.verification`, e.db).rows.flat().join('\n');
    expect(rows).not.toContain(token);
  });
  it('R2.6(f) no open redirect and no token in a URL: redirectTo to another origin is 403 invalid_redirect; GET /reset-password/x is 404 [red if: the reset link can be bounced elsewhere, or the GET route is open]', async () => {
    const u = e.seedUser();
    const r = await reset(u.email, { redirectTo: 'https://evil.example/x' });
    expect([r.status, (await json(r)).code]).toEqual([403, 'invalid_redirect']);
    const g = await e.handle(get('/reset-password/x'), auth);
    expect(g.status).toBe(404);
    const g2 = await e.handle(get('/reset-password/x?callbackURL=https://app.qa.test/'), auth);
    expect(g2.status).toBe(404);
  });
  it('a token is single use: the same token twice answers INVALID_TOKEN the second time [red if: a reset token is replayable]', async () => {
    const { token } = await ask();
    expect((await doReset(token)).status).toBe(200);
    const again = await doReset(token);
    expect([again.status, (await json(again)).code]).toEqual([400, 'INVALID_TOKEN']);
  });
});

describe('R7 a held magic-link sign-in answers 302 to the second-step page, with its two-factor cookie', () => {
  it('an enrolled user following the link with GET: 302 Location exactly /sign-in/second-step?with=code, a two-factor cookie, no session cookie, then verify-totp with that cookie signs in [red if: the browser gets JSON, or the cookie is dropped]', async () => {
    const x = await enrol(e, auth, mm);
    const n = mm.sent.length;
    await magic(x.u.email);
    expect(await sentCount(mm, n + 1)).toBe(true);
    const link = magicUrlIn(lastTo(mm, x.u.email)!);
    const r = await e.handle(new Request(link, { redirect: 'manual', headers: { origin: BASE, accept: 'text/html' } }), auth);
    expect(r.status, await r.clone().text()).toBe(302);
    expect(r.headers.get('location')).toBe('/sign-in/second-step?with=code');
    const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]!);
    expect(cookies.some((c) => /two_factor/.test(c)), 'the signed two-factor hold cookie is kept').toBe(true);
    expect(hasSessionCookie(r), 'no session yet').toBe(false);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const v = await e.handle(post('/two-factor/verify-totp', { code: totp(x.secret, Date.now() + 30_000) }, jar('', r)), auth);
    expect(v.status, JSON.stringify(await json(v))).toBe(200);
    expect(hasSessionCookie(v)).toBe(true);
  });
  it('a user with no second step is not redirected: the link signs in and sets the session cookie, no 302 to the second-step page [red if: the rewrite catches every verify]', async () => {
    const u = e.seedUser();
    const n = mm.sent.length;
    await magic(u.email);
    expect(await sentCount(mm, n + 1)).toBe(true);
    const r = await e.handle(new Request(magicUrlIn(lastTo(mm, u.email)!), { redirect: 'manual', headers: { origin: BASE } }), auth);
    expect(r.headers.get('location') ?? '').not.toContain('/sign-in/second-step');
    expect(hasSessionCookie(r)).toBe(true);
  });
});

describe('R8 /change-password refuses unless revokeOtherSessions is true', () => {
  const NEW = 'a different long password 42';
  it('absent or false: 400 revoke_other_sessions_required and the password is unchanged; true: 200, the other sessions are gone, the caller keeps a session with a handle [red if: the caller decides whether to revoke]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email);
    await e.signIn(u.email); // a second session
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(2);
    for (const extra of [{}, { revokeOtherSessions: false }]) {
      const r = await e.handle(post('/change-password', { currentPassword: PW, newPassword: NEW, ...extra }, cookie), auth);
      expect([r.status, (await json(r)).code], JSON.stringify(extra)).toEqual([400, 'revoke_other_sessions_required']);
    }
    expect(hasSessionCookie((await e.signIn(u.email)).res), 'the old password still works').toBe(true);
    const ok = await e.handle(post('/change-password', { currentPassword: PW, newPassword: NEW, revokeOtherSessions: true }, cookie), auth);
    expect(ok.status, JSON.stringify(await json(ok))).toBe(200);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`), 'only the caller\'s own session remains').toBe(1);
    expect(e.count(`SELECT 1 FROM app.session_handle h JOIN public.session s ON s.id = h.session_id WHERE s.user_id = '${u.id}'`), 'and it has a handle').toBe(1);
    const s2 = await e.handle(post('/sign-in/email', { email: u.email, password: NEW }), auth);
    expect(hasSessionCookie(s2)).toBe(true);
  });
});

describe('R4.1 the limiter covers the callbacks, magic-link verify, reset and cancel-hold: 5 a minute per client address and path', () => {
  const lim = async () => mailAuth(e, memMailer(), { limiter: true });
  const fromIp = (ip: string) => ({ 'x-forwarded-for': ip });
  const sixth = async (mk: (ip: string) => Request, a: any, ip: string) => {
    const s: number[] = [];
    for (let i = 0; i < 6; i++) s.push((await e.handle(mk(ip), a)).status);
    return s;
  };
  const getReq = (path: string) => (ip: string) => new Request(url(path), { headers: { origin: BASE, ...fromIp(ip) } });
  const postReq = (path: string, b: unknown) => (ip: string) => post(path, b, '', fromIp(ip));
  const cases: [string, (ip: string) => Request][] = [
    ['GET /magic-link/verify', getReq('/magic-link/verify?token=x')],
    ['GET /callback/google', getReq('/callback/google?code=x&state=y')],
    ['POST /reset-password', postReq('/reset-password', { token: 'x', newPassword: 'whatever long password 1' })],
    ['POST /second-step/cancel-hold', postReq('/second-step/cancel-hold', { token: 'x' })],
  ];
  for (const [label, mk] of cases) {
    it(`${label}: five answers are not 429, the sixth from the same address is; another address is not limited [red if: the route is off C-04's list]`, async () => {
      const a = await lim();
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
      const s = await sixth(mk, a, ip);
      expect(s.slice(0, 5), `${label} first five: ${s}`).not.toContain(429);
      expect(s[5], `${label} sixth: ${s}`).toBe(429);
      expect((await e.handle(mk('198.51.100.77'), a)).status, 'a different address').not.toBe(429);
    });
  }
  it('/callback/* limits per concrete path: google and github have their own buckets for one address [red if: the wildcard rule is shared across providers]', async () => {
    const a = await e.A.createAuth({ ...e.optionsOf('real-domain', { mailer: memMailer(), github: { clientId: 'g', clientSecret: 's' } }) });
    const ip = '203.0.113.9';
    const hit = (p: string) => e.handle(new Request(url(`/callback/${p}?code=x&state=y`), { headers: { origin: BASE, ...fromIp(ip) } }), a);
    for (let i = 0; i < 5; i++) await hit('google');
    expect((await hit('google')).status).toBe(429);
    expect((await hit('github')).status, 'github has its own bucket').not.toBe(429);
  });
});
