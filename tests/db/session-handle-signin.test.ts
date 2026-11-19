// POLY-153 R5.1, R5.3 (C5), seceng H3 / T5: the session and its handle commit together on the four no-session sign-in paths and on
// sign-up. The forced failure is on the real handle INSERT: a BEFORE INSERT trigger on app.session_handle, planted by the superuser
// and dropped afterwards. Then the same with the insert silently skipped, which only the deferred check (23514) can catch.
// Titles end [red if: <mutation>]. Red today: no app.session_handle, no handle plugin.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { hasSessionCookie } from './helpers/auth-service';
import { handleOf, handleSetCookie, HANDLE_COOKIE } from './helpers/handle';
import { seedInvitation } from './helpers/invitation';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));
afterEach(() => { must(`DROP TRIGGER IF EXISTS qa_boom ON app.session_handle; DROP FUNCTION IF EXISTS public.qa_boom()`, e.db); vi.restoreAllMocks(); });

const BOOM = (mode: 'raise' | 'skip') => must(
  `CREATE FUNCTION public.qa_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${mode === 'raise' ? `RAISE EXCEPTION 'qa: forced handle insert failure'` : 'RETURN NULL'}; END $$;
   CREATE TRIGGER qa_boom BEFORE INSERT ON app.session_handle FOR EACH ROW EXECUTE FUNCTION public.qa_boom();`, e.db);
const sessionsOf = (email: string) => e.count(`SELECT 1 FROM public.session s JOIN public."user" u ON u.id = s.user_id WHERE u.email = '${email}'`);
const handles = () => e.count('SELECT 1 FROM app.session_handle');
const anyHandleCookie = (r: Response) => r.headers.getSetCookie().some((c) => c.startsWith(`${HANDLE_COOKIE}=`));

type Attempt = { name: string; run: () => Promise<{ res: Response; email: string }> };
const attempts: Attempt[] = [
  { name: '/sign-in/email', run: async () => { const u = e.seedUser(); return { res: await e.handle(post('/sign-in/email', { email: u.email, password: PW })), email: u.email }; } },
  { name: '/magic-link/verify', run: async () => {
    const u = e.seedUser(); const sent: { token: string }[] = [];
    const a = await (async () => { const o: any = e.optionsOf('real-domain', { sendMagicLink: async (m: any) => { sent.push(m); } }); o.rateLimit = { enabled: false }; return e.A.createAuth(o); })();
    await e.handle(post('/sign-in/magic-link', { email: u.email }), a);
    return { res: await e.handle(get(`/magic-link/verify?token=${sent[0]!.token}&callbackURL=/`), a), email: u.email };
  } },
  { name: '/callback/:id (Google)', run: async () => { const u = e.seedUser({ password: false }); return { res: await e.oauth(u.email, await e.mk()), email: u.email }; } },
  { name: '/passkey/verify-authentication', run: async () => {
    const u = e.seedUser(); const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${u.id}'`, e.db);
    const g = await e.handle(get('/passkey/generate-authenticate-options'));
    const opt: any = await g.clone().json();
    return { res: await e.handle(post('/passkey/verify-authentication', { response: k.assert(opt, 1) }, jar('', g))), email: u.email };
  } },
  { name: '/sign-up/email', run: async () => {
    const email = `su-${Math.random().toString(36).slice(2)}@qa.test`;
    const invitationToken = seedInvitation({ db: e.db, email, role: 'viewer' });
    return { res: await e.handle(post('/sign-up/email', { email, password: PW, name: 'Signup', invitationToken })), email };
  } },
];

describe('R5.3 a forced failure of the real handle INSERT leaves no session row and sets no cookie of either kind', () => {
  for (const a of attempts) {
    it(`${a.name}: 5xx, no Set-Cookie of the session or the handle, no session row [red if: the session commits without its handle or the cookie is set before the commit]`, async () => {
      BOOM('raise');
      const h0 = handles();
      const { res, email } = await a.run();
      expect(res.status, 'a forced handle failure must surface as a 5xx, not a success').toBeGreaterThanOrEqual(500);
      expect(hasSessionCookie(res)).toBe(false);
      expect(anyHandleCookie(res)).toBe(false);
      expect(sessionsOf(email)).toBe(0);
      expect(handles()).toBe(h0);
    });
  }
  it('control: without the plant the same five paths succeed, set both cookies and leave one handle row each [red if: the paths never issue a handle, so the plant above proves nothing]', async () => {
    for (const a of attempts) {
      const h0 = handles();
      const { res, email } = await a.run();
      expect(res.status, a.name).toBeLessThan(400);
      expect(handleOf(res), a.name).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessionsOf(email), a.name).toBe(1);
      expect(handles(), a.name).toBe(h0 + 1);
    }
  });
});

describe('R5.2/R5.3 the attach silently inserts nothing: the commit fails 23514 and no session row stays', () => {
  for (const a of attempts) {
    it(`${a.name} [red if: the deferred check is absent, so a handle-less session commits]`, async () => {
      BOOM('skip');
      const { res, email } = await a.run();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(hasSessionCookie(res)).toBe(false);
      expect(sessionsOf(email)).toBe(0);
    });
  }
});

describe('R5.1 H3 / T5: the handle is only in Set-Cookie and Cookie, never in a body, URL, log line or error', () => {
  const line = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  it('a successful sign-in: the handle is in no body, no Location, no log line [red if: the plugin logs or echoes the value]', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const u = e.seedUser();
    const res = await e.handle(post('/sign-in/email', { email: u.email, password: PW }));
    const h = handleOf(res)!;
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await res.clone().text()).not.toContain(h);
    expect(res.headers.get('location') ?? '').not.toContain(h);
    for (const [k, v] of res.headers) if (k !== 'set-cookie') expect(v, k).not.toContain(h);
    for (const s of spies) for (const l of line(s)) expect(l).not.toContain(h);
    expect(handleSetCookie(res)).toMatch(/^__Host-poly_handle=[A-Za-z0-9_-]{43}; Path=\/; /);
  });
  it('T5: a plugin run with no request transaction throws and answers 5xx; the body, headers and log hold no 43-character handle and no session survives [red if: the plugin falls back to a pool or leaks the value in the error]', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const auth = await e.mk();
    const u = e.seedUser();
    // auth.handler directly: no withSignInTx, so currentClient() is null inside the plugin's hook
    const res = await auth.handler(post('/sign-in/email', { email: u.email, password: PW }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(anyHandleCookie(res)).toBe(false);
    expect(sessionsOf(u.email)).toBe(0);
    const b64 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
    expect(await res.clone().text()).not.toMatch(b64);
    for (const s of spies) for (const l of line(s)) expect(l).not.toMatch(b64);
  });
});
