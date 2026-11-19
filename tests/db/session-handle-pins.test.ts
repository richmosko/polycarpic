// POLY-153 R0, R6 (service side), R7.4, R11: the pins that are not behaviour of one definer. (1) what this loop must NOT change
// (poly_app keeps enter_asserted_user and its BetterAuth grants on the migrated chain; the revoke of R7.4 is the e2e harness's alone);
// (2) definers.json lists the six new functions; (3) the service-side step-up check is `app.step_up_fresh()` and fails closed outside a
// session transaction (the third unmeasured claim). Titles end [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { capture } from './helpers/auth-service';
import { sessionWithHandle } from './helpers/handle';
import { loadAllow } from './helpers/definers';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
beforeAll(async () => { e = await boot(); });
afterAll(() => teardown(e));

describe('R11 definers.json lists the six new functions with owner and EXECUTE', () => {
  const want: [string, string[]][] = [
    ['app.enter_session(p_handle text)', ['poly_app']], ['app.my_sessions()', ['poly_app']], ['app.revoke_my_session(p_id uuid)', ['poly_app']], ['app.recent_auth_ok()', ['poly_app']],
    ['app.attach_session_handle(p_session uuid, p_handle text)', ['poly_auth']], ['app.session_needs_handle()', []],
  ];
  for (const [sig, exec] of want) {
    it(`${sig}: owner poly_authz, EXECUTE ${JSON.stringify(exec)} [red if: the allowlist lacks it or lists another grantee]`, () => {
      const base = sig.slice(0, sig.indexOf('('));
      const hit = loadAllow().find((a) => a.function.startsWith(`${base}(`));
      expect(hit, `${base} on the allowlist`).toBeDefined();
      expect(hit!.owner).toBe('poly_authz');
      expect([...hit!.execute].sort()).toEqual(exec);
    });
  }
});

describe('R6 service side: requireRecentAuth is app.step_up_fresh() on the request transaction, and fails closed outside one (unmeasured claim 3)', () => {
  const u = () => e.seedUser();
  const inAuthSession = async <T>(token: string, fn: () => Promise<T>) => e.dba.withAuthSession(token, fn);
  const call = (sid: string) => e.A.requireRecentAuth(sid);
  const refusal = async (p: Promise<unknown>) => { try { await p; return null; } catch (x: any) { return x; } };

  it('a fresh stamp passes inside withAuthSession [red if: the check reads another column]', async () => {
    const user = u(); const s = sessionWithHandle(e.db, user.id, { fresh: true });
    await inAuthSession(s.token, async () => { await call(s.id); });
  });
  it('a stale stamp (301 s) and no stamp are refused with step_up_required [red if: the window is not the database\'s 300 s]', async () => {
    const user = u();
    for (const o of [{ recentSecondsAgo: 301 }, {}] as const) {
      const s = sessionWithHandle(e.db, user.id, o);
      const x = await inAuthSession(s.token, () => refusal(call(s.id)));
      expect(x, JSON.stringify(o)).not.toBeNull();
      expect(String(x?.message ?? x?.body?.message ?? x)).toMatch(/step_up_required/);
    }
  });
  it('the statement is `SELECT app.step_up_fresh()` and no SQL on public.session is sent [red if: the service still reads recent_auth_at itself]', async () => {
    const user = u(); const s = sessionWithHandle(e.db, user.id, { fresh: true });
    const { sql } = await capture(() => inAuthSession(s.token, async () => { await call(s.id); }));
    expect(sql.some((q) => /app\.step_up_fresh\(\)/.test(q)), sql.join(' | ')).toBe(true);
    expect(sql.filter((q) => /public\.session/.test(q) && /recent_auth_at/.test(q))).toEqual([]);
  });
  it('outside a session transaction the answer is refusal, even for a fresh stamp (fails closed) [red if: it falls back to a pool and reads the row]', async () => {
    const user = u(); const s = sessionWithHandle(e.db, user.id, { fresh: true });
    const x = await refusal(call(s.id));
    expect(x, 'no transaction of ours: must be refused').not.toBeNull();
  });
});

describe('R7.1 withSession(handle, fn) in packages/db (real, on the poly_app pool)', () => {
  const root = async () => (await import('../../packages/db/src/index.ts')) as any;
  it('is exported from the root of @poly/db with NoLiveSession, and not from @poly/db/session [red if: the wrapper is absent or hidden in the brand module]', async () => {
    const r = await root();
    expect(typeof r.withSession).toBe('function');
    expect(typeof r.NoLiveSession).toBe('function');
  });
  it('enters by ONE statement `SELECT * FROM app.enter_session($1)`, hands fn (tx, shell) for the live session, and the marker is kind session [red if: setup sends two statements, a hash, or another kind]', async () => {
    const r = await root();
    const user = e.seedUser(); const s = sessionWithHandle(e.db, user.id);
    const { result, sql } = await capture(() => r.withSession(s.handle, async (tx: any, shell: any) => {
      const kind = (await tx.execute(r.sql`SELECT kind FROM app.tx_identity WHERE xid = pg_current_xact_id()`)).rows[0].kind;
      return { kind, shell };
    }));
    expect(result.kind).toBe('session');
    expect(result.shell).toMatchObject({ userId: user.id, sessionId: s.id, name: 'QA User' });
    const entries = sql.filter((q) => /enter_session/.test(q));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.replace(/\s+/g, ' ').trim()).toMatch(/^SELECT \* FROM app\.enter_session\(\$1\);?$/);
    expect(sql.some((q) => /enter_asserted_user/.test(q))).toBe(false);
  });
  it('a handle that is not live throws NoLiveSession and never runs fn [red if: the 42501 escapes as a raw database error or fn runs unmarked]', async () => {
    const r = await root();
    let ran = false;
    const x = await r.withSession('A'.repeat(43), async () => { ran = true; }).then(() => null, (err: unknown) => err);
    expect(x).toBeInstanceOf(r.NoLiveSession);
    expect(ran).toBe(false);
  });
  it('a failure inside fn rolls the transaction back, the slide included [red if: the entry commits on its own]', async () => {
    const r = await root();
    const user = e.seedUser(); const s = sessionWithHandle(e.db, user.id, { expiresInDays: 1 });
    const before = must(`SELECT expires_at FROM public.session WHERE id = '${s.id}'`, e.db).rows[0]![0];
    await r.withSession(s.handle, async () => { throw new Error('qa: fn fails'); }).catch(() => {});
    expect(must(`SELECT expires_at FROM public.session WHERE id = '${s.id}'`, e.db).rows[0]![0]).toBe(before);
  });
});
