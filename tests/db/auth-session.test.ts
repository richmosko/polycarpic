// POLY-86 criteria 4, 13 (ruling R5; seceng S13, S14, S15). Real Postgres, as poly_app. Step-up stamps are written as superuser,
// exactly as POLY-89's definers will write them in production (no route in this issue sets recent_auth_at).
// POLY-153 R6, R7: Settings → Sessions and the shell run on withSession(handle); the old loadSession and withTenant paths are gone.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, post, teardown, type Env } from './helpers/auth';
import { handleOf } from './helpers/handle';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let auth: any;
beforeAll(async () => { e = await boot(); auth = await e.mk(); });
afterAll(() => teardown(e));

const bySession = (handle: string, fn: (tx: any, row: any) => Promise<any>) => e.dbm.withSession(handle, fn);
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

describe('Settings → Sessions (by handle: withSession, then the three definers)', () => {
  async function twoSessions() {
    const u = e.seedUser();
    const a = await e.signIn(u.email, auth);
    const b = await e.signIn(u.email, auth);
    return { u, a, b, ha: handleOf(a.res)!, hb: handleOf(b.res)! };
  }

  it('lists id, device, created, last-seen and current; never a token or a handle  [red if: the projection returns session.token, the handle or the full row]', async () => {
    const { u, ha, hb } = await twoSessions();
    const rows = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at`, e.db).rows.map((r) => r[0]);
    const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at LIMIT 1`, e.db).rows[0][0];
    const list = await bySession(ha, (tx) => e.A.listSessions(tx));
    expect(list).toHaveLength(2);
    for (const s of list) expect([s.createdAt, s.updatedAt].every((d: unknown) => d instanceof Date), 'timestamps are Dates [red if: raw driver strings reach the page load, 500 in the app]').toBe(true);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'id', 'ipAddress', 'updatedAt', 'userAgent']);
    expect(list.filter((s: any) => s.current).map((s: any) => s.id)).toEqual([rows[0]]);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(list)).not.toContain(ha);
    expect(JSON.stringify(list)).not.toContain(hb);
  });

  it("user B cannot list or revoke A's sessions  [red if: the definers do not scope to the marker's user]", async () => {
    const { u } = await twoSessions();
    const other = e.seedUser();
    const o = await e.signIn(other.email, auth);
    const hO = handleOf(o.res)!;
    const bSid = sid(other.id);
    const aSid = sid(u.id);
    const list = await bySession(hO, (tx) => e.A.listSessions(tx));
    expect(list.map((s: any) => s.id)).toEqual([bSid]);
    await expect(bySession(hO, (tx) => e.A.revokeSession(tx, aSid))).rejects.toMatchObject({ status: 404 });
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${aSid}'`)).toBe(1);
  });

  it('S13: revoking another session without step-up is 403 and the row stays; with step-up it is deleted, handle included  [red if: revoke-by-id skips the step-up check]', async () => {
    const { u, ha } = await twoSessions();
    const [cur, other] = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at`, e.db).rows.map((r) => r[0]);
    await expect(bySession(ha, (tx) => e.A.revokeSession(tx, other))).rejects.toMatchObject({ status: 403 });
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${other}'`)).toBe(1);
    must(`UPDATE public.session SET recent_auth_at = now() - interval '1 minute' WHERE id = '${cur}'`, e.db);
    await bySession(ha, (tx) => e.A.revokeSession(tx, other));
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${other}'`)).toBe(0);
    expect(e.count(`SELECT 1 FROM app.session_handle WHERE session_id = '${other}'`)).toBe(0);
  });

  it('S13: revoking the current session is sign-out and needs no step-up; its handle then enters nothing  [red if: the step-up check is applied to the current session too]', async () => {
    const { u, ha } = await twoSessions();
    const cur = sid(u.id);
    await bySession(ha, (tx) => e.A.revokeSession(tx, cur));
    expect(e.count(`SELECT 1 FROM public.session WHERE id = '${cur}'`)).toBe(0);
    await expect(bySession(ha, async () => 1)).rejects.toBeInstanceOf(e.dbm.NoLiveSession);
  });

  it('web\'s revokeMySession answers whether it was the current session [red if: the caller cannot tell it must clear the handle cookie]', async () => {
    const { u, ha } = await twoSessions();
    const [cur, other] = must(`SELECT id FROM public.session WHERE user_id = '${u.id}' ORDER BY created_at`, e.db).rows.map((r) => r[0]);
    must(`UPDATE public.session SET recent_auth_at = now() - interval '1 minute' WHERE id = '${cur}'`, e.db);
    expect(await e.A.revokeMySession(ha, other)).toEqual({ current: false });
    expect(await e.A.revokeMySession(ha, cur)).toEqual({ current: true });
  });
});

