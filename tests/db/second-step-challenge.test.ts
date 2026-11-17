// POLY-89c (ruling 6eed53f8 R2, R3 #1 #3 #5 #8, C-b): the emailed code, the enrolment grant, and first enrolment in SQL. Written
// against the ruled names: app.issue_email_challenge(text) RETURNS text, app.confirm_email_challenge(text) RETURNS boolean,
// app.enrolment_grant_live(), app.set_two_factor_enabled(boolean). Red today because they are absent. Titles end [red if: ...].
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { codeOf, fixture, fails, msgOf } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 893); });

// POLY-152 R8: positive paths run as poly_auth; poly_app lost EXECUTE on the nine helpers (its refusals are in the last describe).
const AUTH = ['poly_auth'] as const;
const issue = (q: any) => q(`SELECT app.issue_email_challenge($1)`, ['first_enrolment']).then((r: any) => r.rows[0].issue_email_challenge as string | null);
const confirm = (q: any, code: string) => q(`SELECT app.confirm_email_challenge($1)`, [code]).then((r: any) => r.rows[0].confirm_email_challenge as boolean);
const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

describe('C8 the emailed code (R2)', () => {
  for (const role of AUTH) {
    it(`${role}: a code is six digits, stored as sha256(code || ':' || id), session-bound, expires in 10 minutes, and never readable by the role [red if: the issuer is absent, stores the code, or the hash is not salted by the row id]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const code = await f.committed(role, u.id, s, issue);
      expect(code).toMatch(/^\d{6}$/);
      const row = must(`SELECT id, encode(code_hash,'hex'), session_id, extract(epoch FROM expires_at - created_at)::int, used_at IS NULL FROM app.email_challenge WHERE user_id = '${u.id}'`, db).rows[0]!;
      expect(row[1]).toBe(createHash('sha256').update(`${code}:${row[0]}`).digest('hex'));
      expect(row[2]).toBe(s);
      expect(row[3]).toBe('600');
      expect(row[4]).toBe('t');
      const read = await f.marked(role, u.id, s, (q) => fails(q('SELECT code_hash FROM app.email_challenge')));
      expect(read).not.toBeNull();
    });
    it(`${role}: the issuer refuses a marker with no session (a user marker alone is not enough) [red if: issue_email_challenge works without a session in the marker]`, async () => {
      const u = await f.user();
      const x = await f.marked(role, u.id, null, async (q) => fails(q('SELECT app.issue_email_challenge($1)', ['first_enrolment'])));
      // enter_asserted_user with the default session id names no session row: the definer must refuse, not mint
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
    });
    it(`${role}: a right code confirms once; a second confirm of the same code is false (single use) [red if: used_at is not set or not checked]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      await f.marked(role, u.id, s, async (q) => {
        const code = (await issue(q))!;
        expect(await confirm(q, code)).toBe(true);
        expect(await confirm(q, code)).toBe(false);
      });
    });
    it(`${role}: a wrong code is false and counts an attempt; the 5th wrong entry voids the challenge, so the right code is then false [red if: attempts are not counted or never void]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      await f.marked(role, u.id, s, async (q) => {
        const code = (await issue(q))!;
        for (let i = 0; i < 5; i++) expect(await confirm(q, wrong(code))).toBe(false);
        expect(await confirm(q, code)).toBe(false);
      });
    });
    it(`${role}: a code does not confirm from another session of the same user (session-bound) [red if: the confirmer ignores app.current_session_id()]`, async () => {
      const u = await f.user();
      const s1 = f.session(u.id);
      const s2 = f.session(u.id);
      const code = await f.committed(role, u.id, s1, issue);
      const ok = await f.marked(role, u.id, s2, (q) => confirm(q, code!));
      expect(ok).toBe(false);
    });
    it(`${role}: an expired code (11 minutes) is false [red if: expires_at is not checked]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const code = await f.committed(role, u.id, s, issue);
      must(`UPDATE app.email_challenge SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE user_id = '${u.id}'`, db);
      expect(await f.marked(role, u.id, s, (q) => confirm(q, code!))).toBe(false);
    });
    it(`${role}: the 4th send in 15 minutes returns NULL (suppressed), and so do sends after 10 wrong entries in 24 hours [red if: a send limit is missing]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      await f.marked(role, u.id, s, async (q) => {
        for (let i = 0; i < 3; i++) expect(await issue(q)).toMatch(/^\d{6}$/);
        expect(await issue(q)).toBeNull();
      });
      const v = await f.user();
      const sv = f.session(v.id);
      for (let i = 0; i < 2; i++)
        must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, created_at, expires_at, attempts, used_at) VALUES ('${v.id}', '${sv}', 'first_enrolment', decode(repeat('00', 32), 'hex'), now() - interval '2 hours', now() - interval '110 minutes', 5, now() - interval '2 hours')`, db);
      expect(await f.marked(role, v.id, sv, issue)).toBeNull();
    });
    it(`${role}: a right code mints exactly one open grant for (user, marker session) and revokes the previous open grant; enrolment_grant_live() is true only for that session [red if: two grants stay open or the live check ignores the session]`, async () => {
      const u = await f.user();
      const s1 = f.session(u.id);
      const s2 = f.session(u.id);
      await f.committed(role, u.id, s1, async (q) => { expect(await confirm(q, (await issue(q))!)).toBe(true); });
      await f.committed(role, u.id, s2, async (q) => { expect(await confirm(q, (await issue(q))!)).toBe(true); });
      expect(f.one(`SELECT count(*) FROM app.enrolment_grant WHERE user_id = '${u.id}' AND consumed_at IS NULL AND revoked_at IS NULL`)).toBe('1');
      expect(await f.marked(role, u.id, s2, (q) => q('SELECT app.enrolment_grant_live() AS l').then((r) => r.rows[0].l))).toBe(true);
      expect(await f.marked(role, u.id, s1, (q) => q('SELECT app.enrolment_grant_live() AS l').then((r) => r.rows[0].l))).toBe(false);
    });
    it(`${role}: deleting the session sets enrolment_grant.session_id NULL and removes its challenges [red if: the FK actions differ from ON DELETE SET NULL / CASCADE]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      await f.committed(role, u.id, s, async (q) => { await confirm(q, (await issue(q))!); });
      must(`DELETE FROM public.session WHERE id = '${s}'`, db);
      expect(f.one(`SELECT count(*) FROM app.enrolment_grant WHERE user_id = '${u.id}' AND session_id IS NULL`)).toBe('1');
      expect(f.one(`SELECT count(*) FROM app.email_challenge WHERE user_id = '${u.id}'`)).toBe('0');
    });
  }
});

describe('C3/C15 first enrolment in SQL, in BetterAuth\'s measured order (R3 #1 #3 #5 #8 #9)', () => {
  /** The measured first-TOTP-verify order in one marked transaction: unverified factor row, flip, session INSERT (copy), old DELETE, verified last. */
  async function enrolTotp(role: (typeof AUTH)[number], u: { id: string }, s: string, opts: { confirmCode?: boolean } = {}) {
    return f.committed(role, u.id, s, async (q) => {
      if (opts.confirmCode !== false) expect(await confirm(q, (await issue(q))!)).toBe(true);
      await q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('sec', 'bk', $1, false)`, [u.id]);
      await q('SELECT app.set_two_factor_enabled($1)', [true]);
      const copy = await q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id, recent_auth_at`, [u.id, `rot${Math.random()}`]);
      await q('DELETE FROM public.session WHERE id = $1', [s]);
      await q(`UPDATE public.two_factor SET verified = true WHERE user_id = $1`, [u.id]);
      return copy.rows[0];
    });
  }
  for (const role of AUTH) {
    it(`${role}: with a confirmed emailed code the factor activates: flag on, verified, second_step_at set, the rotated session is stamped (recent_auth_at not null), the grant records consumed_xid and consumed_by totp [red if: any guard in R3 #1/#3/#5/#8 is absent]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const copy = await enrolTotp(role, u, s);
      expect(copy.recent_auth_at).not.toBeNull();
      expect(f.one(`SELECT two_factor_enabled FROM public."user" WHERE id = '${u.id}'`)).toBe('t');
      expect(f.one(`SELECT second_step_at IS NOT NULL FROM public."user" WHERE id = '${u.id}'`)).toBe('t');
      expect(must(`SELECT consumed_by, consumed_xid IS NOT NULL, stamped_at IS NOT NULL FROM app.enrolment_grant WHERE user_id = '${u.id}'`, db).rows[0]).toEqual(['totp', 't', 't']);
    });
    it(`${role}: without a confirmed emailed code the factor does not become active: the unverified row, the flip and the verify are each refused [red if: a first factor can be enrolled on the password alone]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const x = await fails(enrolTotp(role, u, s, { confirmCode: false }));
      expect(x).not.toBeNull();
      expect(msgOf(x)).not.toMatch(/does not exist/);
      expect(f.one(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`)).toBe('0');
      expect(f.one(`SELECT two_factor_enabled FROM public."user" WHERE id = '${u.id}'`)).toBe('f');
    });
    it(`${role}: the stamp fires once: a second session INSERT in the same transaction is NULL (stamped_at set) [red if: stamp_recent_auth does not set stamped_at]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const second = await f.committed(role, u.id, s, async (q) => {
        expect(await confirm(q, (await issue(q))!)).toBe(true);
        await q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('sec', 'bk', $1, false)`, [u.id]);
        await q('SELECT app.set_two_factor_enabled($1)', [true]);
        await q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [u.id, `one${Math.random()}`]);
        const r = await q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING recent_auth_at`, [u.id, `two${Math.random()}`]);
        await q(`UPDATE public.two_factor SET verified = true WHERE user_id = $1`, [u.id]);
        return r.rows[0];
      });
      expect(second.recent_auth_at).toBeNull();
    });
    it(`${role}: a session INSERT in a transaction whose grant was consumed by a DIFFERENT transaction is not stamped [red if: stamp_recent_auth does not compare consumed_xid with pg_current_xact_id()]`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      await enrolTotp(role, u, s);
      const later = await f.committed(role, u.id, null, (q) => q(`INSERT INTO public.session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING recent_auth_at`, [u.id, `late${Math.random()}`]).then((r) => r.rows[0]));
      expect(later.recent_auth_at).toBeNull();
    });
    it(`${role}: the flag may turn off only in the transaction that deletes the last factor, after a fresh step-up; the grant row is not reusable for a second user [red if: set_two_factor_enabled(false) works alone or the grant crosses users]`, async () => {
      const a = await f.user();
      const b = await f.user();
      const sa = f.session(a.id);
      await enrolTotp(role, a, sa);
      const sb = f.session(b.id);
      const x = await f.marked(role, b.id, sb, async (q) => { await q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('sec','bk',$1,false)`, [b.id]).catch(() => {}); return fails(q('SELECT app.set_two_factor_enabled($1)', [true])); });
      expect(x).not.toBeNull();
      const alone = await f.marked(role, a.id, f.session(a.id, true), (q) => fails(q('SELECT app.set_two_factor_enabled($1)', [false]).then(() => q('COMMIT'))));
      expect(alone).not.toBeNull(); // the flag moved but the verified row still exists: the commit-time check refuses
    });
  }
});

