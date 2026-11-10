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
