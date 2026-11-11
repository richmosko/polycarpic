// SECURITY §4.2.1 permission matrix as data (C-17; ruling R5; POLY-62 ruling R6/R7). The data lives in
// packages/tenancy/permission-matrix.json, which the endpoint matrix will read too. A row is ACTIVE when `db !== false`,
// every table resolves and every `requires` function exists; an active row must carry a probe, else "table landed without
// its matrix probe" fails. Inactive rows are counted and printed, never failed or skipped.
//
// Probe shape: "probe": [ { op: select|insert|update|delete, table: "schema.table", sql, ownSql? } ]. Placeholders
// :entity :other_entity :actor :owner :manager :viewer :outsider are bound positionally. Each actor (viewer, manager, owner
// and the outsider, who must be denied everywhere) runs each entry in its own transaction, always rolled back.
//   select: allow = as many rows as the superuser sees for the same sql (and that count is > 0); deny = 0 rows;
//           own = `ownSql` (with :actor) as superuser gives N > 0, and `sql` as the actor returns exactly N, fewer than all.
//   write : allow = no error and rowCount >= 1; deny = 42501, 23514 or rowCount 0;
//           own = `ownSql` must allow and `sql` must deny.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, must, psql } from './pg';

export type Cell = 'allow' | 'deny' | 'own';
export type ProbeEntry = { op: 'select' | 'insert' | 'update' | 'delete'; table: string; sql: string; ownSql?: string };
export type MatrixRow = {
  id: string; action: string; tables: string[]; cells: { viewer: Cell; manager: Cell; owner: Cell };
  probe: ProbeEntry[] | null; note?: string; db?: boolean; requires?: string[];
};
export type Matrix = { cellValues: Cell[]; rows: MatrixRow[]; unlisted?: { table: string; reason: string }[] };

export const MATRIX_FILE = join(ROOT, 'packages', 'tenancy', 'permission-matrix.json');
export const loadMatrix = (): Matrix => JSON.parse(readFileSync(MATRIX_FILE, 'utf8'));

/** Shape errors: unique kebab ids, complete and legal cells, qualified table names, tables empty exactly when db is false, probe shape. */
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
    if (r.probe === undefined) errs.push(`${r.id}: probe must be null or an array`);
    if (r.requires !== undefined && (!Array.isArray(r.requires) || r.requires.some((f) => !/^[a-z_]+\.[a-z_0-9]+$/.test(f)))) errs.push(`${r.id}: requires must list schema.function names`);
    if (Array.isArray(r.probe)) {
      const needsOwn = Object.values(r.cells ?? {}).includes('own');
      r.probe.forEach((p, i) => {
        if (!['select', 'insert', 'update', 'delete'].includes(p?.op)) errs.push(`${r.id}: probe ${i} has an illegal op`);
        if (!p?.sql) errs.push(`${r.id}: probe ${i} has no sql`);
        if (needsOwn && !p?.ownSql) errs.push(`${r.id}: probe ${i} needs ownSql, the row has an own cell`);
      });
      for (const t of r.tables ?? []) if (!r.probe.some((p) => p.table === t)) errs.push(`${r.id}: table ${t} is named by no probe entry`);
    }
  }
  return errs;
}

const exists = (db: string, sql: string) => must(sql, db).rows[0][0] === 't';

/** Active rows (every table exists, every required function exists) and the ids / reasons of inactive ones. */
export function activeRows(db: string, rows: MatrixRow[]): { active: MatrixRow[]; inactive: string[]; unresolved: Record<string, string[]> } {
  const tables = new Set<string>();
  for (const t of new Set(rows.flatMap((r) => r.tables))) if (exists(db, `SELECT to_regclass('${t}') IS NOT NULL`)) tables.add(t);
  const fns = new Set<string>();
  for (const f of new Set(rows.flatMap((r) => r.requires ?? []))) {
    const [s, n] = f.split('.');
    if (exists(db, `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${s}' AND p.proname = '${n}')`)) fns.add(f);
  }
  const active = rows.filter((r) => r.db !== false && r.tables.every((t) => tables.has(t)) && (r.requires ?? []).every((f) => fns.has(f)));
  const off = rows.filter((r) => !active.includes(r));
  const unresolved = Object.fromEntries(off.map((r) => [r.id, r.db === false ? ['(db:false)'] : [...r.tables.filter((t) => !tables.has(t)), ...(r.requires ?? []).filter((f) => !fns.has(f))]]));
  return { active, inactive: off.map((r) => r.id), unresolved };
}

/** A table landed without its probe: every active row with probe null. */
export const missingProbes = (active: MatrixRow[]): string[] =>
  active.filter((r) => r.probe === null).map((r) => `${r.id}: table landed without its matrix probe`);

/** The R2 exemption list, read from the literal in the pgTAP catalog probe so there is one source. */
export function exemptions(): string[] {
  const sql = readFileSync(join(ROOT, 'tests', 'db', 'pgtap', '02_rls_catalog.sql'), 'utf8');
  const arr = /ARRAY\[([^\]]*)\]/.exec(sql.slice(sql.indexOf('pg_temp.exemptions()')))?.[1] ?? '';
  return [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1].replaceAll('"', '')); // public."user" -> public.user, as pg_class spells it
}

