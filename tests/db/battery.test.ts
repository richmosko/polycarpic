// POLY-84 (ruling R4): behavioural probes. They run as the real login role (poly_app) through the real wrappers,
// because a superuser bypasses RLS and proves nothing. The subjects are two permanent canary tables in a disposable
// database: qa_canary_open (no RLS, must leak) and qa_canary_rls (ENABLE + FORCE, per-command policies on
// app.current_user_id(), must not). Each test title names the acceptance criterion it proves.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from './helpers/api';
import { crossTenantRows } from './helpers/cross-tenant';
import { must } from './helpers/pg';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const SID = '22222222-2222-4222-8222-222222222222';
let db: string;
let m: any;
let auth: any;
let session: any;

const q = (tx: any, text: string, p?: unknown[]) => auth.clientOf(tx).query(text, p).then((r: any) => r.rows);
const tenant = (uid: string, fn: (tx: any) => Promise<any>) => m.withTenant(session.sessionUserId(uid), SID, fn);
const free = (fn: (tx: any) => Promise<any>) => auth.withContextFreeTx(fn);
const pid = async (tx: any) => (await q(tx, 'select pg_backend_pid() p'))[0].p as number;
const sqlstate = async (p: Promise<unknown>) => p.then(() => 'no error', (e: any) => e?.code ?? String(e));

beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  must(`
    CREATE TABLE public.qa_canary_open (id serial PRIMARY KEY, owner_user_id uuid NOT NULL);
    CREATE TABLE public.qa_canary_rls (id serial PRIMARY KEY, owner_user_id uuid NOT NULL);
    ALTER TABLE public.qa_canary_open OWNER TO poly_owner;
    ALTER TABLE public.qa_canary_rls OWNER TO poly_owner;
    ALTER TABLE public.qa_canary_rls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.qa_canary_rls FORCE ROW LEVEL SECURITY;
    CREATE POLICY s ON public.qa_canary_rls FOR SELECT USING (owner_user_id = app.current_user_id());
    CREATE POLICY i ON public.qa_canary_rls FOR INSERT WITH CHECK (owner_user_id = app.current_user_id());
    CREATE POLICY u ON public.qa_canary_rls FOR UPDATE USING (owner_user_id = app.current_user_id()) WITH CHECK (owner_user_id = app.current_user_id());
    -- qa_canary_wc isolates WITH CHECK: its SELECT policy admits every row, so only WITH CHECK can refuse a forged write
    CREATE TABLE public.qa_canary_wc (id serial PRIMARY KEY, owner_user_id uuid NOT NULL);
    ALTER TABLE public.qa_canary_wc OWNER TO poly_owner;
    ALTER TABLE public.qa_canary_wc ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.qa_canary_wc FORCE ROW LEVEL SECURITY;
    CREATE POLICY s ON public.qa_canary_wc FOR SELECT USING (true);
    CREATE POLICY i ON public.qa_canary_wc FOR INSERT WITH CHECK (owner_user_id = app.current_user_id());
    CREATE POLICY u ON public.qa_canary_wc FOR UPDATE USING (owner_user_id = app.current_user_id()) WITH CHECK (owner_user_id = app.current_user_id());
    GRANT SELECT, INSERT, UPDATE ON public.qa_canary_open, public.qa_canary_rls, public.qa_canary_wc TO poly_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO poly_app;
    INSERT INTO public.qa_canary_open (owner_user_id) VALUES ('${A}'), ('${B}');
    INSERT INTO public.qa_canary_rls (owner_user_id) VALUES ('${A}'), ('${B}');
    INSERT INTO public.qa_canary_wc (owner_user_id) VALUES ('${A}'), ('${B}');`, db);
  vi.resetModules();
  const m0 = await import('../../packages/db/src/index.ts');
  await m0.close();
  m0.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
  m = await import('../../packages/db/src/index.ts');
  auth = await import('../../packages/db/src/auth.ts');
  session = await import('../../packages/db/src/session.ts');
  // S-3: a one-connection pool, so every checkout is the same dirty backend (the pid assertions below stay as the second check)
  const pool = await import('../../packages/db/src/pool.ts');
  (pool.appPool() as any).options.max = 1;
});
afterAll(async () => { await m?.close?.(); await auth?.close?.(); });

