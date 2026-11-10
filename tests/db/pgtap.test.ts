// Runs every tests/db/pgtap/*.sql against a database migrated by the real runner with the real migrations,
// and fails on any "not ok" TAP line (psql prints TAP; no pg_prove needed).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
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
  it('matches on function, owner, proconfig and EXECUTE ACL', () => {
    const allow: { function: string; owner: string; execute: string[] }[] =
      JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'db', 'sql', 'definers.json'), 'utf8'));
    const r = psql(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_userbyid(p.proowner),
        coalesce(array_to_string(p.proconfig, ','), ''),
        coalesce((SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_roles g WHERE g.rolname ~ '^poly_' AND has_function_privilege(g.oid, p.oid, 'EXECUTE')
          AND g.rolname <> pg_get_userbyid(p.proowner)), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1`, db);
    expect(r.ok, r.err).toBe(true);
    const got = r.rows.map(([fn, owner, cfg, exec]) => ({ function: fn, owner, cfg, execute: exec ? exec.split(',') : [] }));
    expect(got.map((g) => g.function)).toEqual(allow.map((a) => a.function).sort());
    for (const g of got) {
      const a = allow.find((x) => x.function === g.function)!;
      expect(g.owner, g.function).toBe(a.owner);
      expect(g.execute, g.function).toEqual([...a.execute].sort());
      expect(g.cfg, `${g.function} must pin search_path`).toMatch(/search_path=""/);
    }
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