/** Reverse coverage (POLY-62 R7): every real relation is named by a row, the exemption list or `unlisted`; every listed name resolves. */
export function coverageGaps(db: string, rows: MatrixRow[], unlisted: { table: string; reason: string }[], exempt: string[]): string[] {
  const out: string[] = [];
  const real = must(`SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relpersistence <> 't' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`, db).rows.map((r) => r[0]);
  const named = new Set(rows.flatMap((r) => r.tables));
  const unl = new Set(unlisted.map((u) => u.table));
  const ex = new Set(exempt);
  for (const t of real) if (!named.has(t) && !unl.has(t) && !ex.has(t)) out.push(`${t}: in no matrix row, no unlisted entry and not exempt`);
  for (const u of unlisted) {
    if (!u.reason) out.push(`${u.table}: unlisted without a reason`);
    if (!real.includes(u.table)) out.push(`${u.table}: unlisted entry names no real table`);
    if (named.has(u.table)) out.push(`${u.table}: unlisted but also named by a matrix row`);
  }
  for (const e of exempt) {
    if (!real.includes(e)) out.push(`${e}: exemption names no real table`);
    if (named.has(e)) out.push(`${e}: exempt table is named by a matrix row`);
  }
  return out;
}

// ---- probe runner ------------------------------------------------------------------------------------------------
export type Actor = 'viewer' | 'manager' | 'owner' | 'outsider';
export type Fixture = { users: Record<Actor, string>; entity: string; otherEntity: string };
const NAMES = ['entity', 'other_entity', 'actor', 'owner', 'manager', 'viewer', 'outsider'] as const;

/** Bind :names to $n in order of appearance. */
export function bind(sql: string, fx: Fixture, actor: string): { text: string; params: string[] } {
  const params: string[] = [];
  const val: Record<string, string> = { entity: fx.entity, other_entity: fx.otherEntity, actor, ...fx.users };
  const text = sql.replace(new RegExp(`:(${NAMES.join('|')})\\b`, 'g'), (_m, n: string) => { params.push(val[n]); return `$${params.length}::uuid`; });
  return { text, params };
}
/** The same sql with literals, for the superuser count. */
export function literal(sql: string, fx: Fixture, actor: string): string {
  const val: Record<string, string> = { entity: fx.entity, other_entity: fx.otherEntity, actor, ...fx.users };
  return sql.replace(new RegExp(`:(${NAMES.join('|')})\\b`, 'g'), (_m, n: string) => `'${val[n]}'::uuid`);
}
export const superCount = (db: string, sql: string, fx: Fixture, actor: string): number =>
  Number(must(`SELECT count(*) FROM (${literal(sql, fx, actor)}) s`, db).rows[0][0]);

export type Outcome = { error: string | null; rows: number };
const ROLLBACK = Symbol('rollback');

/** Run one statement as `actor` through withTenant in a transaction that is always rolled back. */
export async function runAs(
  tenant: (uid: string, fn: (tx: any) => Promise<any>) => Promise<any>,
  rawQuery: (tx: any, text: string, p: unknown[]) => Promise<{ rowCount: number | null; rows: unknown[] }>,
  fx: Fixture, actor: Actor, sql: string,
): Promise<Outcome> {
  const { text, params } = bind(sql, fx, fx.users[actor]);
  let out: Outcome = { error: null, rows: 0 };
  try {
    await tenant(fx.users[actor], async (tx) => {
      const r = await rawQuery(tx, text, params);
      out = { error: null, rows: r.rowCount ?? r.rows.length };
      throw ROLLBACK;
    });
  } catch (e: any) {
    if (e !== ROLLBACK) out = { error: e?.code ?? e?.cause?.code ?? String(e), rows: 0 };
  }
  return out;
}

const DENY_ERRORS = ['42501', '23514'];
/** Problems for one probe entry across the four actors; empty when every actor gets the cell the row promises. */
export async function checkProbe(
  db: string, row: MatrixRow, p: ProbeEntry, fx: Fixture,
  run: (actor: Actor, sql: string) => Promise<Outcome>,
): Promise<string[]> {
  const bad: string[] = [];
  const tag = (a: Actor) => `${row.id} ${p.op} ${p.table} as ${a}`;
  const denied = (o: Outcome, select: boolean) => (select ? o.error === null && o.rows === 0 : (o.error !== null && DENY_ERRORS.includes(o.error)) || (o.error === null && o.rows === 0));
  const isSelect = p.op === 'select';
  for (const a of ['viewer', 'manager', 'owner', 'outsider'] as Actor[]) {
    const cell: Cell = a === 'outsider' ? 'deny' : row.cells[a];
    const o = await run(a, p.sql);
    if (isSelect) {
      const all = superCount(db, p.sql, fx, fx.users[a]);
      if (cell === 'allow' && !(o.error === null && o.rows === all && all > 0)) bad.push(`${tag(a)}: wanted all ${all} rows (>0), got ${o.error ?? o.rows}`);
      if (cell === 'deny' && !denied(o, true)) bad.push(`${tag(a)}: wanted 0 rows, got ${o.error ?? o.rows}`);
      if (cell === 'own') {
        const mine = superCount(db, p.ownSql!, fx, fx.users[a]);
        if (!(o.error === null && mine > 0 && o.rows === mine && mine < all)) bad.push(`${tag(a)}: wanted exactly its own ${mine} of ${all} rows, got ${o.error ?? o.rows}`);
      }
    } else {
      if (cell === 'allow' && !(o.error === null && o.rows >= 1)) bad.push(`${tag(a)}: wanted success with >= 1 row, got ${o.error ?? o.rows}`);
      if (cell === 'deny' && !denied(o, false)) bad.push(`${tag(a)}: wanted a denial, got ${o.error ?? `${o.rows} rows`}`);
      if (cell === 'own') {
        if (!denied(o, false)) bad.push(`${tag(a)}: sql must be denied for an own cell, got ${o.error ?? `${o.rows} rows`}`);
        const mine = await run(a, p.ownSql!);
        if (!(mine.error === null && mine.rows >= 1)) bad.push(`${tag(a)}: ownSql wanted success, got ${mine.error ?? mine.rows}`);
      }
    }
  }
  return bad;
}
export { psql };
