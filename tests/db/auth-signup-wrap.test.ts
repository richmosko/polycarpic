// POLY-86 criteria 11, 12 (ARCH v1.14 §3.1c; SECURITY A-40; ruling R4; seceng S1, S8, S11). Real Postgres, as poly_app.
// claimInvitation is the one mocked export (ruling R3); everything else is the exported app configuration.
// "ran inside the wrapper" is asserted two ways: the hook saw currentClient().kind === 'withContextFreeTx', and the user row
// was inserted by the SAME top-level transaction the wrapper opened (a test trigger records txid_current() on INSERT; the
// claim mock records it inside the wrapper). Ruling R4 says xmin; that cannot hold, BetterAuth's insert runs in a savepoint
// so xmin is a subtransaction id (ARCH §3.1c says so itself). Reported to the architect.
// Titles end with [red if: <mutation>].
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, claim, get, jar, post, teardown, url, type Env } from './helpers/auth';
import { must } from './helpers/sql';
import { newToken, seedInvitation } from './helpers/invitation';
import { USER_INSERTING } from '../../packages/auth/src/route-policy.ts';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let auth: any;
const seen: { kind: string | undefined; txid: string; email: string; token: string | null }[] = [];

beforeAll(async () => {
  e = await boot();
  auth = await e.mk();
  must(`CREATE TABLE public.qa_user_tx (user_id uuid, txid bigint); GRANT SELECT, INSERT ON public.qa_user_tx TO poly_app;
    CREATE FUNCTION public.qa_log_user_tx() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.qa_user_tx VALUES (NEW.id, txid_current()); RETURN NEW; END $$;
    CREATE TRIGGER qa_user_tx AFTER INSERT ON public."user" FOR EACH ROW EXECUTE FUNCTION public.qa_log_user_tx();
    CREATE FUNCTION public.qa_refuse_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM public."user" WHERE id = NEW.user_id AND email LIKE 'refuse-%') THEN RAISE EXCEPTION 'qa: session refused'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER qa_refuse_session BEFORE INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION public.qa_refuse_session();`, e.db);
});
afterAll(() => teardown(e));
afterEach(() => { claim.impl = null; seen.length = 0; });

