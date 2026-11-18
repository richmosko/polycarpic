// POLY-153 R6 (C3), seceng H7 / T3: app.my_sessions(), app.recent_auth_ok(), app.revoke_my_session(uuid), all owned by poly_authz,
// EXECUTE poly_app only, each refusing 42501 unless the marker is of kind 'session'. Titles end [red if: <mutation>].
// Red today: the three definers do not exist.
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { ENTER_SESSION, sessionWithHandle } from './helpers/handle';
import { psql } from './helpers/pg';
import { codeOf, fails, fixture, msgOf, type Q } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 1532); });

const MY = 'SELECT * FROM app.my_sessions()';
const OK = 'SELECT app.recent_auth_ok() AS ok';
const REVOKE = 'SELECT app.revoke_my_session($1)';
const sess = (id: string) => must(`SELECT count(*) FROM public.session WHERE id = '${id}'`, db).rows[0]![0];
const snap = (userId: string) => JSON.stringify(must(`SELECT id, user_id, token, expires_at, recent_auth_at FROM public.session WHERE user_id = '${userId}' ORDER BY id`, db).rows);
/** A marked transaction as poly_app whose kind is `session` (the real entry). */
const asSession = <T>(handle: string, fn: (q: Q) => Promise<T>) => tx(db, 'poly_app', async (q) => { await q(ENTER_SESSION, [handle]); return fn(q); });

