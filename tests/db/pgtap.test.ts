// Runs every tests/db/pgtap/*.sql against a database migrated by the real runner with the real migrations,
// and fails on any "not ok" TAP line (psql prints TAP; no pg_prove needed).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { definerGaps, loadAllow } from './helpers/definers';
import { psql } from './helpers/pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'pgtap');
let db: string;

beforeAll(() => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, `migrate failed: ${r.err}${r.out}`).toBe(0);
  // pgTAP is installed by the superuser; tests then run as superuser to read the whole catalog
  expect(psql('CREATE EXTENSION IF NOT EXISTS pgtap', db).ok).toBe(true);
});

describe('definer allowlist (C-15): every SECURITY DEFINER function is in packages/db/sql/definers.json, and vice versa', () => {
  it('matches on function, owner, search_path, and every EXECUTE grantee (PUBLIC included)', () => {
    expect(definerGaps(db)).toEqual([]);
  });

  // POLY-84 canaries (ruling R7): each runs in a rolled-back transaction, so nothing outlives the test.
  const def = (name: string, owner = 'poly_authz', extra = '') =>
    `CREATE FUNCTION app.${name}() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;
     ALTER FUNCTION app.${name}() OWNER TO ${owner}; ${extra}`;
  it('canary: an unlisted definer is reported', () => {
    expect(definerGaps(db, loadAllow(), def('qa_canary_unlisted'))).toContain('app.qa_canary_unlisted(): not on the allowlist');
  });
  it('canary: a definer owned by poly_owner is reported', () => {
    expect(definerGaps(db, loadAllow(), def('qa_canary_owner', 'poly_owner')).join('\n')).toMatch(/qa_canary_owner\(\): owner poly_owner is not a definer-owner role/);
  });
  it('canary: a definer without search_path = \'\' is reported, including one set to something else', () => {
    const bad = `CREATE FUNCTION app.qa_canary_sp() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = 'app' AS $$ SELECT 1 $$;
      ALTER FUNCTION app.qa_canary_sp() OWNER TO poly_authz;`;
    expect(definerGaps(db, loadAllow(), bad)).toContain("app.qa_canary_sp(): search_path not pinned to ''");
  });
  it('canary: EXECUTE granted to PUBLIC, or to a stray role, is reported on a listed-shape definer', () => {
    const allow = [...loadAllow(), { function: 'app.qa_canary_pub()', owner: 'poly_authz', execute: [] }];
    const pub = def('qa_canary_pub', 'poly_authz', 'REVOKE EXECUTE ON FUNCTION app.qa_canary_pub() FROM PUBLIC; GRANT EXECUTE ON FUNCTION app.qa_canary_pub() TO PUBLIC;');
    expect(definerGaps(db, allow, pub)).toEqual(['app.qa_canary_pub(): EXECUTE held by [PUBLIC], allowlist says []']);
    const stray = def('qa_canary_pub', 'poly_authz', 'REVOKE EXECUTE ON FUNCTION app.qa_canary_pub() FROM PUBLIC; GRANT EXECUTE ON FUNCTION app.qa_canary_pub() TO poly_app;');
    expect(definerGaps(db, allow, stray)).toEqual(['app.qa_canary_pub(): EXECUTE held by [poly_app], allowlist says []']);
    expect(definerGaps(db, allow, def('qa_canary_pub', 'poly_authz', 'REVOKE EXECUTE ON FUNCTION app.qa_canary_pub() FROM PUBLIC;'))).toEqual([]);
  });
  it('canary: an allowlist entry the catalog lacks, or one naming poly_owner, is reported', () => {
    const allow = [...loadAllow(), { function: 'app.qa_ghost()', owner: 'poly_owner', execute: [] }];
    expect(definerGaps(db, allow)).toEqual(['app.qa_ghost(): on the allowlist, not in the catalog', 'app.qa_ghost(): allowlist names poly_owner, not a definer-owner role']);
  });
});

