// POLY-84 criterion 10 (ruling R5): the SECURITY §4.2.1 permission matrix as data. M1 has no tenant table, so every real
// row is inactive; the harness is proven on a canary row. A table that lands without a probe fails here.
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { activeRows, loadMatrix, missingProbes, validate, type MatrixRow } from './helpers/matrix';
import { must } from './helpers/pg';

let db: string;
const row = (over: Partial<MatrixRow>): MatrixRow => ({
  id: 'canary', action: 'canary action', tables: ['public.qa_canary_rls'], cells: { viewer: 'deny', manager: 'allow', owner: 'allow' }, probe: null, ...over,
});

beforeAll(() => {
  db = freshDb();
  expect(migrateCli(db, REAL_MIGRATIONS).code).toBe(0);
});

describe('the §4.2.1 matrix data (criterion 10)', () => {
  it('every row of packages/tenancy/permission-matrix.json is well formed: unique ids, complete legal cells, real table names', () => {
    const m = loadMatrix();
    expect(m.rows.length).toBeGreaterThan(0);
    expect(validate(m.rows)).toEqual([]);
  });

  it('rows activate as their tables land: none is active in M1, the inactive ones are counted, and none lacks a probe', () => {
    const { rows } = loadMatrix();
    const { active, inactive } = activeRows(db, rows);
    console.info(`permission matrix: ${active.length} active, ${inactive.length} inactive of ${rows.length}`);
    expect(missingProbes(active)).toEqual([]);
    expect(active.length + inactive.length).toBe(rows.length);
    expect(active, 'M1 has no tenant table; the first one to land activates rows here').toEqual([]);
  });

  it('canary: a row whose table exists but has no probe fails activation; with a probe it passes; a missing table or db:false stays inactive', () => {
    must(`CREATE TABLE public.qa_canary_rls (id int)`, db);
    try {
      const rows = [
        row({ id: 'landed-no-probe' }),
        row({ id: 'landed-with-probe', probe: { kind: 'placeholder' } }),
        row({ id: 'not-yet', tables: ['public.qa_canary_missing'] }),
        row({ id: 'no-db', tables: [], db: false }),
        row({ id: 'half-landed', tables: ['public.qa_canary_rls', 'public.qa_canary_missing'] }),
      ];
      const { active, inactive } = activeRows(db, rows);
      expect(active.map((r) => r.id)).toEqual(['landed-no-probe', 'landed-with-probe']);
      expect(inactive).toEqual(['not-yet', 'no-db', 'half-landed']);
      expect(missingProbes(active)).toEqual(['landed-no-probe: table landed without its matrix probe']);
    } finally {
      must(`DROP TABLE public.qa_canary_rls`, db);
    }
  });

  it('canary: the validator rejects a duplicate id, a missing cell, an illegal cell and a db:false row that names tables', () => {
    expect(validate([row({ id: 'a' }), row({ id: 'a' })])).toEqual(['a: duplicate id']);
    expect(validate([row({ cells: { viewer: 'deny', manager: 'allow' } as MatrixRow['cells'] })])).toEqual(['canary: cell owner is missing or illegal']);
    expect(validate([row({ cells: { viewer: 'maybe', manager: 'allow', owner: 'allow' } as unknown as MatrixRow['cells'] })])).toEqual(['canary: cell viewer is missing or illegal']);
    expect(validate([row({ db: false, note: 'n' })])).toEqual(['canary: tables is empty exactly when db is false']);
    expect(validate([row({ tables: [] })])).toEqual(['canary: tables is empty exactly when db is false']);
    expect(validate([row({ tables: [], db: false })])).toEqual(['canary: a db:false row needs a note saying why']);
    expect(validate([row({ id: 'Bad_Id' })])).toEqual(['Bad_Id: id is not kebab-case']);
  });
});
