// POLY-152 follow-up N2 (filed on POLY-153): pgTAP 08's planted-grant list gains role membership in poly_app, plain and in the
// `WITH INHERIT FALSE, SET TRUE` form (no inherited privilege shows it; SET ROLE does). A role-membership GRANT is cluster-wide state, so
// these plants live in a SERIAL file (tests/ci/db-harness.test.ts C5), run inside 08's own rolled-back transaction on a throwaway database.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { psql } from './helpers/pg';

const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pgtap', '08_poly_auth_grants.sql'), 'utf8');
let db: string;
beforeAll(() => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, `migrate failed: ${r.err}${r.out}`).toBe(0);
  expect(psql('CREATE EXTENSION IF NOT EXISTS pgtap', db).ok).toBe(true);
});
const run = (plant: string) => psql(body.replace('BEGIN;', () => `BEGIN;\n${plant};`), db).out.split('\n').filter((l) => /^not ok/.test(l));

describe('08_poly_auth_grants.sql fails on a planted role membership (N2)', () => {
  it('control: no plant, no failure [red if: 08 fails unplanted, so the plants below would pass vacuously]', () => { expect(run('SELECT 1')).toEqual([]); });
  it('GRANT poly_app TO poly_auth: reported by the membership count and the effective-role check [red if: 08 ignores role membership]', () => {
    expect(run('GRANT poly_app TO poly_auth').length).toBeGreaterThanOrEqual(2);
  });
  it('GRANT poly_app TO poly_auth WITH INHERIT FALSE, SET TRUE: reported (the effective-privilege checks alone would miss it) [red if: only inherited privileges are checked]', () => {
    const hits = run('GRANT poly_app TO poly_auth WITH INHERIT FALSE, SET TRUE');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((l) => /SET ROLE|inherit|become/i.test(l))).toBe(true);
  });
});