describe('C2 an owner or manager invitation seats only at enrolment (R3 #8, #12; POLY-87 R1, R2)', () => {
  it('a claimed, unaccepted manager invitation seats nothing until the second step is set; enrolment then seats the membership and sets accepted_at [red if: seat_claimed_invitations is absent or sync_second_step does not call it on NULL -> set]', async () => {
    const owner = await f.user({ enrolled: true });
    await f.committed('poly_app', owner.id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_pass_through')`, [`inv${owner.id}`]));
    const ent = must(`SELECT id FROM public.entity WHERE name = 'inv${owner.id}'`, db).rows[0]![0]!;
    const u = await f.user();
    must(`INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at, claimed_user_id, claimed_at) VALUES ('${ent}', '${u.email}', 'manager', '${owner.id}', decode(repeat('af', 32), 'hex'), now() + interval '1 day', '${u.id}', now())`, db);
    expect(f.one(`SELECT count(*) FROM public.membership WHERE entity_id = '${ent}' AND user_id = '${u.id}'`)).toBe('0');
    const s = f.session(u.id);
    await f.committed('poly_auth', u.id, s, async (q) => {
      expect((await q(`SELECT app.confirm_email_challenge($1)`, [(await q(`SELECT app.issue_email_challenge($1)`, ['first_enrolment'])).rows[0].issue_email_challenge])).rows[0].confirm_email_challenge).toBe(true);
      await q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('sec', 'bk', $1, false)`, [u.id]);
      await q('SELECT app.set_two_factor_enabled($1)', [true]);
      await q(`UPDATE public.two_factor SET verified = true WHERE user_id = $1`, [u.id]);
    });
    expect(f.one(`SELECT role FROM public.membership WHERE entity_id = '${ent}' AND user_id = '${u.id}'`)).toBe('manager');
    expect(f.one(`SELECT accepted_at IS NOT NULL FROM public.invitation WHERE entity_id = '${ent}' AND claimed_user_id = '${u.id}'`)).toBe('t');
  });
});

describe('C-b the race on the exemption (two connections)', () => {
  it('race 2: a last-factor delete racing the creation of a non-Person entity: exactly one commits [red if: refuse_last_method and require_second_step_for_role do not serialise on the user row]', async () => {
    const u = await f.user({ enrolled: true });
    const s = f.session(u.id, true);
    const open = async () => {
      const { pgmod } = await import('./helpers/second-step');
      const { url } = await import('./helpers/pg');
      const c = new pgmod.Client({ connectionString: url('poly_app', db) });
      await c.connect();
      const q = (t: string, v?: unknown[]) => c.query({ text: t, values: v, queryMode: 'extended' });
      await q('BEGIN');
      await q('SELECT app.enter_asserted_user($1, $2)', [u.id, s]);
      return { c, q };
    };
    const a = await open();
    const b = await open();
    const seen: string[] = [];
    try {
      const del = (async () => { await a.q('DELETE FROM public.two_factor WHERE user_id = $1', [u.id]); await a.q('SELECT app.set_two_factor_enabled($1)', [false]); })();
      await del.catch((x) => seen.push(`a:${msgOf(x)}`));
      const mk = b.q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'trust'), $1, 'trust_grantor')`, [`race2-${u.id}`]).catch((x: any) => { seen.push(`b:${msgOf(x)}`); });
      await Promise.race([mk, new Promise((r) => setTimeout(r, 1500))]);
      if (await fails(a.q('COMMIT'))) seen.push('a-commit');
      await mk;
      if (await fails(b.q('COMMIT'))) seen.push('b-commit');
    } finally { await a.c.end().catch(() => {}); await b.c.end().catch(() => {}); }
    expect(seen.join('|')).not.toMatch(/does not exist/);
    const factor = Number(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]);
    const ent = Number(must(`SELECT count(*) FROM public.entity WHERE name = 'race2-${u.id}'`, db).rows[0]![0]);
    expect(factor === 0 && ent === 0 ? 'a' : factor === 1 && ent === 1 ? 'b' : `both-or-neither:${factor}/${ent}`).toMatch(/^(a|b)$/);
  });
});