describe('my_sessions(): the marker user\'s sessions, six columns, no token and no handle', () => {
  it('returns exactly the user\'s rows with current flagged, and nobody else\'s [red if: the definer is absent or reads another user]', async () => {
    const u = await f.user(); const v = await f.user();
    const a = sessionWithHandle(db, u.id); const b = sessionWithHandle(db, u.id); const other = sessionWithHandle(db, v.id);
    const rows = await asSession(a.handle, async (q) => (await q(MY)).rows);
    expect(rows.map((r: any) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.find((r: any) => r.id === a.id).current).toBe(true);
    expect(rows.find((r: any) => r.id === b.id).current).toBe(false);
    expect(rows.some((r: any) => r.id === other.id)).toBe(false);
    expect(Object.keys(rows[0]).sort()).toEqual(['created_at', 'current', 'id', 'ip_address', 'updated_at', 'user_agent']);
    expect(JSON.stringify(rows)).not.toContain(a.token);
    expect(JSON.stringify(rows)).not.toContain(a.handle);
  });
});

describe('recent_auth_ok(): the marker session\'s recent_auth_at within 300 s of now, never in the future', () => {
  for (const [secs, want] of [[0, true], [299, true], [301, false], [-60, false]] as const) {
    it(`a stamp ${secs} s old answers ${want} [red if: the window or the future-stamp guard differs from step_up_fresh]`, async () => {
      const u = await f.user(); const s = sessionWithHandle(db, u.id, { recentSecondsAgo: secs });
      expect((await asSession(s.handle, async (q) => (await q(OK)).rows[0].ok))).toBe(want);
    });
  }
  it('no stamp at all answers false [red if: NULL is treated as fresh]', async () => {
    const u = await f.user(); const s = sessionWithHandle(db, u.id);
    expect((await asSession(s.handle, async (q) => (await q(OK)).rows[0].ok))).toBe(false);
  });
});

describe('revoke_my_session(id)', () => {
  it('the current session needs no fresh step-up and its handle goes with it [red if: revoking the current session demands step-up or leaves the handle]', async () => {
    const u = await f.user(); const s = sessionWithHandle(db, u.id);
    await tx(db, 'poly_app', async (q) => { await q(ENTER_SESSION, [s.handle]); await q(REVOKE, [s.id]); }, true);
    expect(sess(s.id)).toBe('0');
    expect(must(`SELECT count(*) FROM app.session_handle WHERE session_id = '${s.id}'`, db).rows[0]![0]).toBe('0');
  });
  it('another session without a fresh stamp is 42501 step_up_required and the row stays [red if: the step-up check is absent]', async () => {
    const u = await f.user(); const a = sessionWithHandle(db, u.id); const b = sessionWithHandle(db, u.id);
    const before = snap(u.id);
    const x = await asSession(a.handle, async (q) => fails(q(REVOKE, [b.id])));
    expect(codeOf(x)).toBe('42501');
    expect(msgOf(x)).toMatch(/step_up_required/);
    expect(snap(u.id)).toBe(before);
  });
  it('another session with a fresh stamp is deleted, handle included [red if: revoke by id is refused after step-up]', async () => {
    const u = await f.user(); const a = sessionWithHandle(db, u.id, { fresh: true }); const b = sessionWithHandle(db, u.id);
    await tx(db, 'poly_app', async (q) => { await q(ENTER_SESSION, [a.handle]); await q(REVOKE, [b.id]); }, true);
    expect(sess(b.id)).toBe('0');
    expect(sess(a.id)).toBe('1');
    expect(must(`SELECT count(*) FROM app.session_handle WHERE session_id = '${b.id}'`, db).rows[0]![0]).toBe('0');
  });
  it('a session of another user is P0002 and unchanged, fresh stamp or not [red if: the delete is not scoped to the marker user]', async () => {
    const u = await f.user(); const v = await f.user();
    const a = sessionWithHandle(db, u.id, { fresh: true }); const victim = sessionWithHandle(db, v.id, { fresh: true });
    const before = snap(v.id);
    const x = await asSession(a.handle, async (q) => fails(q(REVOKE, [victim.id])));
    expect(codeOf(x)).toBe('P0002');
    expect(snap(v.id)).toBe(before);
    expect(must(`SELECT count(*) FROM app.session_handle WHERE session_id = '${victim.id}'`, db).rows[0]![0]).toBe('1');
  });
  it('an unknown id is P0002 [red if: it returns silently]', async () => {
    const u = await f.user(); const a = sessionWithHandle(db, u.id, { fresh: true });
    const x = await asSession(a.handle, async (q) => fails(q(REVOKE, ['00000000-0000-4000-8000-000000153777'])));
    expect(codeOf(x)).toBe('P0002');
  });
});

describe('T3 / H7: the three definers refuse a kind web and a kind auth marker (the marker\'s session_id is proof only under kind session)', () => {
  const calls: [string, string, (sid: string) => unknown[]][] = [
    ['my_sessions', MY, () => []],
    ['recent_auth_ok', OK, () => []],
    ['revoke_my_session', REVOKE, (sid) => [sid]],
  ];
  for (const [name, sql, args] of calls) {
    it(`${name} under a kind web marker (enter_asserted_user as poly_app naming a victim's session) is refused 42501 and nothing changes [red if: the definer does not check kind = 'session']`, async () => {
      const u = await f.user(); const victim = sessionWithHandle(db, u.id, { fresh: true }); const other = sessionWithHandle(db, u.id);
      const before = snap(u.id);
      const x = await tx(db, 'poly_app', async (q) => { await q('SELECT app.enter_asserted_user($1, $2)', [u.id, victim.id]); return fails(q(sql, args(other.id))); });
      expect(x, 'must be refused').not.toBeNull();
      expect(codeOf(x)).toBe('42501');
      expect(msgOf(x)).not.toMatch(/permission denied for function/);
      expect(snap(u.id)).toBe(before);
    });
    it(`${name} under a kind auth marker (planted by a superuser as poly_app) is refused 42501 and nothing changes [red if: only kind web is refused]`, async () => {
      const u = await f.user(); const s = sessionWithHandle(db, u.id, { fresh: true }); const other = sessionWithHandle(db, u.id);
      const before = snap(u.id);
      const arg = args(other.id)[0] === undefined ? '' : `'${other.id}'`;
      const r = psql(`BEGIN; INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), '${u.id}', '${s.id}', 'auth'); SET LOCAL ROLE poly_app; ${sql.replace('$1', arg)}; ROLLBACK;`, db);
      expect(r.ok).toBe(false);
      expect(r.sqlstate).toBe('42501');
      expect(r.err).not.toMatch(/permission denied for function/);
      expect(snap(u.id)).toBe(before);
    });
    it(`${name} with no marker at all is refused 42501 [red if: the definer trusts an unmarked transaction]`, async () => {
      const x = await tx(db, 'poly_app', async (q) => fails(q(sql, args('00000000-0000-4000-8000-000000153778'))));
      expect(codeOf(x)).toBe('42501');
      expect(msgOf(x)).not.toMatch(/permission denied for function/);
    });
  }
  it('control: the same three calls pass under a kind session marker, so the refusals above are the kind check [red if: the definers never accept]', async () => {
    const u = await f.user(); const s = sessionWithHandle(db, u.id, { fresh: true });
    await asSession(s.handle, async (q) => { await q(MY); await q(OK); const x = await fails(q(REVOKE, ['00000000-0000-4000-8000-000000153779'])); expect(codeOf(x)).toBe('P0002'); });
  });
});

describe('who may call them', () => {
  for (const role of ['poly_auth', 'poly_worker', 'poly_operator']) {
    for (const [name, sql, arg] of [['my_sessions', MY, []], ['recent_auth_ok', OK, []], ['revoke_my_session', REVOKE, ['00000000-0000-4000-8000-000000153780']]] as const) {
      it(`${role} cannot execute ${name} (permission denied) [red if: EXECUTE is granted to ${role}]`, async () => {
        const x = await tx(db, role, async (q) => fails(q(sql, arg as unknown[])));
        expect(codeOf(x)).toBe('42501');
        expect(msgOf(x)).toMatch(/permission denied for function/);
      });
    }
  }
  it('the three are SECURITY DEFINER owned by poly_authz with search_path = \'\' [red if: owner or search_path differs]', () => {
    const rows = must(`SELECT p.proname, pg_get_userbyid(p.proowner), p.prosecdef, ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname IN ('my_sessions','recent_auth_ok','revoke_my_session') ORDER BY 1`, db).rows;
    expect(rows.map((r) => r[0])).toEqual(['my_sessions', 'recent_auth_ok', 'revoke_my_session']);
    for (const r of rows) { expect(r[1]).toBe('poly_authz'); expect(r[2]).toBe('t'); expect(r[3]).toBe('true'); }
  });
});
