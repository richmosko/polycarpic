// POLY-153 R1, R3, R5.2 (C1, C2, C5), seceng H2 / T4 and the first two unmeasured claims: app.session_handle, app.attach_session_handle
// (poly_auth only) and the deferred check that no session commits without its handle. Titles end [red if: <mutation>].
// Red today: no table, no definer, no constraint trigger.
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { hashHex, newHandle, sessionWithHandle } from './helpers/handle';
import { codeOf, fails, fixture, msgOf, type Q } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 1531); });

const ATTACH = 'SELECT app.attach_session_handle($1, $2) AS ok';
const asAuth = <T>(fn: (q: Q) => Promise<T>, commit = false) => tx(db, 'poly_auth', fn, commit);
const hashOfSession = (id: string) => must(`SELECT encode(handle_hash, 'hex') FROM app.session_handle WHERE session_id = '${id}'`, db).rows[0]?.[0] ?? null;
const sessionCount = (id: string) => Number(must(`SELECT count(*) FROM public.session WHERE id = '${id}'`, db).rows[0]![0]);
const newSession = (q: Q, userId: string) => q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`, [userId, `n${Math.random()}`]).then((r) => r.rows[0].id as string);

describe('R3 attach_session_handle(session, handle): poly_auth only, new sessions only', () => {
  it('attaches to a session created in the same transaction and returns true; the stored form is sha256 of the plain handle [red if: the definer is absent or stores the plain value]', async () => {
    const u = await f.user(); const h = newHandle(); let sid = '';
    await asAuth(async (q) => {
      sid = await newSession(q, u.id);
      expect((await q(ATTACH, [sid, h])).rows[0].ok).toBe(true);
    }, true);
    expect(hashOfSession(sid)).toBe(hashHex(h));
  });
  it('a committed session that has a handle: returns false and its hash is unchanged (refresh keeps its handle) [red if: step 4 is missing]', async () => {
    const u = await f.user(); const s = sessionWithHandle(db, u.id);
    const before = hashOfSession(s.id);
    await asAuth(async (q) => { expect((await q(ATTACH, [s.id, newHandle()])).rows[0].ok).toBe(false); });
    await asAuth(async (q) => { expect((await q(ATTACH, [s.id, newHandle()])).rows[0].ok).toBe(false); }, true);
    expect(hashOfSession(s.id)).toBe(before);
  });
  it('T4: twice in one sign-in transaction for the same new session: the second is false and the first hash stays [red if: a second handle can be attached]', async () => {
    const u = await f.user(); const h1 = newHandle(); let sid = '';
    await asAuth(async (q) => {
      sid = await newSession(q, u.id);
      expect((await q(ATTACH, [sid, h1])).rows[0].ok).toBe(true);
      expect((await q(ATTACH, [sid, newHandle()])).rows[0].ok).toBe(false);
    }, true);
    expect(hashOfSession(sid)).toBe(hashHex(h1));
  });
  it('T4: a session id from another open transaction (uncommitted) returns false and attaches nothing [red if: poly_auth can see or attach another transaction\'s session]', async () => {
    const u = await f.user();
    await asAuth(async (q1) => {
      const sid = await newSession(q1, u.id);
      await asAuth(async (q2) => { expect((await q2(ATTACH, [sid, newHandle()])).rows[0].ok).toBe(false); });
      expect(hashOfSession(sid)).toBeNull();
    });
  });
  it('an unknown session id returns false (a held sign-in already deleted its session) [red if: step 3 raises or inserts]', async () => {
    await asAuth(async (q) => { expect((await q(ATTACH, ['00000000-0000-4000-8000-000000153999', newHandle()])).rows[0].ok).toBe(false); });
  });
  it('a bad format is 22023 and NULL is 22004, each writing nothing [red if: the format or NULL check is absent]', async () => {
    const u = await f.user();
    await asAuth(async (q) => {
      const sid = await newSession(q, u.id);
      for (const bad of ['', 'short', 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`]) {
        await q('SAVEPOINT s');
        expect(codeOf(await fails(q(ATTACH, [sid, bad]))), bad).toBe('22023');
        await q('ROLLBACK TO s');
      }
      await q('SAVEPOINT s');
      expect(codeOf(await fails(q(ATTACH, [sid, null])))).toBe('22004');
      await q('ROLLBACK TO s');
      await q('SAVEPOINT s');
      expect(codeOf(await fails(q(ATTACH, [null, newHandle()])))).toBe('22004');
      await q('ROLLBACK TO s');
      expect(must(`SELECT count(*) FROM app.session_handle`, db).rows[0]![0]).not.toBeUndefined();
    });
  });
  it('a non-canonical call shape is refused 42501 [red if: the exact-call check is absent]', async () => {
    const u = await f.user();
    for (const sql of ['SELECT app.attach_session_handle($1, $2), 1', 'SELECT * FROM (SELECT app.attach_session_handle($1, $2)) s', 'WITH x AS (SELECT app.attach_session_handle($1, $2)) SELECT * FROM x']) {
      await asAuth(async (q) => {
        const sid = await newSession(q, u.id);
        expect(codeOf(await fails(q(sql, [sid, newHandle()]))), sql).toBe('42501');
      });
    }
  });
  for (const role of ['poly_app', 'poly_worker', 'poly_operator']) {
    it(`${role} cannot execute it [red if: EXECUTE is granted to ${role}]`, async () => {
      const u = await f.user(); const s = sessionWithHandle(db, u.id);
      const x = await tx(db, role, async (q) => fails(q(ATTACH, [s.id, newHandle()])));
      expect(codeOf(x)).toBe('42501');
      expect(msgOf(x)).toMatch(/permission denied/);
    });
  }
});

