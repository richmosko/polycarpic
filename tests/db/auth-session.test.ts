// POLY-86 criteria 4, 13 (ruling R5; seceng S13, S14, S15). Real Postgres, as poly_app. Step-up stamps are written as superuser,
// exactly as POLY-89's definers will write them in production (no route in this issue sets recent_auth_at).
// ASSUMED shapes (ruling gives names, not signatures): revokeSession(tx, id) rejects with an error carrying status 404 when it
// deletes zero rows; listSessions(tx) resolves an array. Reconcile in helpers/auth.ts or here, one line each.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASE, PW, boot, get, post, teardown, type Env } from './helpers/auth';
import { must } from './helpers/pg';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let auth: any;
beforeAll(async () => { e = await boot(); auth = await e.mk(); });
afterAll(() => teardown(e));

const page = (cookie: string, path = '/dashboard') => new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
const load = (cookie: string) => e.A.loadSession(page(cookie), auth);
const tenant = (userId: string, sessionId: string, fn: (tx: any) => Promise<any>) => e.dbm.withTenant(e.dbs.sessionUserId(userId), sessionId, fn);
const stamp = (userId: string, sql: string) => must(`UPDATE public.session SET recent_auth_at = ${sql} WHERE user_id = '${userId}'`, e.db);
const sid = (userId: string) => must(`SELECT id FROM public.session WHERE user_id = '${userId}' ORDER BY created_at LIMIT 1`, e.db).rows[0][0];
const body = async (r: Response) => { try { return JSON.stringify(await r.clone().json()); } catch { return await r.clone().text(); } };

describe('criterion 4: requireRecentAuth', () => {
  it('stamps 4 min, 6 min, none and +1 min give pass, 403, 403, 403 on a step-up route, code step_up_required  [red if: window off by a factor, null passes, a future stamp passes, or the clock is the app\'s not the database\'s]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    const call = () => e.handle(post('/revoke-other-sessions', {}, cookie), auth);
    stamp(u.id, `now() - interval '4 minutes'`);
    expect((await call()).status).toBe(200);
    stamp(u.id, `now() - interval '6 minutes'`);
    const six = await call();
    expect(six.status).toBe(403);
    expect(await body(six)).toMatch(/step_up_required/);
    stamp(u.id, 'NULL');
    expect((await call()).status).toBe(403);
    stamp(u.id, `now() + interval '1 minute'`);
    expect((await call()).status).toBe(403);
  });

  it('recent_auth_at is read from the row on every call, not cached on the cookie  [red if: cookieCache is on or the stamp is read once]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    stamp(u.id, `now() - interval '1 minute'`);
    expect((await e.handle(post('/revoke-other-sessions', {}, cookie), auth)).status).toBe(200);
    stamp(u.id, `now() - interval '9 minutes'`);
    expect((await e.handle(post('/revoke-other-sessions', {}, cookie), auth)).status).toBe(403);
  });

  it('input: false: no request body sets recentAuthAt, on sign-in or any update route  [red if: the session field accepts input]', async () => {
    const u = e.seedUser();
    const r = await e.handle(post('/sign-in/email', { email: u.email, password: PW, recentAuthAt: new Date().toISOString() }), auth);
    expect(r.status).toBe(200);
    expect(must(`SELECT recent_auth_at IS NULL FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0]).toBe('t');
    const { cookie } = await e.signIn(u.email, auth);
    for (const p of ['/update-user', '/update-session']) await e.handle(post(p, { recentAuthAt: new Date().toISOString() }, cookie), auth);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}' AND recent_auth_at IS NOT NULL`)).toBe(0);
  });
});