describe('inversion self-test (criterion 1)', () => {
  it('an unprotected canary leaks tenant B to tenant A; the protected twin does not (the probe has teeth)', async () => {
    const open = await crossTenantRows(tenant, q, 'public.qa_canary_open', A, B);
    expect(open.otherRows, 'the unprotected canary MUST leak, or this harness cannot see a leak').toBe(1);
    const prot = await crossTenantRows(tenant, q, 'public.qa_canary_rls', A, B);
    expect(prot.otherRows).toBe(0);
    expect(prot.ownRows, 'positive control: A still reads its own row').toBe(1);
  });

  it('the canaries are what the catalog says they are: the leaker has no RLS, the twin is enabled and FORCEd', () => {
    const r = must(`SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) FROM pg_class WHERE relname IN ('qa_canary_open', 'qa_canary_rls') AND relkind = 'r' ORDER BY 1`, db).rows;
    expect(r).toEqual([['qa_canary_open', 'f', 'f', 'poly_owner'], ['qa_canary_rls', 't', 't', 'poly_owner']]);
  });
});

describe('pool reuse on a dirty backend (criterion 6, C-12)', () => {
  it('tenant A, then tenant B on the same physical connection: B sees zero A rows; a context-free query sees zero rows', async () => {
    const p1 = await tenant(A, async (tx) => ({ pid: await pid(tx), own: (await q(tx, 'select count(*)::int n from public.qa_canary_rls'))[0].n }));
    const p2 = await tenant(B, async (tx) => ({ pid: await pid(tx), a: (await q(tx, 'select count(*)::int n from public.qa_canary_rls where owner_user_id = $1', [A]))[0].n,
      all: (await q(tx, 'select count(*)::int n from public.qa_canary_rls'))[0].n }));
    const p3 = await free(async (tx) => ({ pid: await pid(tx), n: (await q(tx, 'select count(*)::int n from public.qa_canary_rls'))[0].n,
      ctx: (await q(tx, `select coalesce(current_setting('app.user_id', true), '<null>') c`))[0].c }));
    expect([p2.pid, p3.pid], 'precondition: one physical backend serves all three checkouts').toEqual([p1.pid, p1.pid]);
    expect(p1.own).toBe(1);
    expect(p2.a).toBe(0);
    expect(p2.all).toBe(1);
    expect(p3.n).toBe(0);
    expect(p3.ctx, 'a reused backend reads empty, not NULL (A-3); the nullif form handles it').toBe('');
  });

  it('the same holds when the previous tenant\'s transaction threw and rolled back', async () => {
    const first = await tenant(A, async (tx) => pid(tx));
    let thrown: number | undefined;
    await expect(tenant(A, async (tx) => { thrown = await pid(tx); await q(tx, 'select count(*) from public.qa_canary_rls'); throw new Error('boom'); })).rejects.toThrow('boom');
    const after = await tenant(B, async (tx) => ({ pid: await pid(tx), a: (await q(tx, 'select count(*)::int n from public.qa_canary_rls where owner_user_id = $1', [A]))[0].n }));
    const none = await free(async (tx) => ({ pid: await pid(tx), n: (await q(tx, 'select count(*)::int n from public.qa_canary_rls'))[0].n }));
    expect([thrown, after.pid, none.pid], 'precondition: same backend after a rollback').toEqual([first, first, first]);
    expect(after.a).toBe(0);
    expect(none.n).toBe(0);
  });

  it('a context-free query raises nothing and leaks nothing even on a table with a canary row for every tenant', async () => {
    await expect(free(async (tx) => (await q(tx, 'select * from public.qa_canary_rls')).length)).resolves.toBe(0);
  });
});

describe('WITH CHECK forgery (criterion 7)', () => {
  it('a row owned by another tenant is refused on INSERT and on UPDATE (42501); own rows pass; no context refuses a write', async () => {
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'insert into public.qa_canary_rls (owner_user_id) values ($1)', [B])))).toBe('42501');
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'update public.qa_canary_rls set owner_user_id = $1 where owner_user_id = $2', [B, A])))).toBe('42501');
    expect(await sqlstate(free((tx) => q(tx, 'insert into public.qa_canary_rls (owner_user_id) values ($1)', [A])))).toBe('42501');
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'insert into public.qa_canary_rls (owner_user_id) values ($1)', [A])))).toBe('no error');
    expect(await tenant(A, async (tx) => (await q(tx, 'update public.qa_canary_rls set owner_user_id = owner_user_id where owner_user_id = $1', [B])).length)).toBe(0);
  });

  it('WITH CHECK alone refuses the forgery on a table whose SELECT policy admits every row', async () => {
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'insert into public.qa_canary_wc (owner_user_id) values ($1)', [B])))).toBe('42501');
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'update public.qa_canary_wc set owner_user_id = $1 where owner_user_id = $2', [B, A])))).toBe('42501');
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'update public.qa_canary_wc set owner_user_id = owner_user_id where owner_user_id = $1', [A])))).toBe('no error');
  });

  it('the open canary accepts the same forgery, so the refusals above come from the policy', async () => {
    expect(await sqlstate(tenant(A, (tx) => q(tx, 'insert into public.qa_canary_open (owner_user_id) values ($1)', [B])))).toBe('no error');
  });
});