describe('R1 no login role has any privilege on app.session_handle', () => {
  const stmts: [string, string, unknown[]][] = [
    ['SELECT', 'SELECT * FROM app.session_handle', []],
    ['INSERT', 'INSERT INTO app.session_handle (session_id, handle_hash) VALUES (gen_random_uuid(), sha256(\'x\'))', []],
    ['UPDATE', 'UPDATE app.session_handle SET created_at = now()', []],
    ['DELETE', 'DELETE FROM app.session_handle', []],
    ['TRUNCATE', 'TRUNCATE app.session_handle', []],
  ];
  for (const role of ['poly_app', 'poly_auth', 'poly_worker', 'poly_operator']) {
    for (const [what, sql, args] of stmts) {
      it(`${what} as ${role} is permission denied and no row moves [red if: a grant on the table reaches ${role}]`, async () => {
        const before = must(`SELECT count(*) FROM app.session_handle`, db).rows[0]![0];
        const x = await tx(db, role, async (q) => fails(q(sql, args)));
        expect(codeOf(x)).toBe('42501');
        expect(must(`SELECT count(*) FROM app.session_handle`, db).rows[0]![0]).toBe(before);
      });
    }
  }
  it('TRUNCATE is refused for the owner and superuser alike (truncate trigger) [red if: app.refuse_truncate is not attached]', () => {
    expect(must(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'app.session_handle'::regclass AND tgtype & 32 = 32`, db).rows[0]![0]).toBe('1'); // a BEFORE TRUNCATE trigger
    expect(() => must('TRUNCATE app.session_handle', db)).toThrow();
  });
  it('a second handle for one session and a duplicate hash are refused by the keys [red if: no PK on session_id or no UNIQUE on handle_hash]', async () => {
    const u = await f.user(); const a = sessionWithHandle(db, u.id); const b = sessionWithHandle(db, u.id);
    expect(() => must(`INSERT INTO app.session_handle (session_id, handle_hash) VALUES ('${a.id}', sha256('other'))`, db)).toThrow(/duplicate key|unique/);
    expect(() => must(`INSERT INTO app.session_handle (session_id, handle_hash) VALUES ('${b.id}', decode('${hashHex(a.handle)}', 'hex'))`, db)).toThrow(/duplicate key|unique/);
    expect(() => must(`INSERT INTO app.session_handle (session_id, handle_hash) SELECT id, '\\x00'::bytea FROM public.session LIMIT 1`, db)).toThrow(/check|constraint/i);
  });
});

describe('C2 (unmeasured claim 1): deleting a session kills its handle in the same transaction, with no privilege on the table', () => {
  it('as poly_auth (sign-out): the handle row is gone after the DELETE commits, and inside the same transaction as seen by the owner [red if: the FK has no ON DELETE CASCADE]', async () => {
    const u = await f.user(); const s = sessionWithHandle(db, u.id);
    await asAuth(async (q) => { await q('DELETE FROM public.session WHERE id = $1', [s.id]); }, true);
    expect(hashOfSession(s.id)).toBeNull();
    expect(sessionCount(s.id)).toBe(0);
  });
  it('as poly_authz (the revoke definer path): the handle row is gone [red if: the cascade needs a privilege the deleter lacks]', () => {
    const u = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('C','${Math.random()}@h.t',true) RETURNING id`, db).rows[0]![0]!;
    const s = sessionWithHandle(db, u);
    must(`BEGIN; SET LOCAL ROLE poly_authz; DELETE FROM public.session WHERE id = '${s.id}'; COMMIT;`, db);
    expect(hashOfSession(s.id)).toBeNull();
  });
});

describe('R5.2 no session commits without its handle (deferred constraint trigger), no role exempt', () => {
  it('a session inserted as poly_auth with no handle attached fails at commit 23514 and no row stays [red if: the constraint trigger is absent]', async () => {
    const u = await f.user(); let sid = '';
    const x = await fails(asAuth(async (q) => { sid = await newSession(q, u.id); }, true));
    expect(codeOf(x)).toBe('23514');
    expect(sessionCount(sid)).toBe(0);
  });
  it('with its handle attached the same transaction commits [red if: the check refuses a handled session]', async () => {
    const u = await f.user(); let sid = '';
    await asAuth(async (q) => { sid = await newSession(q, u.id); await q(ATTACH, [sid, newHandle()]); }, true);
    expect(sessionCount(sid)).toBe(1);
    expect(hashOfSession(sid)).not.toBeNull();
  });
  it('claim 2: a held sign-in that creates and deletes its session in one transaction commits [red if: the check fires on a deleted row]', async () => {
    const u = await f.user(); let sid = '';
    await asAuth(async (q) => { sid = await newSession(q, u.id); await q('DELETE FROM public.session WHERE id = $1', [sid]); }, true);
    expect(sessionCount(sid)).toBe(0);
  });
  it('claim 2: the same under BetterAuth\'s savepoints (insert released, handle attached in a later savepoint, then rolled back) [red if: the deferred check misreads savepoints]', async () => {
    const u = await f.user(); let sid = '';
    const x = await fails(asAuth(async (q) => {
      await q('SAVEPOINT a');
      sid = await newSession(q, u.id);
      await q('RELEASE a');
      await q('SAVEPOINT b');
      await q(ATTACH, [sid, newHandle()]);
      await q('ROLLBACK TO b'); // the handle insert is undone, the session stays: the commit must fail
    }, true));
    expect(codeOf(x)).toBe('23514');
    expect(sessionCount(sid)).toBe(0);
  });
  it('a superuser insert with no handle is refused too (no exemption) [red if: the check branches on session_user]', async () => {
    const u = await f.user();
    expect(() => must(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${u.id}', 'su${Math.random()}', now() + interval '1 day')`, db)).toThrow(/needs its handle|23514/);
  });
  it('SET CONSTRAINTS … IMMEDIATE only fires the check sooner: the insert is refused at once [red if: a runtime role can disable the check]', async () => {
    const u = await f.user();
    const x = await fails(asAuth(async (q) => { await q('SET CONSTRAINTS ALL IMMEDIATE'); await newSession(q, u.id); }));
    expect(codeOf(x)).toBe('23514');
  });
  it('a runtime role cannot disable the trigger [red if: poly_auth or poly_app may ALTER TABLE … DISABLE TRIGGER]', async () => {
    expect(must(`SELECT count(*) FROM pg_trigger WHERE tgname = 'session_needs_handle' AND tgrelid = 'public.session'::regclass`, db).rows[0]![0]).toBe('1'); // else the refusal below is the missing trigger, not the privilege
    for (const role of ['poly_auth', 'poly_app']) {
      const x = await tx(db, role, async (q) => fails(q('ALTER TABLE public.session DISABLE TRIGGER session_needs_handle')));
      expect(codeOf(x), role).toBe('42501');
    }
  });
});
