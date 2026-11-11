// POLY-102 R4 guards for the db-battery speed-up. Contract with the builder (reconcile in this header only):
//   helpers/api.ts exports `cloneMigrated(): string`, a database cloned (CREATE DATABASE ... TEMPLATE) from a per-file
//   template that was built once with freshDb() + the real migration chain; it replaces the three `migrated()` copies.
//   freshDb() no longer sets role passwords: global setup sets them once.
import { describe, expect, it } from 'vitest';
import * as api from './helpers/api';
import { must } from './helpers/pg';

const LOGIN = ['poly_migrator', 'poly_app', 'poly_worker', 'poly_backup'];
const facts = (db: string) => ({
  dba: must(`SELECT pg_get_userbyid(datdba), datacl::text FROM pg_database WHERE datname='${db}'`).rows,
  schemas: must(`SELECT nspname, pg_get_userbyid(nspowner), nspacl::text FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1`, db).rows,
  tables: must(`SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`, db).rows,
  tracking: must(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`, db).rows,
  dbSettings: must(`SELECT coalesce(r.rolname,''), s.setconfig::text FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname='${db}') ORDER BY 1`).rows,
});
// A database name differs between the two sides by construction; the per-database ACL text names no database.
const norm = (f: ReturnType<typeof facts>) => JSON.stringify(f);

describe('template clone equals a freshly migrated database (R4 guard for cut 1)', () => {
  it('a clone and freshDb()+migrate agree on owner, ACL, schema owners/ACLs, table owners, role settings and the tracking rows  [red if: the clone is not OWNER-correct, or the database-level bootstrap is not re-run]', () => {
    expect(typeof (api as any).cloneMigrated, 'helpers/api.ts must export cloneMigrated()').toBe('function');
    const fresh = api.freshDb();
    const r = api.migrateCli(fresh, api.REAL_MIGRATIONS);
    expect(r.code, r.err + r.out).toBe(0);
    const clone = (api as any).cloneMigrated() as string;
    expect(clone).not.toBe(fresh);
    expect(norm(facts(clone))).toBe(norm(facts(fresh)));
    expect(facts(clone).tracking.length).toBeGreaterThan(0);
  });

  it('two clones are independent databases  [red if: the clone shares state with its template or sibling]', () => {
    const a = (api as any).cloneMigrated() as string;
    const b = (api as any).cloneMigrated() as string;
    expect(a).not.toBe(b);
    must(`DELETE FROM drizzle.__drizzle_migrations`, a);
    expect(must(`SELECT count(*) FROM drizzle.__drizzle_migrations`, b).rows[0][0]).not.toBe('0');
  });
});

describe('role passwords are set once, not per freshDb() (R4 cut 2)', () => {
  const hashes = () => must(`SELECT rolname, rolpassword FROM pg_authid WHERE rolname IN (${LOGIN.map((r) => `'${r}'`).join(',')}) ORDER BY 1`).rows;

  it('freshDb() leaves every login role\'s stored password hash untouched (a SCRAM salt is new on every ALTER ROLE ... PASSWORD)  [red if: freshDb() sets the passwords again]', () => {
    api.freshDb(); // ensure the roles exist
    const before = hashes();
    expect(before).toHaveLength(LOGIN.length);
    api.freshDb();
    api.freshDb();
    expect(hashes()).toEqual(before);
  });

  it('every login role can still log in with the harness password on a database from freshDb()  [red if: global setup does not set the passwords]', () => {
    const db = api.freshDb();
    for (const role of LOGIN) expect(must('SELECT 1', db, { role }).ok, role).toBe(true);
  });
});