describe('Settings → Sessions', () => {
  async function twoSessions() {
    const u = e.seedUser();
    const a = await e.signIn(u.email, auth);
    const b = await e.signIn(u.email, auth);
    return { u, a, b };
  }

  it('lists id, device, created, last-seen and current; never a token  [red if: the projection returns session.token or the full row]', async () => {
    const { u } = await twoSessions();
    const rows = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at`, e.db).rows.map((r) => r[0]);
    const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at LIMIT 1`, e.db).rows[0][0];
    const list = await tenant(u.id, rows[0], (tx) => e.A.listSessions(tx));
    expect(list).toHaveLength(2);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'id', 'ipAddress', 'updatedAt', 'userAgent']);
    expect(list.filter((s: any) => s.current).map((s: any) => s.id)).toEqual([rows[0]]);
    expect(JSON.stringify(list)).not.toContain(token);
  });

  it("user B cannot list or revoke A's sessions  [red if: the session table is read without user_id = app.current_user_id()]", async () => {
    const { u } = await twoSessions();
    const other = e.seedUser();
    await e.signIn(other.email, auth);
    const bSid = sid(other.id);
    const aSid = sid(u.id);
    const list = await tenant(other.id, bSid, (tx) => e.A.listSessions(tx));
    expect(list.map((s: any) => s.id)).toEqual([bSid]);
    await expect(tenant(other.id, bSid, (tx) => e.A.revokeSession(tx, aSid))).rejects.toMatchObject({ status: 404 });
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${aSid}'`)).toBe(1);
  });

  it('S13: revoking another session without step-up is 403 and the row stays; with step-up it is deleted  [red if: revoke-by-id skips requireRecentAuth]', async () => {
    const { u } = await twoSessions();
    const [cur, other] = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at`, e.db).rows.map((r) => r[0]);
    await expect(tenant(u.id, cur, (tx) => e.A.revokeSession(tx, other))).rejects.toMatchObject({ status: 403 });
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${other}'`)).toBe(1);
    must(`UPDATE public.session SET recent_auth_at = now() - interval '1 minute' WHERE id = '${cur}'`, e.db);
    await tenant(u.id, cur, (tx) => e.A.revokeSession(tx, other));
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${other}'`)).toBe(0);
  });

  it('S13: revoking the current session is sign-out and needs no step-up  [red if: the step-up check is applied to the current session too]', async () => {
    const { u } = await twoSessions();
    const cur = sid(u.id);
    await tenant(u.id, cur, (tx) => e.A.revokeSession(tx, cur));
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${cur}'`)).toBe(0);
  });
});

describe('loadSession: projection, cache, caps (S14, S15)', () => {
  it('returns the token-free ShellSession and only Set-Cookie strings; a revoked session stops at once  [red if: the projection carries token or session id (S1/S15), or cookieCache keeps a revoked session alive]', async () => {
    const u = e.seedUser({ name: 'Shell Person' });
    const { cookie } = await e.signIn(u.email, auth);
    const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0];
    const s = await load(cookie);
    expect(s.userId).toBe(u.id);
    expect(Object.keys(s.shell).sort()).toEqual(['expiresAt', 'user']);
    expect(s.shell.user).toEqual({ id: u.id, name: 'Shell Person', image: null });
    const wire = JSON.stringify(s.shell);
    expect(wire).not.toContain(token);
    expect(wire).not.toContain(s.sessionId);
    expect(wire).not.toContain(decodeURIComponent(cookie.split('=').slice(1).join('=')));
    expect(Array.isArray(s.setCookie) && s.setCookie.every((c: string) => typeof c === 'string')).toBe(true);
    must(`DELETE FROM public.session WHERE user_id = '${u.id}'`, e.db);
    expect(await load(cookie)).toBeNull();
  });

  it('no cookie: null, and nothing is provisioned  [red if: a signed-out request provisions or throws]', async () => {
    expect(await load('')).toBeNull();
  });

  it('30-day absolute cap: a 31-day-old session that keeps being refreshed is signed out on a page and on /api/auth/*; the row is deleted and the cookie expired  [red if: only BetterAuth\'s sliding expiry applies]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET created_at = now() - interval '31 days', updated_at = now(), expires_at = now() + interval '6 days' WHERE user_id = '${u.id}'`, e.db);
    const viaApi = await e.handle(get('/list-accounts', cookie), auth);
    expect(viaApi.status).toBe(401);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(0);
    expect(viaApi.headers.getSetCookie().some((c) => /session_token=;|max-age=0/i.test(c))).toBe(true);
    // and on a page, with a freshly capped session
    const again = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET created_at = now() - interval '31 days', updated_at = now(), expires_at = now() + interval '6 days' WHERE user_id = '${u.id}'`, e.db);
    expect(await load(again.cookie)).toBeNull();
  });

  it('7-day idle: an 8-day-idle session is refused  [red if: expiresIn is not 7 days]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET updated_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE user_id = '${u.id}'`, e.db);
    expect(await load(cookie)).toBeNull();
    expect((await e.handle(get('/list-accounts', cookie), auth)).status).toBe(401);
  });
});