describe('pgTAP catalog invariants', () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    it(f, () => {
      const r = psql(readFileSync(join(dir, f), 'utf8'), db);
      expect(r.err, 'psql error').toBe('');
      const lines = r.out.split('\n');
      const bad = lines.filter((l) => /^not ok/.test(l) || /^# Looks like you failed/.test(l));
      expect(bad, lines.join('\n')).toEqual([]);
      expect(lines.filter((l) => /^ok /.test(l)).length).toBeGreaterThan(0);
    });
  }
});

// POLY-152 seceng #16: the poly_auth grant pin is shown to bite. Each plant is added inside 08's own transaction (rolled back with it),
// and the file must then report a `not ok`; the control without a plant reports none.
describe('POLY-152 08_poly_auth_grants.sql fails on a planted grant', () => {
  const body = readFileSync(join(dir, '08_poly_auth_grants.sql'), 'utf8');
  const run = (plant: string) => psql(body.replace('BEGIN;', () => `BEGIN;\n${plant};`), db).out.split('\n').filter((l) => /^not ok/.test(l));
  it('control: no plant, no failure', () => { expect(run('SELECT 1')).toEqual([]); });
  const plants: [string, string][] = [
    ['a table SELECT outside the allowed set', 'GRANT SELECT ON public.entity TO poly_auth'],
    ['a column SELECT on a table outside the allowed set', 'GRANT SELECT (name) ON public.entity TO poly_auth'],
    ['a SELECT through PUBLIC', 'GRANT SELECT ON public.entity TO PUBLIC'],
    ['an extra privilege on an allowed table', 'GRANT TRUNCATE ON public.account TO poly_auth'],
    ['UPDATE on session.recent_auth_at', 'GRANT UPDATE (recent_auth_at) ON public.session TO poly_auth'],
    ['EXECUTE on enter_asserted_user', 'GRANT EXECUTE ON FUNCTION app.enter_asserted_user(uuid, uuid) TO poly_auth'],
    ['a function with EXECUTE granted through PUBLIC', 'CREATE FUNCTION public.qa_plant152() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; GRANT EXECUTE ON FUNCTION public.qa_plant152() TO PUBLIC'],
    ['a sequence privilege', 'CREATE SEQUENCE public.qa_seq152; GRANT USAGE ON SEQUENCE public.qa_seq152 TO poly_auth'],
    // POLY-152 N2 (role membership in poly_app, plain and WITH INHERIT FALSE, SET TRUE): tests/db/pgtap-membership.test.ts, a SERIAL file
    // POLY-153
    ['a privilege on app.session_handle', 'GRANT SELECT ON app.session_handle TO poly_auth'],
    ['EXECUTE on enter_session', 'GRANT EXECUTE ON FUNCTION app.enter_session(text) TO poly_auth'],
    ['UPDATE (user_id) on session', 'GRANT UPDATE (user_id) ON public.session TO poly_auth'],
  ];
  for (const [name, plant] of plants) it(`${name}: reported`, () => { expect(run(plant).length, plant).toBeGreaterThan(0); });
});