describe('withSession: the shell, the caps and the idle bound (S14, S15; was loadSession)', () => {
  it('hands fn the token-free flat row and relays no cookie; a revoked session stops at once  [red if: the row carries the token, the handle or a cookie, or a deleted session still enters]', async () => {
    const u = e.seedUser({ name: 'Shell Person' });
    const { cookie, res } = await e.signIn(u.email, auth);
    const h = handleOf(res)!;
    const token = must(`SELECT token FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0];
    const s = await bySession(h, async (_tx, row: any) => row);
    expect(s.userId).toBe(u.id);
    expect(Object.keys(s).sort()).toEqual(['expiresAt', 'image', 'name', 'sessionId', 'userId']);
    expect(s.name).toBe('Shell Person');
    const wire = JSON.stringify(s);
    expect(wire).not.toContain(token);
    expect(wire).not.toContain(h);
    expect(wire).not.toContain(decodeURIComponent(cookie.split('=').slice(1).join('=').split(';')[0]!));
    must(`DELETE FROM public.session WHERE user_id = '${u.id}'`, e.db);
    await expect(bySession(h, async () => 1)).rejects.toBeInstanceOf(e.dbm.NoLiveSession);
  });

  it('30-day absolute cap: a 31-day-old session that keeps being refreshed is refused by withSession and on /api/auth/*; the row is deleted and the cookie expired  [red if: only BetterAuth\'s sliding expiry applies]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET created_at = now() - interval '31 days', updated_at = now(), expires_at = now() + interval '6 days' WHERE user_id = '${u.id}'`, e.db);
    const viaApi = await e.handle(get('/list-accounts', cookie), auth);
    expect(viaApi.status).toBe(401);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(0);
    expect(viaApi.headers.getSetCookie().some((c) => /session_token=;|max-age=0/i.test(c))).toBe(true);
    expect(viaApi.headers.getSetCookie().some((c) => /^__Host-poly_handle=;.*max-age=0/i.test(c)), 'the cap also clears the handle cookie').toBe(true);
    // and by handle, with a freshly capped session
    const again = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET created_at = now() - interval '31 days', updated_at = now(), expires_at = now() + interval '6 days' WHERE user_id = '${u.id}'`, e.db);
    await expect(bySession(handleOf(again.res)!, async () => 1)).rejects.toBeInstanceOf(e.dbm.NoLiveSession);
  });

  it('7-day idle: an 8-day-idle session is refused by handle and on /api/auth  [red if: expiresIn is not 7 days]', async () => {
    const u = e.seedUser();
    const { cookie, res } = await e.signIn(u.email, auth);
    must(`UPDATE public.session SET updated_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE user_id = '${u.id}'`, e.db);
    await expect(bySession(handleOf(res)!, async () => 1)).rejects.toBeInstanceOf(e.dbm.NoLiveSession);
    expect((await e.handle(get('/list-accounts', cookie), auth)).status).toBe(401);
  });
});

describe('criterion 13: provisionPerson under a session marker (the retry itself is in hooks.server.ts, unit-tested there)', () => {
  const people = (uid: string) => e.count(`SELECT 1 FROM public.entity WHERE self_user_id = '${uid}'`);
  const owners = (uid: string) => e.count(`SELECT 1 FROM public.membership m JOIN public.entity en ON en.id = m.entity_id WHERE en.self_user_id = '${uid}' AND m.user_id = '${uid}' AND m.role = 'owner'`);
  const provision = async (h: string) => { const { provisionPerson } = await import('../../packages/tenancy/src/index.ts'); return bySession(h, (tx, row: any) => provisionPerson(tx, row.name)); };

  it('concurrent first loads for one new user end with one Person and one owner membership; a loser fails only on entity_self_user_id_unique, which the hook retries  [red if: two Persons, or a different failure]', async () => {
    for (const n of [2, 6]) {
      const u = e.seedUser();
      const { res } = await e.signIn(u.email, auth);
      const h = handleOf(res)!;
      expect(people(u.id)).toBe(0);
      const out = await Promise.allSettled(Array.from({ length: n }, () => provision(h)));
      for (const o of out) if (o.status === 'rejected') expect(JSON.stringify([(o.reason as any)?.code, (o.reason as any)?.cause?.code, (o.reason as any)?.constraint, (o.reason as any)?.cause?.constraint]), String(o.reason)).toMatch(/23505|entity_self_user_id_unique/);
      expect(out.some((o) => o.status === 'fulfilled')).toBe(true);
      expect(people(u.id)).toBe(1);
      expect(owners(u.id)).toBe(1);
    }
  });

  it('a later load finds the existing Person (created: false) and writes nothing; the Person is named from the row, not read from public."user"  [red if: provisioning is not idempotent, or the name is ignored]', async () => {
    const u = e.seedUser({ name: 'Named Person' });
    const { res } = await e.signIn(u.email, auth);
    const h = handleOf(res)!;
    expect((await provision(h)).created).toBe(true);
    expect((await provision(h)).created).toBe(false);
    expect(people(u.id)).toBe(1);
    expect(must(`SELECT name FROM public.entity WHERE self_user_id = '${u.id}'`, e.db).rows[0]![0]).toBe('Named Person');
  });
});

// POLY-152 C9: every in-process handleAuthRequest suite runs as poly_auth. A trigger records who inserted the session row.
describe('POLY-152 handleAuthRequest runs as poly_auth, not poly_app', () => {
  it('a real /sign-in/email session INSERT is made by current_user poly_auth  [red if: the handler still uses the poly_app pool]', async () => {
    const { must: m } = await import('./helpers/sql');
    m(`CREATE TABLE IF NOT EXISTS public.qa_who152 (u text); CREATE OR REPLACE FUNCTION public.qa_who152_f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.qa_who152 VALUES (current_user); RETURN NEW; END $$; DROP TRIGGER IF EXISTS qa_who152_t ON public.session; CREATE TRIGGER qa_who152_t AFTER INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION public.qa_who152_f(); GRANT INSERT ON public.qa_who152 TO PUBLIC;`, e.db);
    const u = e.seedUser();
    await e.signIn(u.email);
    expect(m(`SELECT DISTINCT u FROM public.qa_who152`, e.db).rows).toEqual([['poly_auth']]);
  });
});