const accepting = () => {
  // POLY-87: the mock only records now and then runs the REAL claim, so every sign-up below needs a real invitation (invite()).
  claim.impl = async (tx, a, real) => {
    const t = (await e.dba.clientOf(tx).query('select txid_current()::text t')).rows[0].t as string;
    seen.push({ kind: e.dba.currentClient()?.kind, txid: t, email: a.email, token: a.token });
    return real(tx, a);
  };
};
const userTx = (email: string) => must(`SELECT t.txid::text FROM public.qa_user_tx t JOIN public."user" u ON u.id = t.user_id WHERE u.email = '${email}'`, e.db).rows[0]?.[0];
const invite = (email: string) => seedInvitation({ db: e.db, email, role: 'viewer' });
const users = (email: string) => e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`);
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const oauthCallback = (email: string, a = auth) => e.oauth(email, a);

const drivers: Record<string, (email: string, token?: string) => Promise<Response>> = {
  '/sign-up/email': (email, token = newToken()) => e.handle(post('/sign-up/email', { email, password: PW, name: 'Signed Up', invitationToken: token }), auth),
  '/magic-link/verify': async (email) => {
    e.mails.length = 0;
    await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
    const m = e.mails.find((x) => x.email === email)!;
    return e.handle(get(`/magic-link/verify?token=${m.token}&callbackURL=/`), auth);
  },
  '/callback/:id': (email) => oauthCallback(email),
};

describe('criterion 11: every user-inserting route runs inside withContextFreeTx', () => {
  it('USER_INSERTING lists exactly sign-up/email, callback/:id, magic-link/verify, and /sign-in/social is not one  [red if: a route that can insert a user is unlisted (S8, R3)]', () => {
    expect([...USER_INSERTING].sort()).toEqual(['/callback/:id', '/magic-link/verify', '/sign-up/email']);
    expect(Object.keys(drivers).sort()).toEqual([...USER_INSERTING].sort());
  });

  for (const path of Object.keys(drivers))
    it(`${path}: creates the user inside the wrapper, in the transaction the wrapper opened  [red if: the handler runs this route on the plain pool or under withTenant]`, async () => {
      accepting();
      const email = `wrap-${stamp()}@qa.test`;
      const token = invite(email);
      const res = await drivers[path](email, token);
      expect(res.status, await res.clone().text()).toBeLessThan(400);
      expect(users(email)).toBe(1);
      // /sign-up/email claims twice (route hook, then the user hook; ruling R3); the other two routes once
      expect(seen).toHaveLength(path === '/sign-up/email' ? 2 : 1);
      for (const s of seen) {
        expect(s.email).toBe(email);
        expect(s.kind).toBe('withContextFreeTx');
        expect(userTx(email)).toBe(s.txid);
        expect(s.token).toBe(path === '/sign-up/email' ? token : null);
      } // OAuth and magic link match by verified email (R3, U2)
    });

  for (const path of Object.keys(drivers))
    it(`S11: ${path} with no invitation (the real stub) leaves no user row, no session, and answers an error  [red if: claimInvitation sits on /sign-up/email only, so OAuth or magic link create users for unknown emails]`, async () => {
      claim.impl = null;
      const email = `noinv-${stamp()}@qa.test`;
      const res = await drivers[path](email);
      expect(users(email)).toBe(0);
      expect(res.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c))).toBe(false);
      expect(res.status >= 300, `${path} answered ${res.status}`).toBe(true);
      expect(e.count(`SELECT 1 FROM public.session s JOIN public."user" u ON u.id = s.user_id WHERE u.email = '${email}'`)).toBe(0);
    });
});

describe('criterion 12: the sign-up hook never opens a transaction of its own', () => {
  it('with no withContextFreeTx open (currentClient() null) the hook throws SignUpOutsideTransaction and writes nothing  [red if: the hook opens its own transaction, or does not check]', async () => {
    accepting();
    const email = `outside-${stamp()}@qa.test`;
    expect(e.dba.currentClient()).toBeNull();
    const ctx = await auth.$context;
    await expect(ctx.internalAdapter.createUser({ email, name: 'Outside', emailVerified: false })).rejects.toThrow(/SignUpOutsideTransaction|outside/i);
    expect(users(email)).toBe(0);
  });

  it('under withTenant (a signed-in request) a user-creating route fails closed: hook throws, no user row  [red if: the check accepts any client rather than kind === withContextFreeTx]', async () => {
    accepting();
    const existing = e.seedUser();
    const { cookie } = await e.signIn(existing.email, auth);
    const email = `signedin-${stamp()}@qa.test`;
    const res = await e.handle(post('/sign-up/email', { email, password: PW, name: 'X', invitationToken: newToken() }, cookie), auth);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(users(email)).toBe(0);
  });
});

describe('S1/P1: commit only on success', () => {
  it('sign-up whose session insert is refused leaves no user, no account, and no Set-Cookie  [red if: handleAuthRequest commits when auth.handler returns >= 400 (BetterAuth swallows the throw)]', async () => {
    accepting();
    const email = `refuse-${stamp()}@qa.test`;
    const res = await drivers['/sign-up/email'](email, invite(email));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(users(email)).toBe(0);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('magic-link verify whose session insert is refused leaves no user row  [red if: a 3xx to the error page is committed]', async () => {
    accepting();
    const email = `refuse-${stamp()}@qa.test`;
    invite(email);
    const res = await drivers['/magic-link/verify'](email);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(users(email)).toBe(0);
    expect(res.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c))).toBe(false);
  });

  it('a before-hook refusal writes nothing from the request  [red if: a partial write survives a refused request]', async () => {
    const before = e.count('SELECT 1 FROM public."user"') + e.count('SELECT 1 FROM public.verification');
    const email = `hookref-${stamp()}@qa.test`;
    const res = await e.handle(post('/sign-up/email', { email, password: PW, name: 'N' }), auth); // no invitationToken: refused by the before-hook
    expect(res.status).toBe(403);
    expect(e.count('SELECT 1 FROM public."user"') + e.count('SELECT 1 FROM public.verification')).toBe(before);
  });

  it('a signed-in request that writes then fails leaves no row (guard-refused first TOTP verify, simulated)  [red if: the write before the failing step commits]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    must(`CREATE OR REPLACE FUNCTION public.qa_fail_second_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa: second write refused'; END $$;
      CREATE TRIGGER qa_fail_account BEFORE UPDATE ON public."user" FOR EACH ROW WHEN (NEW.name = 'Boom') EXECUTE FUNCTION public.qa_fail_second_write();`, e.db);
    const before = e.count(`SELECT 1 FROM public.verification`);
    const r = await e.handle(post('/update-user', { name: 'Boom' }, cookie), auth);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(must(`SELECT name FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0][0]).toBe('QA User');
    expect(e.count(`SELECT 1 FROM public.verification`)).toBe(before);
    expect(r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c))).toBe(false);
    void url;
  });
});
