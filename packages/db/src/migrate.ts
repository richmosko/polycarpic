// The migration runner (ARCH §6.2, POLY-83 ruling R6). The one module allowed a session-level SET (layers.json
// sessionSetExempt): a dedicated pg client, never pooled, closed in finally, so identity cannot leak across requests.
// Exported on the restricted subpath db/migrate, importable by apps/migrate alone.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { connectionFrom, type Env } from './connection.ts';
import { DEFAULT_FOLDER, MigrateRefusal, pendingFrom, readJournal, sameEntry, type AppliedRow, type JournalEntry } from './journal.ts';

export { MigrateRefusal, type JournalEntry } from './journal.ts';

export const ROLES = [
  'poly_owner', 'poly_migrator', 'poly_app', 'poly_worker', 'poly_authz', 'poly_purge',
  'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal', 'poly_backup',
] as const;

const MIGRATOR_MEMBERSHIPS = ['poly_owner', 'poly_authz', 'poly_purge', 'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal'];

export interface MigrateOptions {
  /** The DATABASE_* settings (user poly_migrator). */
  env: Env;
  /** Folder holding meta/_journal.json and the .sql files. Defaults to the package's migrations/; a test hook, not read in production. */
  folder?: string;
  /** How long to wait for the advisory lock before exiting 4. Defaults to 10 minutes (unmeasured). */
  lockTimeoutMs?: number;
}

const LOCK_SQL = `SELECT pg_advisory_lock(hashtextextended('polycarpic.migrate', 0))`;
const LOCK_TIMEOUT = '55P03';

async function readApplied(client: pg.Client): Promise<AppliedRow[]> {
  const exists = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return [];
  const res = await client.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
  return res.rows.map((r) => ({ hash: r.hash as string, createdAt: Number(r.created_at) }));
}

async function assertRoles(client: pg.Client): Promise<void> {
  const res = await client.query(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [[...ROLES]]);
  const have = new Set(res.rows.map((r) => r.rolname as string));
  const missing = ROLES.filter((r) => !have.has(r));
  if (missing.length) throw new MigrateRefusal('roles-missing', `roles missing (run sql/roles.sql as a superuser): ${missing.join(', ')}`);
  // poly_migrator's memberships are exactly poly_owner + the seven definer owners, INHERIT FALSE, SET TRUE, no ADMIN (R1, C-85).
  const mem = await client.query(
    `SELECT r.rolname, m.inherit_option, m.set_option, m.admin_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'poly_migrator' ORDER BY r.rolname`,
  );
  const got = mem.rows.map((r) => `${r.rolname}:${r.inherit_option}:${r.set_option}:${r.admin_option}`).sort();
  const want = MIGRATOR_MEMBERSHIPS.map((r) => `${r}:false:true:false`).sort();
  if (got.join() !== want.join()) {
    throw new MigrateRefusal('roles-missing', `poly_migrator memberships are not exactly [${MIGRATOR_MEMBERSHIPS.join(', ')}] with INHERIT FALSE, SET TRUE, no ADMIN: got [${got.join(', ')}]`);
  }
  // First, so a grant of poly_owner TO poly_backup is named backup-acl, not as a stray member of poly_owner.
  await assertBackupRole(client);
  // The reverse direction (SecEng M-2): poly_owner and the seven have no member but poly_migrator. roles.sql only adds
  // grants, so drift on a live box is caught here.
  const stray = await client.query(
    `SELECT u.rolname AS member, r.rolname AS role FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
      WHERE r.rolname = ANY($1) AND u.rolname <> 'poly_migrator'`,
    [MIGRATOR_MEMBERSHIPS],
  );
  if (stray.rowCount) {
    throw new MigrateRefusal('roles-missing', `unexpected role memberships: ${stray.rows.map((r) => `${r.member} in ${r.role}`).join(', ')}`);
  }
}

const bad = (what: string): never => {
  throw new MigrateRefusal('backup-acl', `poly_backup is not exactly roles.sql's read-only role: ${what}`);
};

