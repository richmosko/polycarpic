// POLY-150 Addendum 5 (RC5(c), required under D7 (b)): every second-step method added or removed is written to public.audit_event BY THE DATABASE
// (app.sync_second_step(), migration 0019), whichever role or path made the change. Through the real handler on poly_auth unless noted. Real Postgres.
// Titles end [red if: ...]. Red today: sync_second_step writes no audit row.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { enrolTotp } from './helpers/auth-service';
import { sessionWithHandle } from './helpers/handle';
import { url } from './helpers/pg';
import { fixture, pgmod, totp } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
let auth: any;
const mails: { email: string; code: string }[] = [];
beforeAll(async () => {
  e = await boot();
  fx = fixture(e.db, 152);
  auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
});
afterAll(() => teardown(e));

type Row = { kind: string; actor: string; actor_user_id: string | null; entity_id: string | null; subject: string | null; payload: any };
const rows = (uid: string, kindLike = 'second_step.method_%'): Row[] =>
  must(`SELECT kind, actor, coalesce(actor_user_id::text, ''), coalesce(entity_id::text, ''), coalesce(subject_user_id::text, ''), payload::text FROM public.audit_event WHERE subject_user_id = '${uid}' AND kind LIKE '${kindLike}' ORDER BY id`, e.db).rows
    .map((r) => ({ kind: r[0]!, actor: r[1]!, actor_user_id: r[2] || null, entity_id: r[3] || null, subject: r[4] || null, payload: JSON.parse(r[5]!) }));
const json = async (r: Response) => (await r.clone().json().catch(() => ({}))) as any;
const enrol = async () => { const u = e.seedUser(); const r = await enrolTotp(e, auth, u, mails); return { u, ...r }; };
async function registerPasskey(cookie: string, name = 'laptop') {
  const k = softAuthenticator();
  const g = await e.handle(get('/passkey/generate-register-options', cookie), auth);
  expect(g.status, 'register options').toBe(200);
  const ok = await e.handle(post('/passkey/verify-registration', { response: k.register(await json(g)), name }, jar(cookie, g)), auth);
  return { k, ok };
}
const passkeyId = (cred: string) => must(`SELECT id FROM public.passkey WHERE credential_id = '${cred}'`, e.db).rows[0]![0]!;

describe('each change writes exactly one row with the ruled fields', () => {
  it('the first TOTP verify: one method_added, method totp, subject and actor the user, no entity, the marker kind and session recorded, passkey_id null [red if: the trigger function writes no audit row]', async () => {
    const x = await enrol();
    const r = rows(x.u.id);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ kind: 'second_step.method_added', actor: 'user', actor_user_id: x.u.id, entity_id: null, subject: x.u.id });
    expect(r[0]!.payload).toMatchObject({ method: 'totp', passkey_id: null, marker_kind: 'auth' });
    expect(r[0]!.payload.session_id, 'the session that did it').toMatch(/^[0-9a-f-]{36}$/);
  });
  it('TOTP disable: one method_removed, method totp [red if: a delete leaves no row]', async () => {
    const x = await enrol();
    const d = await e.handle(post('/two-factor/disable', { password: PW }, x.cookie), auth);
    expect(d.status, JSON.stringify(await json(d))).toBe(200);
    const r = rows(x.u.id);
    expect(r.map((v) => v.kind)).toEqual(['second_step.method_added', 'second_step.method_removed']);
    expect(r[1]!.payload).toMatchObject({ method: 'totp', passkey_id: null });
  });
  it('passkey registration, then delete: one method_added and one method_removed, method passkey, passkey_id the row\'s id on both [red if: a passkey change leaves no row]', async () => {
    const x = await enrol();
    const { k, ok } = await registerPasskey(x.cookie);
    expect(ok.status, JSON.stringify(await json(ok))).toBe(200);
    const id = passkeyId(k.credentialId);
    const added = rows(x.u.id).filter((v) => v.payload.method === 'passkey');
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({ kind: 'second_step.method_added', actor_user_id: x.u.id });
    expect(added[0]!.payload.passkey_id).toBe(id);
    const del = await e.handle(post('/passkey/delete-passkey', { id }, x.cookie), auth);
    expect(del.status, JSON.stringify(await json(del))).toBe(200);
    const removed = rows(x.u.id).filter((v) => v.kind === 'second_step.method_removed' && v.payload.method === 'passkey');
    expect(removed.length).toBe(1);
    expect(removed[0]!.payload.passkey_id).toBe(id);
  });
  it('a later factor added after a re-check: one method_added carrying the re-checked session\'s id [red if: the later-factor path is not audited]', async () => {
    const x = await enrol();
    const stale = sessionWithHandle(e.db, x.u.id);
    const cookie = await e.cookieForToken(stale.token, auth);
    const b = await e.handle(post('/second-step/reauth/begin', { method: 'totp' }, cookie), auth);
    const id = (await json(b)).challengeId;
    const re = await e.handle(post('/second-step/reauth', { challengeId: id, password: PW, code: totp(x.secret, Date.now() + 30_000) }, cookie), auth);
    expect(re.status, JSON.stringify(await json(re))).toBe(200);
    const before = rows(x.u.id).length;
    const { ok } = await registerPasskey(cookie, 'after re-check');
    expect(ok.status, JSON.stringify(await json(ok))).toBe(200);
    const r = rows(x.u.id);
    expect(r.length).toBe(before + 1);
    expect(r.at(-1)!.payload).toMatchObject({ method: 'passkey', session_id: stale.id });
  });
});