describe('criterion 13: provisionPerson in the loader, one retry on entity_self_user_id_unique', () => {
  const people = (uid: string) => e.count(`SELECT 1 FROM public.entity WHERE self_user_id = '${uid}'`);
  const owners = (uid: string) => e.count(`SELECT 1 FROM public.membership m JOIN public.entity en ON en.id = m.entity_id WHERE en.self_user_id = '${uid}' AND m.user_id = '${uid}' AND m.role = 'owner'`);

  it('two concurrent first loads for one new user end with one Person and one owner membership, and both succeed  [red if: no retry on 23505, a loop, or the retry swallows the winner\'s row]', async () => {
    for (const n of [2, 6]) {
      const u = e.seedUser();
      const { cookie } = await e.signIn(u.email, auth);
      expect(people(u.id)).toBe(0);
      const out = await Promise.allSettled(Array.from({ length: n }, () => load(cookie)));
      expect(out.map((o) => o.status), JSON.stringify(out.filter((o) => o.status === 'rejected'))).toEqual(Array(n).fill('fulfilled'));
      for (const o of out) expect((o as any).value.userId).toBe(u.id);
      expect(people(u.id)).toBe(1);
      expect(owners(u.id)).toBe(1);
    }
  });

  it('a later load finds the existing Person (created: false) and writes nothing  [red if: provisioning is not idempotent through the loader]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    await load(cookie);
    await load(cookie);
    expect(people(u.id)).toBe(1);
  });

  describe('failure shapes (a trigger raises; nextval counts attempts outside the transaction)', () => {
    beforeAll(() => {
      must(`CREATE SEQUENCE public.qa_attempts;
        GRANT USAGE ON SEQUENCE public.qa_attempts TO poly_app;
        CREATE FUNCTION public.qa_fail_person() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          PERFORM nextval('public.qa_attempts');
          IF NEW.name = 'Doomed' THEN RAISE EXCEPTION 'dup' USING ERRCODE = '23505', CONSTRAINT = 'entity_self_user_id_unique'; END IF;
          IF NEW.name = 'OtherUq' THEN RAISE EXCEPTION 'dup' USING ERRCODE = '23505', CONSTRAINT = 'some_other_unique'; END IF;
          IF NEW.name = 'OtherErr' THEN RAISE EXCEPTION 'other' USING ERRCODE = 'P0001'; END IF;
          RETURN NEW; END $$;
        CREATE TRIGGER qa_fail_person BEFORE INSERT ON public.entity FOR EACH ROW WHEN (NEW.name IN ('Doomed', 'OtherUq', 'OtherErr')) EXECUTE FUNCTION public.qa_fail_person();`, e.db);
    });
    const attempts = () => Number(must(`SELECT last_value FROM public.qa_attempts`, e.db).rows[0][0]) * (must(`SELECT is_called FROM public.qa_attempts`, e.db).rows[0][0] === 't' ? 1 : 0);

    it('a second 23505 on entity_self_user_id_unique fails the request after exactly two attempts, logged without cookie, token or email  [red if: an unbounded loop, a swallowed error, or the log carries the cookie, token or email (E1)]', async () => {
      const u = e.seedUser({ name: 'Doomed' });
      const { cookie } = await e.signIn(u.email, auth);
      const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0];
      const logs: string[] = [];
      const spies = (['error', 'warn', 'log', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${JSON.stringify(x)}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }));
      const before = attempts();
      try { await expect(load(cookie)).rejects.toThrow(); } finally { spies.forEach((s) => s.mockRestore()); }
      expect(attempts() - before).toBe(2);
      const all = logs.join('\n');
      for (const secret of [token, u.email, decodeURIComponent(cookie.split('=').slice(1).join('='))]) expect(all).not.toContain(secret);
      expect(people(u.id)).toBe(0);
    });

    it('a 23505 on any other constraint, and any other error, is not retried  [red if: the retry matches on code alone, or on any error]', async () => {
      for (const name of ['OtherUq', 'OtherErr']) {
        const u = e.seedUser({ name });
        const { cookie } = await e.signIn(u.email, auth);
        const before = attempts();
        await expect(load(cookie)).rejects.toThrow();
        expect(attempts() - before, name).toBe(1);
      }
    });
  });
});