/** R12 (POLY-100): poly_backup bypasses RLS, so anything beyond roles.sql's state refuses the run. Catalog reads only. */
async function assertBackupRole(client: pg.Client): Promise<void> {
  // (b) attributes and settings.
  const a = (await client.query(
    `SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname = 'poly_backup'`,
  )).rows[0] as Record<string, unknown>;
  if (a.rolsuper || a.rolcreatedb || a.rolcreaterole || !a.rolcanlogin || !a.rolreplication || !a.rolbypassrls || a.rolconnlimit !== 3) {
    bad('attributes differ (want LOGIN REPLICATION BYPASSRLS, no SUPERUSER/CREATEDB/CREATEROLE, CONNECTION LIMIT 3)');
  }
  const set = await client.query(`SELECT setdatabase, unnest(setconfig) AS cfg FROM pg_db_role_setting WHERE setrole = $1`, [a.oid]);
  if (set.rows.length !== 1 || Number(set.rows[0].setdatabase) !== 0 || set.rows[0].cfg !== 'default_transaction_read_only=on') {
    bad(`role settings are not exactly {default_transaction_read_only=on}: got [${set.rows.map((r) => `${r.setdatabase}:${r.cfg}`).join(', ')}]`);
  }
  // (a) every dependency of another object on the role in the shared catalogs and this database (dbid 0 or current), except
  // pg_database ACL rows: those are shared, one per database, and are judged by the datacl read below. Sibling databases'
  // objects cannot be inspected from here; pg_hba admits poly_backup to the application database only (ruling R12).
  const dep = await client.query(
    `SELECT d.dbid, d.classid::regclass::text AS cls, d.objid, d.objsubid, d.deptype FROM pg_shdepend d
      WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = $1
        AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
        AND NOT (d.classid = 'pg_database'::regclass AND d.deptype = 'a')`,
    [a.oid],
  );
  if (dep.rowCount) {
    bad(`it owns or holds privileges on objects: ${dep.rows.map((r) => `${r.cls}:${r.objid}${r.objsubid ? `.${r.objsubid}` : ''} (${r.deptype}, db ${r.dbid})`).join(', ')}`);
  }
  // Every database's ACL entry for the role is exactly CONNECT, without grant option (also catches TEMPORARY/CREATE, which share the row).
  const acl = await client.query(
    `SELECT db.datname, db.datname = current_database() AS here, x.privilege_type, x.is_grantable FROM pg_database db, aclexplode(db.datacl) x
      WHERE x.grantee = $1`, [a.oid],
  );
  const wrong = acl.rows.filter((r) => r.privilege_type !== 'CONNECT' || r.is_grantable);
  if (wrong.length) bad(`its privileges on databases are not exactly CONNECT: ${wrong.map((r) => `${r.datname}: ${r.privilege_type}${r.is_grantable ? ' WITH GRANT OPTION' : ''}`).join(', ')}`);
  if (!acl.rows.some((r) => r.here)) bad('it has no CONNECT on the current database');
  // (c) memberships, which pg_shdepend does not record (S5).
  const mem = await client.query(
    `SELECT u.rolname AS member, r.rolname AS role, m.admin_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = 'poly_backup' OR r.rolname = 'poly_backup'`,
  );
  const only = mem.rows.length === 1 && mem.rows[0].member === 'poly_backup' && mem.rows[0].role === 'pg_read_all_data' && !mem.rows[0].admin_option;
  if (!only) {
    bad(`unexpected role memberships: [${mem.rows.map((r) => `${r.member} in ${r.role}${r.admin_option ? ' with admin' : ''}`).join(', ')}], want only poly_backup in pg_read_all_data`);
  }
}

/** Applies every pending migration in one transaction under an advisory lock. Returns the tags applied. */
export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const folder = opts.folder ?? DEFAULT_FOLDER;
  const journal = readJournal(folder);
  const client = new pg.Client(connectionFrom(opts.env));
  await client.connect();
  try {
    await assertRoles(client);
    await client.query('SET ROLE poly_owner');
    await client.query(`SET lock_timeout = ${Math.round(opts.lockTimeoutMs ?? 600_000)}`);
    try {
      await client.query(LOCK_SQL);
    } catch (e) {
      if ((e as { code?: string }).code === LOCK_TIMEOUT) throw new MigrateRefusal('lock-timeout', 'timed out waiting for the migrate advisory lock; nothing applied');
      throw e;
    }
    const pending = pendingFrom(journal, await readApplied(client));
    if (pending.length === 0) return [];
    await drizzleMigrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
    const who = await client.query('SELECT current_user AS u');
    if (who.rows[0].u !== 'poly_owner') {
      throw new MigrateRefusal('wrong-role', `migrate returned as ${String(who.rows[0].u)}, not poly_owner`);
    }
    // drizzle skips a migration silently when its timestamp is not later than the last applied: converge or fail loud.
    const after = await readApplied(client);
    if (after.length !== journal.length || after.some((r, i) => !sameEntry(r, journal[i]!))) {
      throw new MigrateRefusal('not-converged', 'tracking rows do not equal the journal after migrate(); a migration was skipped');
    }
    return pending.map((e) => e.tag);
  } finally {
    await client.end();
  }
}

/** Read-only: the pending files in order. Takes no lock and writes nothing. */
export async function plan(opts: MigrateOptions): Promise<JournalEntry[]> {
  const journal = readJournal(opts.folder ?? DEFAULT_FOLDER);
  const client = new pg.Client(connectionFrom(opts.env));
  await client.connect();
  try {
    // Same preflight as apply (Addendum 2): --plan must predict apply, so drift exits 2 here too. Catalog reads only.
    await assertRoles(client);
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE poly_owner');
    const pending = pendingFrom(journal, await readApplied(client));
    await client.query('ROLLBACK');
    return pending;
  } finally {
    await client.end();
  }
}