describe('POLY-152 R8: poly_app lost the nine POLY-89 helpers and cannot draw or confirm an emailed code [red if: poly_app still executes them]', () => {
  const HELPERS: [string, unknown[]][] = [
    ['app.issue_email_challenge($1)', ['first_enrolment']], ['app.confirm_email_challenge($1)', ['123456']], ['app.set_two_factor_enabled($1)', [true]],
    ['app.step_up_fresh()', []], ['app.enrol_proof($1)', ['x']], ['app.enrolment_grant_live()', []], ['app.consume_passkey_grant()', []],
  ];
  for (const [call, args] of HELPERS) {
    it(`poly_app: SELECT ${call} is refused 42501 and writes nothing`, async () => {
      const u = await f.user();
      const s = f.session(u.id);
      const snap = () => must(`SELECT (SELECT count(*) FROM app.email_challenge), (SELECT count(*) FROM app.enrolment_grant), (SELECT two_factor_enabled FROM public."user" WHERE id = '${u.id}')`, db).rows;
      const before = JSON.stringify(snap());
      const x = await f.marked('poly_app', u.id, s, (q) => fails(q(`SELECT ${call}`, args)));
      expect(codeOf(x)).toBe('42501');
      expect(JSON.stringify(snap())).toBe(before);
    });
  }
});