// POLY-152 (architect 9f6dd25a, seceng §7): poly_govern's grants on user, entity and entity_type are pinned both ways; each plant must fail 09.
describe('POLY-152 09_poly_govern_grants.sql fails on a planted change', () => {
  const body = readFileSync(join(dir, '09_poly_govern_grants.sql'), 'utf8');
  const run = (plant: string) => psql(body.replace('BEGIN;', () => `BEGIN;\n${plant};`), db).out.split('\n').filter((l) => /^not ok/.test(l));
  it('control: no plant, no failure', () => { expect(run('SELECT 1')).toEqual([]); });
  const plants: [string, string][] = [
    ['an extra column SELECT on user (image)', 'GRANT SELECT (image) ON public."user" TO poly_govern'],
    ['an extra column UPDATE on user (email)', 'GRANT UPDATE (email) ON public."user" TO poly_govern'],
    ['a column SELECT through PUBLIC on user', 'GRANT SELECT (image) ON public."user" TO PUBLIC'],
    ['a missing grant: SELECT (name) on user revoked', 'REVOKE SELECT (name) ON public."user" FROM poly_govern'],
    ['an extra column on entity', 'GRANT SELECT (name) ON public.entity TO poly_govern'],
    ['a table-level DELETE on entity', 'GRANT DELETE ON public.entity TO poly_govern'],
    ['an extra column on entity_type', 'GRANT SELECT (name) ON public.entity_type TO poly_govern'],
    ['an extra policy for poly_govern on entity', 'CREATE POLICY qa_plant152 ON public.entity FOR SELECT TO poly_govern USING (true)'],
  ];
  for (const [name, plant] of plants) it(`${name}: reported`, () => { expect(run(plant).length, plant).toBeGreaterThan(0); });
});

// POLY-153 (seceng §2.2 / T6): the session handle's catalog pin is shown to bite. The trigger plants are the two that matter: attach_session_handle
// is safe only while no session commits without a handle.
describe('POLY-153 10_session_handle.sql fails on a planted change', () => {
  const body = readFileSync(join(dir, '10_session_handle.sql'), 'utf8');
  const run = (plant: string) => psql(body.replace('BEGIN;', () => `BEGIN;\n${plant};`), db).out.split('\n').filter((l) => /^not ok/.test(l));
  it('control: no plant, no failure', () => { expect(run('SELECT 1')).toEqual([]); });
  const plants: [string, string][] = [
    ['the deferred check dropped', 'DROP TRIGGER session_needs_handle ON public.session'],
    ['the deferred check disabled', 'ALTER TABLE public.session DISABLE TRIGGER session_needs_handle'],
    ['the deferred check made immediate-only (not deferred)', 'ALTER TABLE public.session DISABLE TRIGGER session_needs_handle; CREATE CONSTRAINT TRIGGER session_needs_handle AFTER INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION app.session_needs_handle()'],
    ['the check function executable by poly_app', 'GRANT EXECUTE ON FUNCTION app.session_needs_handle() TO poly_app'],
    ['a SELECT on session_handle for poly_app', 'GRANT SELECT ON app.session_handle TO poly_app'],
    ['a SELECT on session_handle through PUBLIC', 'GRANT SELECT ON app.session_handle TO PUBLIC'],
    ['a DELETE on session_handle for poly_authz', 'GRANT DELETE ON app.session_handle TO poly_authz'],
    ['attach_session_handle executable by poly_app', 'GRANT EXECUTE ON FUNCTION app.attach_session_handle(uuid, text) TO poly_app'],
    ['enter_session executable by poly_worker', 'GRANT EXECUTE ON FUNCTION app.enter_session(text) TO poly_worker'],
    ['a missing grant: enter_session revoked from poly_app', 'REVOKE EXECUTE ON FUNCTION app.enter_session(text) FROM poly_app'],
    ['UPDATE (id) on session for poly_auth', 'GRANT UPDATE (id) ON public.session TO poly_auth'],
    ['recent_auth_at writable by poly_authz', 'GRANT UPDATE (recent_auth_at) ON public.session TO poly_authz'],
    ['a second SET clause on a definer (proconfig has two entries)', "ALTER FUNCTION app.my_sessions() SET statement_timeout = '5s'"],
    ['a second overload of enter_session taking a hash', 'CREATE FUNCTION app.enter_session(bytea) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; GRANT EXECUTE ON FUNCTION app.enter_session(bytea) TO poly_app'],
  ];
  for (const [name, plant] of plants) it(`${name}: reported (and the unplanted file is clean, so a failure is the plant's)`, () => { expect(run('SELECT 1'), 'an unplanted failure would make every plant pass vacuously').toEqual([]); expect(run(plant).length, plant).toBeGreaterThan(0); });
});
