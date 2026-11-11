// POLY-84 criterion 10 (ruling R5) and POLY-62 ruling R6/R7: the SECURITY §4.2.1 permission matrix as data. Rows activate as
// their tables (and required functions) land; after POLY-62 exactly six are active, pinned by id. The probes run in
// tenancy.test.ts, which owns the seeded fixture. A table that lands without a probe fails here; a table no row names and
// no reviewed list covers fails here too (reverse coverage).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { activeRows, coverageGaps, exemptions, loadMatrix, missingProbes, validate, type MatrixRow } from './helpers/matrix';
import { ROOT, must } from './helpers/pg';

let db: string;
const row = (over: Partial<MatrixRow>): MatrixRow => ({
  id: 'canary', action: 'canary action', tables: ['public.qa_canary_rls'], cells: { viewer: 'deny', manager: 'allow', owner: 'allow' }, probe: null, ...over,
});
const ACTIVE_AFTER_POLY_62 = ['audit-event-read', 'co-owner-remove-demote', 'entity-metadata', 'member-remove-demote-self', 'membership-invite-raise', 'read-membership-list'];

beforeAll(() => {
  db = freshDb();
  expect(migrateCli(db, REAL_MIGRATIONS).code).toBe(0);
});

describe('the §4.2.1 matrix data (criterion 10)', () => {
  it('every row of packages/tenancy/permission-matrix.json is well formed: unique ids, complete legal cells, real table names, probes that name every table', () => {
    const m = loadMatrix();
    expect(m.rows.length).toBeGreaterThan(0);
    expect(validate(m.rows)).toEqual([]);
  });

  // Mutation: any of the five rows' probe set back to null, or a typo in one of its table names, turns this red.
  it('exactly the six POLY-62 rows are active, and none lacks a probe; founder-transfer waits for its function (its column does not exist yet)', () => {
    const { rows } = loadMatrix();
    const { active, inactive, unresolved } = activeRows(db, rows);
    console.info(`permission matrix: ${active.length} active, ${inactive.length} inactive of ${rows.length}`);
    for (const id of inactive) console.info(`  inactive ${id}: ${unresolved[id].join(', ')}`);
    expect(missingProbes(active)).toEqual([]);
    expect(active.map((r) => r.id).sort()).toEqual(ACTIVE_AFTER_POLY_62);
    expect(unresolved['founder-transfer']).toEqual(['app.transfer_founder']);
    expect(unresolved['read-books'], 'read-books names ledger_account, not BetterAuth\'s public.account').not.toContain('public.account');
  });

  // Mutation: delete an `unlisted` entry, or rename a row's table to a misspelling, and the table shows up uncovered.
  it('reverse coverage: every real relation is named by a row, the exemption list or the unlisted list', () => {
    const m = loadMatrix();
    expect(coverageGaps(db, m.rows, m.unlisted ?? [], exemptions())).toEqual([]);
    expect(m.unlisted?.map((u) => u.table).sort()).toEqual(['public.entity_type', 'public.notification']);
    // ruling N4: the cover for an unlisted table is its per-table cross-tenant test in tenancy.test.ts
    const cover = readFileSync(join(ROOT, 'tests', 'db', 'tenancy.test.ts'), 'utf8');
    for (const u of m.unlisted ?? []) expect(cover, `${u.table} needs a cross-tenant case in tenancy.test.ts`).toContain(`['${u.table}',`);
  });

  it('canary: an uncovered table, a misspelled row table, a stale unlisted entry and a matrix table on the exemption list are each reported', () => {
    must(`CREATE TABLE public.qa_canary_cov (id int)`, db);
    try {
      const m = loadMatrix();
      const ex = exemptions();
      expect(coverageGaps(db, m.rows, m.unlisted ?? [], ex)).toEqual(['public.qa_canary_cov: in no matrix row, no unlisted entry and not exempt']);
      const typo = m.rows.map((r) => ({ ...r, tables: r.tables.map((t) => (t === 'public.audit_event' ? 'public.audit_evnt' : t)) }));
      expect(coverageGaps(db, typo, [...(m.unlisted ?? []), { table: 'public.qa_canary_cov', reason: 'canary' }], ex))
        .toEqual(['public.audit_event: in no matrix row, no unlisted entry and not exempt']);
      expect(coverageGaps(db, m.rows, [...(m.unlisted ?? []), { table: 'public.qa_canary_cov', reason: 'canary' }, { table: 'public.qa_canary_gone', reason: 'stale' }], ex))
        .toEqual(['public.qa_canary_gone: unlisted entry names no real table']);
      const onList = m.rows.map((r) => (r.id === 'audit-event-read' ? { ...r, tables: ['public.session'] } : r));
      expect(coverageGaps(db, onList, m.unlisted ?? [], ex)).toContain('public.session: exempt table is named by a matrix row');
    } finally {
      must(`DROP TABLE public.qa_canary_cov`, db);
    }
  });

  it('canary: a row whose table exists but has no probe fails activation; with a probe it passes; a missing table, a missing function or db:false stays inactive', () => {
    must(`CREATE TABLE public.qa_canary_rls (id int)`, db);
    try {
      const probe = [{ op: 'select' as const, table: 'public.qa_canary_rls', sql: 'select 1' }];
      const rows = [
        row({ id: 'landed-no-probe' }),
        row({ id: 'landed-with-probe', probe }),
        row({ id: 'not-yet', tables: ['public.qa_canary_missing'] }),
        row({ id: 'no-db', tables: [], db: false }),
        row({ id: 'half-landed', tables: ['public.qa_canary_rls', 'public.qa_canary_missing'] }),
        row({ id: 'needs-fn', requires: ['app.qa_canary_missing_fn'] }),
        row({ id: 'has-fn', requires: ['app.has_role'] }),
      ];
      const { active, inactive, unresolved } = activeRows(db, rows);
      expect(active.map((r) => r.id)).toEqual(['landed-no-probe', 'landed-with-probe', 'has-fn']);
      expect(inactive).toEqual(['not-yet', 'no-db', 'half-landed', 'needs-fn']);
      expect(unresolved).toEqual({ 'not-yet': ['public.qa_canary_missing'], 'no-db': ['(db:false)'], 'half-landed': ['public.qa_canary_missing'], 'needs-fn': ['app.qa_canary_missing_fn'] });
      expect(missingProbes(active)).toEqual(['landed-no-probe: table landed without its matrix probe', 'has-fn: table landed without its matrix probe']);
    } finally {
      must(`DROP TABLE public.qa_canary_rls`, db);
    }
  });

  it('canary: the validator rejects a duplicate id, a missing cell, an illegal cell, a db:false row that names tables, a table no probe names and an own cell without ownSql', () => {
    expect(validate([row({ id: 'a' }), row({ id: 'a' })])).toEqual(['a: duplicate id']);
    expect(validate([row({ cells: { viewer: 'deny', manager: 'allow' } as MatrixRow['cells'] })])).toEqual(['canary: cell owner is missing or illegal']);
    expect(validate([row({ cells: { viewer: 'maybe', manager: 'allow', owner: 'allow' } as unknown as MatrixRow['cells'] })])).toEqual(['canary: cell viewer is missing or illegal']);
    expect(validate([row({ db: false, note: 'n' })])).toEqual(['canary: tables is empty exactly when db is false']);
    expect(validate([row({ tables: [] })])).toEqual(['canary: tables is empty exactly when db is false']);
    expect(validate([row({ tables: [], db: false })])).toEqual(['canary: a db:false row needs a note saying why']);
    expect(validate([row({ id: 'Bad_Id' })])).toEqual(['Bad_Id: id is not kebab-case']);
    const p = { op: 'select' as const, table: 'public.other', sql: 'select 1' };
    expect(validate([row({ probe: [p] })])).toEqual(['canary: table public.qa_canary_rls is named by no probe entry']);
    expect(validate([row({ cells: { viewer: 'own', manager: 'allow', owner: 'allow' }, probe: [{ ...p, table: 'public.qa_canary_rls' }] })])).toEqual(['canary: probe 0 needs ownSql, the row has an own cell']);
    expect(validate([row({ requires: ['nofunction'] })])).toEqual(['canary: requires must list schema.function names']);
  });
});