describe('what is not a method, and what bypasses the routes', () => {
  it('an unverified two_factor row inserted then deleted writes no audit row [red if: an unverified factor is counted as a method]', () => {
    const u = e.seedUser();
    must(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${u.id}', false)`, e.db);
    must(`DELETE FROM public.two_factor WHERE user_id = '${u.id}'`, e.db);
    expect(rows(u.id)).toEqual([]);
  });
  it('H.1\'s path: a factor planted by SQL as poly_auth (a created session, a stamp, an INSERT into passkey) still writes method_added with actor_user_id the victim and marker_kind auth [red if: SQL that skips the routes can plant a factor unrecorded]', async () => {
    const victim = e.seedUser({ twoFactor: true });
    const s = sessionWithHandle(e.db, victim.id);
    must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.session SET recent_auth_at = now() WHERE id = '${s.id}'; COMMIT;`, e.db);
    const k = softAuthenticator();
    await fx.committed('poly_auth', victim.id, s.id, (q) => q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, victim.id, k.credentialId]));
    const r = rows(victim.id);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ kind: 'second_step.method_added', actor: 'user', actor_user_id: victim.id });
    expect(r[0]!.payload).toMatchObject({ method: 'passkey', marker_kind: 'auth', session_id: s.id });
  });
  it('a change with no marker (a superuser statement) is recorded with actor system and no actor user [red if: an unmarked change writes nothing]', () => {
    const u = e.seedUser();
    const k = softAuthenticator();
    must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', '${k.credentialId}', 0, 'singleDevice', false, 'internal')`, e.db);
    const r = rows(u.id);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ actor: 'system', actor_user_id: null, entity_id: null });
    expect(r[0]!.payload).toMatchObject({ method: 'passkey', session_id: null, marker_kind: null });
  });
  it('reset-mfa (poly_operator) writes one method_removed per method with actor operator, plus the existing second_step.reset [red if: the operator\'s removals are unrecorded or attributed to a user]', async () => {
    const x = await enrol();
    await registerPasskey(x.cookie, 'to be reset');
    const c = new pgmod.Client({ connectionString: url('poly_operator', e.db) });
    await c.connect();
    try { await c.query({ text: 'SELECT app.reset_second_step($1)', values: [x.u.email], queryMode: 'extended' }); } finally { await c.end(); }
    const removed = rows(x.u.id).filter((v) => v.kind === 'second_step.method_removed');
    expect(removed.map((v) => v.payload.method).sort()).toEqual(['passkey', 'totp']);
    for (const v of removed) expect(v).toMatchObject({ actor: 'operator', actor_user_id: null });
    expect(rows(x.u.id, 'second_step.reset').length, 'the existing reset event stays').toBe(1);
  });
});

describe('append-only, and who can read what', () => {
  it('as each login role, UPDATE and DELETE of such a row are refused and it reads back unchanged [red if: an audit row can be altered or removed by a login role]', async () => {
    const x = await enrol();
    const before = JSON.stringify(rows(x.u.id));
    expect(before).not.toBe('[]');
    for (const role of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator', 'poly_migrator'] as const) {
      const c = new pgmod.Client({ connectionString: url(role, e.db) });
      await c.connect();
      try {
        for (const sql of [`UPDATE public.audit_event SET kind = 'second_step.method_removed' WHERE subject_user_id = '${x.u.id}'`, `DELETE FROM public.audit_event WHERE subject_user_id = '${x.u.id}'`]) {
          const res = await c.query(sql).then((r: any) => ({ n: r.rowCount, err: null }), (er: any) => ({ n: 0, err: er.code }));
          expect(res.n, `${role}: ${sql.slice(0, 30)} changed ${res.n} rows`).toBe(0);
        }
      } finally { await c.end(); }
    }
    expect(JSON.stringify(rows(x.u.id))).toBe(before);
  });
  it('as poly_app with the user\'s marker, the user reads the rows they acted on and not another user\'s [red if: the audit rows are unreadable to their owner or readable across users]', async () => {
    const a = await enrol();
    const b = await enrol();
    const sa = sessionWithHandle(e.db, a.u.id);
    const read = await fx.marked('poly_app', a.u.id, sa.id, async (q) => (await q(`SELECT subject_user_id::text AS s, kind FROM public.audit_event WHERE kind LIKE 'second_step.method_%'`)).rows);
    expect(read.some((r: any) => r.s === a.u.id && r.kind === 'second_step.method_added'), 'own rows').toBe(true);
    expect(read.some((r: any) => r.s === b.u.id), 'not another user\'s').toBe(false);
  });
});
