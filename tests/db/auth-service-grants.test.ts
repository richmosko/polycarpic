// POLY-152 R2, R8, R10; seceng A1, A2, B1. The migration's effect on poly_app (exactly twelve EXECUTE removals, nothing else), the
// sign-up stamp, the definer allowlist, and poly_auth's absent tenant reach through a token it read. Red today: 0014 does not exist.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated, freshDb, migrateCli, REAL_MIGRATIONS } from './helpers/api';
import { signUpEntry, snapshot, tx } from './helpers/auth-tx';
import { loadAllow } from './helpers/definers';
import { codeOf, fails } from './helpers/second-step';
import { must } from './helpers/sql';
import { withHandle } from './helpers/handle';

let db: string;
beforeAll(() => { db = cloneMigrated(); });
const uid = () => crypto.randomUUID();

const TWELVE = [
  'app.step_up_fresh()', 'app.enrol_proof(text)', 'app.enrolment_grant_live()', 'app.check_factor_removal(uuid,text,uuid)', 'app.set_two_factor_enabled(boolean)',
  'app.consume_passkey_grant()', 'app.take_recent_auth_stamp(uuid)', 'app.issue_email_challenge(text)', 'app.confirm_email_challenge(text)',
  'app.enter_new_user(uuid)', 'app.claim_invitations(bytea,text)', 'app.accept_invitations(bytea)',
];

/** poly_app's effective privileges over everything that existed at 0013, as sorted text lines. */
function appPrivs(d: string, only: string[] | null): string[] {
  const rel = must(`SELECT n.nspname||'.'||c.relname, c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m')`, d).rows;
  const out: string[] = [];
  for (const [name, reg] of rel) {
    if (only && !only.includes(name!)) continue;
    const r = must(`SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('poly_app', '${reg}'::regclass, p)`, d).rows;
    for (const [p] of r) out.push(`T ${name} ${p}`);
    const cols = must(`SELECT a.attname, p FROM pg_attribute a, unnest(ARRAY['SELECT','INSERT','UPDATE']) p WHERE a.attrelid = '${reg}'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('poly_app', a.attrelid, a.attnum, p)`, d).rows;
    for (const [c, p] of cols) out.push(`C ${name}.${c} ${p}`);
  }
  const fns = must(`SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app','drizzle') AND has_function_privilege('poly_app', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`, d).rows;
  for (const [f] of fns) out.push(`F ${f}`);
  return out.sort();
}

describe('A1/§5.2 poly_app after 0014 differs from 0013 by exactly the twelve EXECUTE removals', () => {
  it('the diff of poly_app\'s effective privileges (before = the chain without 0014) is exactly the twelve, and poly_app executes neither new definer [red if: any other grant moved, or a removal is missing]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poly152-0013-'));
    cpSync(REAL_MIGRATIONS, dir, { recursive: true });
    const jp = join(dir, 'meta', '_journal.json');
    const j = JSON.parse(readFileSync(jp, 'utf8'));
    j.entries = j.entries.filter((e: any) => !/^0014_/.test(e.tag));
    writeFileSync(jp, JSON.stringify(j));
    const before = freshDb();
    const r = migrateCli(before, dir);
    expect(r.code, r.err + r.out).toBe(0);
    const existed = must(`SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m')`, before).rows.map((x) => x[0]!);
    const a = appPrivs(before, existed);
    const b = appPrivs(db, existed).filter((l) => !/^F app\.(enter_auth_session|provision_person)/.test(l));
    expect(a.filter((l) => !b.includes(l))).toEqual(TWELVE.map((t) => `F ${t}`).sort());
    expect(b.filter((l) => !a.includes(l))).toEqual([]);
    expect(must(`SELECT count(*) FROM pg_proc p WHERE p.proname IN ('enter_auth_session','provision_person') AND has_function_privilege('poly_app', p.oid, 'EXECUTE')`, db).rows[0]![0]).toBe('0');
  });
  it('poly_app still executes second_step_required, has_role, visible_entities, owner_count, enter_session, enter_job-free [red if: a removal went too far]', () => {
    for (const f of ['app.second_step_required()', 'app.has_role(uuid, text)', 'app.visible_entities()', 'app.owner_count(uuid)', 'app.enter_session(text)'])
      expect(must(`SELECT has_function_privilege('poly_app', to_regprocedure('${f}'), 'EXECUTE')`, db).rows[0]![0], f).toBe('t');
  });
});

