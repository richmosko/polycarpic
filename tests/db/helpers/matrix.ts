// SECURITY §4.2.1 permission matrix as data (C-17; ruling R5). The data lives in packages/tenancy/permission-matrix.json,
// which the endpoint matrix will read too. A row is ACTIVE when `db !== false` and every table resolves; an active row
// must carry a probe (shape fixed by POLY-62 with its fixture), else "table landed without its matrix probe" fails.
// Inactive rows are counted and printed, never failed or skipped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, must } from './pg';

export type Cell = 'allow' | 'deny' | 'own';
export type MatrixRow = {
  id: string; action: string; tables: string[]; cells: { viewer: Cell; manager: Cell; owner: Cell };
  probe: unknown | null; note?: string; db?: boolean;
};
export type Matrix = { cellValues: Cell[]; rows: MatrixRow[] };

export const MATRIX_FILE = join(ROOT, 'packages', 'tenancy', 'permission-matrix.json');
export const loadMatrix = (): Matrix => JSON.parse(readFileSync(MATRIX_FILE, 'utf8'));

/** Shape errors: unique kebab ids, complete and legal cells, qualified table names, tables empty exactly when db is false. */
export function validate(rows: MatrixRow[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id ?? '')) errs.push(`${r.id}: id is not kebab-case`);
    if (seen.has(r.id)) errs.push(`${r.id}: duplicate id`);
    seen.add(r.id);
    if (!r.action) errs.push(`${r.id}: no action text`);
    for (const role of ['viewer', 'manager', 'owner'] as const) {
      if (!['allow', 'deny', 'own'].includes(r.cells?.[role] as string)) errs.push(`${r.id}: cell ${role} is missing or illegal`);
    }
    if (!Array.isArray(r.tables) || r.tables.some((t) => !/^[a-z_]+\.[a-z_]+$/.test(t))) errs.push(`${r.id}: tables must be schema.table names`);
    else if ((r.tables.length === 0) !== (r.db === false)) errs.push(`${r.id}: tables is empty exactly when db is false`);
    if (r.db === false && !r.note) errs.push(`${r.id}: a db:false row needs a note saying why`);
    if (r.probe === undefined) errs.push(`${r.id}: probe must be null or an object`);
  }
  return errs;
}

/** Active rows (every table exists) and the count/ids of inactive ones. */
export function activeRows(db: string, rows: MatrixRow[]): { active: MatrixRow[]; inactive: string[]; unresolved: Record<string, string[]> } {
  const names = [...new Set(rows.flatMap((r) => r.tables))];
  const there = new Set<string>();
  for (const t of names) if (must(`SELECT to_regclass('${t}') IS NOT NULL`, db).rows[0][0] === 't') there.add(t);
  const active = rows.filter((r) => r.db !== false && r.tables.every((t) => there.has(t)));
  const off = rows.filter((r) => !active.includes(r));
  const unresolved = Object.fromEntries(off.map((r) => [r.id, r.db === false ? ['(db:false)'] : r.tables.filter((t) => !there.has(t))]));
  return { active, inactive: off.map((r) => r.id), unresolved };
}

/** A table landed without its probe: every active row with probe null. */
export const missingProbes = (active: MatrixRow[]): string[] =>
  active.filter((r) => r.probe === null).map((r) => `${r.id}: table landed without its matrix probe`);
