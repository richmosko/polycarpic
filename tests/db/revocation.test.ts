// POLY-149c, ruling R1 (V): poly_app's reach into BetterAuth's tables is revoked and the asserted-user entry is gone. Behaviour here; the
// catalog (granted and effective, with plants) is pgTAP 11. Titles end [red if: <mutation>]. Red today: 0017 does not exist.
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { codeOf, fails, fixture, msgOf } from './helpers/second-step';
import { psql } from './helpers/pg';
import { must } from './helpers/sql';

let db: string; let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 1496); });
const asApp = <T>(fn: (q: any) => Promise<T>) => tx(db, 'poly_app', fn, false);

describe('poly_app holds nothing on BetterAuth\'s tables: refused with 42501 and nothing changes', () => {
  it('SELECT token FROM public.session: 42501 [red if: SELECT on session survives]', async () => {
    const x = await fails(asApp((q) => q('SELECT token FROM public.session')));
    expect(codeOf(x), msgOf(x)).toBe('42501');
  });
  it('INSERT into public.verification: 42501, no row [red if: INSERT on verification survives]', async () => {
    const n = () => must('SELECT count(*) FROM public.verification', db).rows[0]![0];
    const before = n();
    const x = await fails(asApp((q) => q(`INSERT INTO public.verification (identifier, value, expires_at) VALUES ('qa-149', 'x', now() + interval '1 hour')`)));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(n()).toBe(before);
  });
  it('UPDATE of public.two_factor: 42501, row unchanged [red if: UPDATE on two_factor survives]', async () => {
    const u = await f.user({ enrolled: true });
    const snap = () => JSON.stringify(must(`SELECT * FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows);
    const before = snap();
    const x = await fails(asApp((q) => q(`UPDATE public.two_factor SET failed_verification_count = 7 WHERE user_id = $1`, [u.id])));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(snap()).toBe(before);
  });
  it('every one of the six tables refuses a SELECT as poly_app, and the user table too [red if: any column grant survives, 0001 or 0005]', async () => {
    for (const t of ['"user"', 'session', 'account', 'verification', 'two_factor', 'passkey']) {
      const x = await fails(asApp((q) => q(`SELECT 1 FROM public.${t} LIMIT 1`)));
      expect(codeOf(x), `${t}: ${msgOf(x)}`).toBe('42501');
    }
  });
  it('poly_app cannot read app.email_challenge and its policy is gone (beyond the criterion, R1) [red if: the SELECT grant or email_challenge_own survives]', async () => {
    const x = await fails(asApp((q) => q('SELECT id FROM app.email_challenge LIMIT 1')));
    expect(codeOf(x), msgOf(x)).toBe('42501');
    expect(must(`SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'email_challenge' AND policyname = 'email_challenge_own'`, db).rows[0]![0]).toBe('0');
  });
});

describe('the asserted-user entry is gone', () => {
  it('app.enter_asserted_user does not exist (to_regprocedure is NULL) and no poly_app call reaches it [red if: the function is only revoked, so a later grant can bring it back]', async () => {
    expect(must(`SELECT to_regprocedure('app.enter_asserted_user(uuid, uuid)') IS NULL`, db).rows[0]![0]).toBe('t');
    expect(must(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'enter_asserted_user'`, db).rows[0]![0]).toBe('0');
    const x = await fails(asApp((q) => q('SELECT app.enter_asserted_user($1, $2)', ['00000000-0000-4000-8000-000000149001', '00000000-0000-4000-8000-000000149002'])));
    expect(codeOf(x), msgOf(x)).toBe('42883'); // undefined_function
  });
  it('a web marker is refused by the tx_identity CHECK as poly_authz; signup, auth, session and system:* are accepted [red if: the kind CHECK still lists web]', () => {
    const ins = (kind: string) => psql(`BEGIN; SET LOCAL ROLE poly_authz; INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), gen_random_uuid(), gen_random_uuid(), '${kind}'); ROLLBACK;`, db);
    const w = ins('web');
    expect(w.ok, 'a web marker must be refused').toBe(false);
    expect(w.sqlstate, w.err).toBe('23514');
    for (const k of ['signup', 'auth', 'session']) expect(ins(k).sqlstate, `${k}: ${ins(k).err}`).not.toBe('23514');
  });
  it('app.audit_membership() has no web branch [red if: the function body still names the web kind]', () => {
    expect(must(`SELECT pg_get_functiondef('app.audit_membership()'::regprocedure) ~ '''web'''`, db).rows[0]![0]).toBe('f');
  });
});