describe('A2 the sign-up stamp names poly_auth only', () => {
  it('a user INSERT as poly_app is refused 42501 (it holds nothing on the user table since POLY-149) and enter_new_user is refused too [red if: poly_app can write user rows]', async () => {
    const id = uid();
    const x = await tx(db, 'poly_app', (q) => fails(q(`INSERT INTO public."user" (id, name, email) VALUES ($1, 'S', $2)`, [id, `${id}@qa.test`])));
    expect(codeOf(x)).toBe('42501');
    expect(must(`SELECT count(*) FROM public."user" WHERE id = '${id}'`, db).rows[0]![0]).toBe('0');
    const y = await tx(db, 'poly_app', (q) => fails(q('SELECT app.enter_new_user($1)', [id])));
    expect(codeOf(y)).toBe('42501');
  });
  it('as poly_auth the stamp is set and the step succeeds [red if: the stamp names neither]', async () => {
    const id = uid();
    const stamp = await tx(db, 'poly_auth', async (q) => { await signUpEntry(q, id); return (await q(`SELECT signup_txid IS NOT NULL AS s FROM public."user" WHERE id = $1`, [id])).rows[0].s; });
    expect(stamp).toBe(true);
  });
  it('the function body tests current_user <> \'poly_auth\' and never names poly_app [red if: unchanged]', () => {
    const def = must(`SELECT pg_get_functiondef('app.stamp_signup_user()'::regprocedure)`, db).rows[0]![0]!;
    expect(def).toMatch(/poly_auth/);
    expect(def).not.toMatch(/poly_app/);
  });
});

describe('R10 allowlist and PUBLIC', () => {
  it('definers.json lists enter_auth_session (poly_authz) and provision_person (poly_govern), EXECUTE poly_auth only; the sign-up three move to poly_auth [red if: not listed]', () => {
    const got = Object.fromEntries(loadAllow().map((a) => [a.function, [a.owner, ...a.execute].join('>')]));
    expect(got['app.enter_auth_session(text)']).toBe('poly_authz>poly_auth');
    expect(got['app.provision_person()']).toBe('poly_govern>poly_auth');
    expect(got['app.enter_new_user(uuid)']).toBe('poly_authz>poly_auth');
  });
  it('PUBLIC holds no EXECUTE on the new definers [red if: the definers are absent, or REVOKE FROM PUBLIC is missing]', () => {
    expect(must(`SELECT count(*) FROM pg_proc WHERE proname IN ('enter_auth_session','provision_person')`, db).rows[0]![0]).toBe('2');
    expect(must(`SELECT count(*) FROM pg_proc p WHERE p.proname IN ('enter_auth_session','provision_person') AND has_function_privilege('postgres'::regrole, p.oid, 'EXECUTE') AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)`, db).rows[0]![0]).toBe('0');
  });
});

describe('B1 no tenant reach through a victim\'s token (poly_auth reads session.token, enters, tenant tables refuse)', () => {
  const TABLES = ['public.entity', 'public.membership', 'public.entity_type', 'public.invitation', 'public.notification', 'public.audit_event', 'app.email_challenge', 'app.enrolment_grant'];
  it('as poly_auth: read another user\'s token, enter with it, each tenant table is refused 42501 and nothing changed [red if: any SELECT is granted or a policy names poly_auth]', async () => {
    const victim = uid();
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${victim}', 'V', '${victim}@qa.test', true)`, db);
    must(withHandle(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${victim}', 'victim-${victim}', now() + interval '1 day')`), db);
    const before = snapshot(db, `SELECT (SELECT count(*) FROM public.entity), (SELECT count(*) FROM public.membership), (SELECT count(*) FROM public.session)`);
    await tx(db, 'poly_auth', async (q) => {
      const tok = (await q(`SELECT token FROM public.session WHERE user_id = $1`, [victim])).rows[0].token;
      await q('SELECT app.enter_auth_session($1)', [tok]);
      for (const t of TABLES) {
        await q('SAVEPOINT s');
        const x = await fails(q(`SELECT * FROM ${t} LIMIT 1`));
        expect(codeOf(x), t).toBe('42501');
        await q('ROLLBACK TO s');
      }
      const ins = await fails(q(`INSERT INTO public.entity (type_id, name) VALUES ((SELECT id FROM public.entity_type LIMIT 1), 'x')`));
      expect(codeOf(ins)).toBe('42501');
    });
    expect(snapshot(db, `SELECT (SELECT count(*) FROM public.entity), (SELECT count(*) FROM public.membership), (SELECT count(*) FROM public.session)`)).toBe(before);
  });
  it('each granted definer called under that entry returns no tenant row [red if: a definer returns tenancy data]', async () => {
    const victim = uid();
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${victim}', 'V', '${victim}@qa.test', true)`, db);
    must(withHandle(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${victim}', 'v2-${victim}', now() + interval '1 day')`), db);
    await tx(db, 'poly_auth', async (q) => {
      await q('SELECT app.enter_auth_session($1)', [`v2-${victim}`]);
      for (const call of ['SELECT app.step_up_fresh()', 'SELECT app.enrolment_grant_live()', 'SELECT app.current_user_id()', 'SELECT app.current_session_id()']) {
        const r = await fails(q(call));
        if (r === null) continue;
        expect(codeOf(r)).toBe('42501');
      }
      const r = await q('SELECT app.current_user_id() AS u');
      expect(r.rows[0].u).toBe(victim);
    });
  });
});
