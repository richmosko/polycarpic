// POLY-86 criteria 8, 9 (POLY-76 (b') re-run) and the schema half of S16a / ruling R8. Real Postgres, as poly_app.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, claim, teardown, type Env } from './helpers/auth';
import { must } from './helpers/sql';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
beforeAll(async () => { e = await boot(); claim.impl = async () => ({ accepted: true }); });
afterAll(() => teardown(e));

const MODELS = ['user', 'session', 'account', 'verification', 'twoFactor', 'passkey'] as const;
const TABLE: Record<(typeof MODELS)[number], string> = { user: 'user', session: 'session', account: 'account', verification: 'verification', twoFactor: 'two_factor', passkey: 'passkey' };

describe('criterion 8: the fields map', () => {
  it('authFields covers every installed model and each mapped column exists in the table, with no column unmapped  [red if: twoFactor or passkey is missing from authFields, or a column is hand-written wrong]', () => {
    const f = e.dba.authFields as Record<string, { fields: Record<string, string> }>;
    for (const m of MODELS) {
      expect(f[m], `authFields.${m}`).toBeDefined();
      const cols = must(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${TABLE[m]}' ORDER BY 1`, e.db).rows.map((r) => r[0]);
      expect(Object.values(f[m].fields).sort(), m).toEqual(cols);
    }
    // the additional fields are declared (input: false) and mapped
    expect(f.user.fields.secondStepAt).toBe('second_step_at');
    expect(f.session.fields.recentAuthAt).toBe('recent_auth_at');
  });

  it('BetterAuth, every plugin included, starts as poly_app against the migrated schema  [red if: a model reads a camelCase name the table does not have]', async () => {
    const a = await e.mk();
    expect(await a.$context).toBeTruthy();
    expect(must('SELECT current_user', e.db).rows[0][0]).toBeTruthy();
    const who = await e.dba.authPool().query('select current_user u');
    expect(who.rows[0].u).toBe('poly_app');
  });

  for (const m of MODELS)
    it(`dropping one ${m} entry from the map makes createAuth refuse to start  [red if: the startup check does not cover ${m}; a plugin ignores the map]`, async () => {
      const fields = (e.dba.authFields as any)[m].fields as Record<string, string>;
      const key = Object.keys(fields).find((k) => k !== 'id' && fields[k] !== k) ?? Object.keys(fields).find((k) => k !== 'id')!;
      const saved = fields[key];
      delete fields[key];
      try { await expect(e.mk()).rejects.toThrow(); } finally { fields[key] = saved; }
      await expect(e.mk()).resolves.toBeTruthy(); // restored: starts again
    });
});

describe('criterion 9: timestamptz and the three core calls as poly_app', () => {
  it('every BetterAuth timestamp column is timestamptz  [red if: a column in 0004 or the core four is plain timestamp]', () => {
    const rows = must(`SELECT table_name || '.' || column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('user','session','account','verification','two_factor','passkey') AND data_type LIKE 'timestamp%'`, e.db).rows;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r[1] !== 'timestamp with time zone')).toEqual([]);
  });

  it('signUpEmail (inside withContextFreeTx), signInEmail and getSession succeed as poly_app  [red if: a timestamp or id type mismatch between BetterAuth and the schema]', async () => {
    const auth = await e.mk();
    const email = `core-${Date.now()}@qa.test`;
    const su = await e.dba.withContextFreeTx(() => auth.api.signUpEmail({ body: { email, password: PW, name: 'Core', invitationToken: 'qa' } }));
    expect(su.user.email).toBe(email);
    const si = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true });
    const cookie = si.headers.getSetCookie().map((c: string) => c.split(';')[0]).join('; ');
    const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(s?.user.email).toBe(email);
    expect(Object.values(s.session).some((v) => v instanceof Date)).toBe(true);
  });
});

describe('S16a: the app role cannot write second_step_at or recent_auth_at', () => {
  const wrote = async (run: () => Promise<unknown>) => run().then(() => 'ok', (x: any) => (x?.code === '42501' || /permission denied/i.test(String(x?.message)) ? 'denied' : `error:${x?.message}`));

  it('UPDATE of either column is denied to poly_app  [red if: the table-level UPDATE grant covers the column]', async () => {
    const u = e.seedUser();
    const { cookie } = await e.signIn(u.email, await e.mk());
    void cookie;
    const sid = must(`SELECT id FROM public.session WHERE user_id = '${u.id}'`, e.db).rows[0][0];
    const r1 = await wrote(() => e.dbm.withTenant(e.dbs.sessionUserId(u.id), sid, (tx: any) => e.dba.clientOf(tx).query(`UPDATE public."user" SET second_step_at = now() WHERE id = '${u.id}'`)));
    const r2 = await wrote(() => e.dbm.withTenant(e.dbs.sessionUserId(u.id), sid, (tx: any) => e.dba.clientOf(tx).query(`UPDATE public.session SET recent_auth_at = now() WHERE id = '${sid}'`)));
    expect([r1, r2]).toEqual(['denied', 'denied']);
    expect(must(`SELECT second_step_at IS NULL FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0][0]).toBe('t');
  });

  it('INSERT that sets either column is refused or lands null  [red if: neither a column grant nor a BEFORE INSERT trigger covers INSERT (a table-level INSERT grant covers every column)]', async () => {
    const email = `ins-${Date.now()}@qa.test`;
    await wrote(() => e.dba.withContextFreeTx((tx: any) => e.dba.clientOf(tx).query(`INSERT INTO public."user" (name, email, second_step_at) VALUES ('I', '${email}', now())`)));
    expect(must(`SELECT coalesce(bool_and(second_step_at IS NULL), true) FROM public."user" WHERE email = '${email}'`, e.db).rows[0][0]).toBe('t');
    const u = e.seedUser();
    const probe = `probe-${Date.now()}`;
    await wrote(() => e.dbm.withTenant(e.dbs.sessionUserId(u.id), '33333333-3333-4333-8333-333333333333', (tx: any) =>
      e.dba.clientOf(tx).query(`INSERT INTO public.session (user_id, token, expires_at, created_at, updated_at, recent_auth_at) VALUES ('${u.id}', '${probe}', now() + interval '1 day', now(), now(), now())`)));
    expect(must(`SELECT coalesce(bool_and(recent_auth_at IS NULL), true) FROM public.session WHERE token = '${probe}'`, e.db).rows[0][0]).toBe('t');
  });
});
