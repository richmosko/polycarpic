// POLY-83 runner fixtures (POLY-76 ruling §4.4, SECURITY T-91, ARCH §6.2/§8.1). Each refusal = one fixture: the
// runner exits non-zero with the specific error, and NOTHING from the run is applied (tracking rows + tables unchanged).
// Error tokens (E.*) are the contract with backend-lead's runner messages; reconcile in this table only.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MIGRATE_CLI, applied, dbEnv, freshDb, journalOf, migrateCli, migrateRun, rewrite, setJournal, tableExists, writeMigrations } from './helpers/api';
import { must, psql, psqlSession } from './helpers/pg';

export const E = {
  prefix: /prefix|not a hash-for-hash/i,
  older: /older|not strictly|increasing|\bwhen\b|timestamp|order/i,
  edited: /edited|hash mismatch|modified|changed after/i,
  fileCheck: /SET ROLE|SESSION AUTHORIZATION|RESET ROLE/i,
  notOwner: /current_user|poly_owner/i,
};
const ok = (r: { code: number; err: string; out: string }) => expect(r.code, r.err + r.out).toBe(0);
// ruling R6 exit codes: apply 0 / 2 divergence / 4 lock timeout / 1 other; --plan 0 / 3 pending / 2 divergence / 1 other
const refused = (r: { code: number; err: string; out: string }, re: RegExp, code = 2) => {
  expect(r.err + r.out).not.toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/); // a missing CLI also exits 1
  expect(r.code, r.err + r.out).toBe(code);
  expect(r.err + r.out).toMatch(re);
};
const T = (n: string) => `CREATE TABLE public.${n} (id int);\n`;

describe('apply', () => {
  it('applies as poly_migrator via set role poly_owner: objects owned by poly_owner, one tracking row per file', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(migrateCli(db, dir));
    expect(applied(db)).toHaveLength(2);
    expect(must(`SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname IN ('ta','tb') ORDER BY relname`, db).rows)
      .toEqual([['poly_owner'], ['poly_owner']]);
    ok(await migrateRun(db, dir)); // idempotent
    expect(applied(db)).toHaveLength(2);
  });

  it('poly_migrator holds no database CREATE and migrate still succeeds', async () => {
    const db = freshDb();
    expect(must(`SELECT has_database_privilege('poly_migrator','${db}','CREATE')`, db).rows[0][0]).toBe('f');
    ok(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])));
    expect(must(`SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='drizzle'`, db).rows[0][0]).toBe('poly_owner');
  });

  it('a failing file leaves schema and tracking unchanged (one transaction)', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_bad', sql: T('tb') + 'SELECT 1/0;\n' }]);
    const r = await migrateRun(db, dir);
    refused(r, /division by zero/i, 1);
    expect(tableExists(db, 'public.ta')).toBe(false);
    expect(psql(`SELECT 1 FROM drizzle.__drizzle_migrations`, db).out.trim() === '' ).toBe(true);
  });
});

describe('refusals apply nothing', () => {
  it('prefix mismatch: tracking rows are not a hash prefix of the journal (journal reordered)', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(await migrateRun(db, dir));
    const j = journalOf(dir);
    // swap the files behind the two applied entries, keeping `when` increasing: the journal-order check passes, the hashes diverge
    const [e0, e1] = j.entries;
    j.entries = [{ ...e0, tag: e1.tag }, { ...e1, tag: e0.tag }];
    setJournal(dir, j);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: 1_700_000_009_000, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    const r = await migrateRun(db, dir);
    refused(r, E.prefix);
    refused(await migrateRun(db, dir, ['--plan']), E.prefix); // --plan reports divergence with the same code
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });

  it('older timestamp: a new migration whose `when` precedes the last applied is refused, not skipped', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(await migrateRun(db, dir));
    const j = journalOf(dir);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: j.entries[0].when + 1, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    const r = await migrateRun(db, dir);
    refused(r, E.older);
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });

  it('edited applied file (T-91): hash differs from the tracking row, even with a pending file behind it', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    ok(await migrateRun(db, dir));
    const before = applied(db);
    rewrite(dir, '0000_a', T('ta') + '-- edited\n');
    const j = journalOf(dir);
    rewrite(dir, '0001_b', T('tb'));
    j.entries.push({ idx: 1, version: '7', when: j.entries[0].when + 5000, tag: '0001_b', breakpoints: true });
    setJournal(dir, j);
    const r = await migrateRun(db, dir);
    refused(r, E.edited);
    expect(applied(db)).toEqual(before);
    expect(tableExists(db, 'public.tb')).toBe(false);
  });

  it('file check bypassed: a file ending on SET ROLE poly_authz fails the tracking insert and rolls back the whole run', async () => {
    const db = freshDb();
    const dir = writeMigrations([
      { tag: '0000_a', sql: T('ta') },
      { tag: '0001_evil', sql: T('tb') + 'SET ROLE poly_authz;\n' },
    ]);
    // the runner does not run the role-switch scan (R8), so the privilege backstop is tested on its own
    refused(migrateCli(db, dir), /permission denied|poly_owner|__drizzle_migrations/i, 1);
    expect(tableExists(db, 'public.ta')).toBe(false);
    expect(tableExists(db, 'public.tb')).toBe(false);
    expect(psql(`SELECT count(*) FROM drizzle.__drizzle_migrations`, db).out.trim()).toBe('0');
  });
});

describe('role preflight (addendum 1): roles and poly_migrator memberships must be exactly roles.sql\'s, before the lock', () => {
  it('a missing membership: exit 2, nothing applied', async () => {
    const db = freshDb();
    must('REVOKE poly_authz FROM poly_migrator');
    try {
      refused(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])), /role|member|poly_authz|roles\.sql/i);
      expect(tableExists(db, 'public.ta')).toBe(false);
    } finally {
      must('GRANT poly_authz TO poly_migrator WITH INHERIT FALSE, SET TRUE');
    }
  });
  it('a membership with INHERIT TRUE: exit 2, nothing applied', async () => {
    const db = freshDb();
    must('GRANT poly_authz TO poly_migrator WITH INHERIT TRUE, SET TRUE');
    try {
      refused(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])), /inherit|member|poly_authz|roles\.sql/i);
      expect(tableExists(db, 'public.ta')).toBe(false);
    } finally {
      must('GRANT poly_authz TO poly_migrator WITH INHERIT FALSE, SET TRUE');
    }
  });
});

describe('URL env is refused everywhere (review 1 R2)', () => {
  for (const args of [[], ['--plan']]) {
    it(`migrate ${args.join(' ') || '(apply)'} with DATABASE_URL set: exit 1 naming it, nothing applied`, async () => {
      const db = freshDb();
      const r = await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }]), args, { DATABASE_URL: 'postgres://x@127.0.0.1:1/none' });
      refused(r, /DATABASE_URL/, 1);
      expect(tableExists(db, 'public.ta')).toBe(false);
      expect(must(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL`, db).rows[0][0]).toBe('t');
    });
  }
});

describe('journal when edited on an applied entry (review 1 R4)', () => {
  it('hash unchanged, created_at differs: apply and --plan exit 2, nothing applied', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(await migrateRun(db, dir));
    const j = journalOf(dir);
    j.entries[0].when += 1; // still strictly increasing; the file, hence its hash, is untouched
    setJournal(dir, j);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: j.entries[1].when + 5000, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    refused(migrateCli(db, dir), /created_at|when|diverg|prefix|mismatch/i);
    refused(await migrateRun(db, dir, ['--plan']), /created_at|when|diverg|prefix|mismatch/i);
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });
});

describe('role preflight, reverse direction (seceng M-2)', () => {
  const pre = (db: string) => writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
  // Addendum 2: --plan runs the preflight too. poly_backup's privilege grants are pgTAP-only in POLY-83 (01_roles.sql);
  // POLY-100 R12 added the ACL check: its cases are the T-pre table below.
  for (const args of [[], ['--plan']]) {
    it(`a stray member of a definer-owner role (GRANT poly_authz TO poly_app): ${args.join(' ') || 'apply'} exits 2 naming it`, async () => {
      const db = freshDb();
      must('GRANT poly_authz TO poly_app');
      try {
        refused(await migrateRun(db, pre(db), args), /unexpected role memberships.*poly_app/i);
        expect(tableExists(db, 'public.ta')).toBe(false);
      } finally {
        must('REVOKE poly_authz FROM poly_app');
      }
    });
    it(`poly_backup in anything but pg_read_all_data (GRANT poly_app TO poly_backup): ${args.join(' ') || 'apply'} exits 2 naming it`, async () => {
      const db = freshDb();
      must('GRANT poly_app TO poly_backup');
      try {
        refused(await migrateRun(db, pre(db), args), /refused \(backup-acl\).*unexpected role memberships.*poly_backup/is);
        expect(tableExists(db, 'public.ta')).toBe(false);
      } finally {
        must('REVOKE poly_app FROM poly_backup');
      }
    });
  }
});

describe('journal order inside the runner', () => {
  it('non-increasing `when` in the journal: exit 2, nothing applied', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta'), when: 5000 }, { tag: '0001_b', sql: T('tb'), when: 4000 }]);
    refused(await migrateRun(db, dir), /when|strictly|increasing|order/i);
    expect(tableExists(db, 'public.ta')).toBe(false);
  });
  it('database ahead of the journal (previous image): exit 0, nothing applied or removed', async () => {
    const db = freshDb();
    ok(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }])));
    ok(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])));
    expect(applied(db)).toHaveLength(2);
  });
});

describe('--plan', () => {
  it('exits 3 with pending files listed in order, 0 when none, and writes nothing', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    const r = migrateCli(db, dir, ['--plan']);
    expect(r.code, r.err).toBe(3);
    expect(r.out.indexOf('0000_a')).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf('0001_b')).toBeGreaterThan(r.out.indexOf('0000_a'));
    expect(tableExists(db, 'public.ta')).toBe(false);
    ok(await migrateRun(db, dir));
    expect((await migrateRun(db, dir, ['--plan'])).code).toBe(0);
  });

  it('other exit code on error (unreachable database)', async () => {
    const r = await migrateRun('does_not_exist', writeMigrations([{ tag: '0000_a', sql: T('ta') }]), ['--plan']);
    expect(r.code, r.err).toBe(1);
    expect(r.err + r.out).toMatch(/does not exist|database|connect/i);
  });

  it('takes no advisory lock and writes nothing; the apply path does take one', async () => {
    const db = freshDb();
    // discover the runner's lock key from pg_locks while a slow migration runs (no knowledge of the key constant needed)
    const slow = writeMigrations([{ tag: '0000_slow', sql: 'SELECT pg_sleep(1.5);\n' + T('ts') }]);
    const child = spawn('node', ['--experimental-strip-types', MIGRATE_CLI], {
      env: { ...process.env, ...dbEnv('poly_migrator', db), POLY_MIGRATIONS_DIR: slow },
    });
    let key: string[] | null = null;
    for (let i = 0; i < 30 && !key; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const l = must(`SELECT classid, objid, objsubid FROM pg_locks WHERE locktype='advisory' AND granted`, 'postgres').rows[0];
      if (l) key = l;
    }
    expect(key, 'apply path took no advisory lock').not.toBeNull();
    await new Promise((r) => child.on('close', r));

    // new db with a pending file; hold that same lock from outside; --plan must not block, apply must wait
    const db2 = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    const [c, o] = key!;
    const hold = psqlSession(`SELECT pg_advisory_lock((${c}::bigint << 32) | ${o}::bigint); SELECT pg_sleep(3600);`, db2);
    // killing the docker-exec client would not end the in-container session: release by terminating the backend
    const release = () => { psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db2}' AND query LIKE '%pg_sleep(3600)%' AND pid <> pg_backend_pid()`); hold.kill(); };
    try {
      for (let i = 0; i < 30; i++) {
        if (must(`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted`, db2).rows[0][0] === '1') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const t0 = Date.now();
      const plan = await migrateRun(db2, dir, ['--plan']);
      expect(plan.code, plan.err).toBe(3);
      expect(Date.now() - t0, '--plan must not wait on the lock').toBeLessThan(10_000);
      expect(tableExists(db2, 'public.ta')).toBe(false);
      expect(must(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL`, db2).rows[0][0], '--plan must write nothing, not even the tracking table').toBe('t');

      const apply = spawn('node', ['--experimental-strip-types', MIGRATE_CLI], {
        env: { ...process.env, ...dbEnv('poly_migrator', db2), POLY_MIGRATIONS_DIR: dir },
      });
      let done = false;
      apply.on('close', () => (done = true));
      // the apply backend is seen waiting on the advisory lock (stronger than a fixed sleep: it proves the wait, not the delay)
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        waiting = must(`SELECT count(*) FROM pg_stat_activity WHERE datname='${db2}' AND wait_event_type='Lock' AND wait_event='advisory'`).rows[0][0] === '1';
        if (!waiting) await new Promise((r) => setTimeout(r, 100));
      }
      expect(waiting, 'apply backend must be waiting on the advisory lock (wait_event Lock/advisory)').toBe(true);
      expect(done, 'apply must wait on the held advisory lock').toBe(false);
      expect(tableExists(db2, 'public.ta')).toBe(false);
      release();
      await new Promise((r) => apply.on('close', r));
      expect(tableExists(db2, 'public.ta')).toBe(true);
    } finally {
      release();
    }
  });
});

// POLY-100 R12 / T-pre: poly_backup is exactly roles.sql's read-only role. Each fault is applied, the run is refused with
// exit 2 `refused (backup-acl)` (apply and --plan), nothing is applied, and the fault is undone (roles are cluster-global).
describe('T-pre: backup-acl preflight (R12)', () => {
  type Fault = { name: string; setup: (db: string, other: string) => string; undo: (db: string, other: string) => string; objects?: string };
  const BA = /refused \(backup-acl\)/;
  const faults: Fault[] = [
    { name: 'GRANT CREATE ON SCHEMA public', setup: () => 'GRANT CREATE ON SCHEMA public TO poly_backup', undo: () => 'REVOKE CREATE ON SCHEMA public FROM poly_backup' },
    { name: 'GRANT UPDATE (c) on a table', objects: 'CREATE TABLE public.tcol (id int, c int);',
      setup: () => 'GRANT UPDATE (c) ON public.tcol TO poly_backup', undo: () => 'REVOKE UPDATE (c) ON public.tcol FROM poly_backup' },
    { name: 'EXECUTE on a definer function', objects: 'CREATE FUNCTION public.fdef() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$; REVOKE EXECUTE ON FUNCTION public.fdef() FROM PUBLIC;',
      setup: () => 'GRANT EXECUTE ON FUNCTION public.fdef() TO poly_backup', undo: () => 'REVOKE EXECUTE ON FUNCTION public.fdef() FROM poly_backup' },
    { name: 'TEMPORARY on the database', setup: (db) => `GRANT TEMPORARY ON DATABASE ${db} TO poly_backup`, undo: (db) => `REVOKE TEMPORARY ON DATABASE ${db} FROM poly_backup` },
    { name: 'CONNECT WITH GRANT OPTION on the database', setup: (db) => `GRANT CONNECT ON DATABASE ${db} TO poly_backup WITH GRANT OPTION`, undo: (db) => `REVOKE GRANT OPTION FOR CONNECT ON DATABASE ${db} FROM poly_backup` },
    { name: 'TEMPORARY on a sibling database (ruling cc8f5ba6: every database entry must be exactly CONNECT)', setup: (_db, other) => `GRANT TEMPORARY ON DATABASE ${other} TO poly_backup`, undo: (_db, other) => `REVOKE TEMPORARY ON DATABASE ${other} FROM poly_backup` },
    { name: 'CONNECT WITH GRANT OPTION on a sibling database', setup: (_db, other) => `GRANT CONNECT ON DATABASE ${other} TO poly_backup WITH GRANT OPTION`, undo: (_db, other) => `REVOKE GRANT OPTION FOR CONNECT ON DATABASE ${other} FROM poly_backup` },
    { name: 'ALTER DEFAULT PRIVILEGES ... TO poly_backup', setup: () => 'ALTER DEFAULT PRIVILEGES FOR ROLE poly_owner IN SCHEMA public GRANT SELECT ON TABLES TO poly_backup',
      undo: () => 'ALTER DEFAULT PRIVILEGES FOR ROLE poly_owner IN SCHEMA public REVOKE SELECT ON TABLES FROM poly_backup' },
    { name: 'ALTER TABLE ... OWNER TO poly_backup', objects: 'CREATE TABLE public.town (id int);', setup: () => 'ALTER TABLE public.town OWNER TO poly_backup', undo: () => 'ALTER TABLE public.town OWNER TO poly_owner' },
    { name: 'ALTER ROLE poly_backup SET default_transaction_read_only = off', setup: () => 'ALTER ROLE poly_backup SET default_transaction_read_only = off', undo: () => 'ALTER ROLE poly_backup SET default_transaction_read_only = on' },
    { name: 'a per-database role setting for poly_backup', setup: (db) => `ALTER ROLE poly_backup IN DATABASE ${db} SET work_mem = '64MB'`, undo: (db) => `ALTER ROLE poly_backup IN DATABASE ${db} RESET ALL` },
    { name: 'GRANT poly_owner TO poly_backup', setup: () => 'GRANT poly_owner TO poly_backup', undo: () => 'REVOKE poly_owner FROM poly_backup' },
    { name: 'GRANT pg_write_all_data TO poly_backup', setup: () => 'GRANT pg_write_all_data TO poly_backup', undo: () => 'REVOKE pg_write_all_data FROM poly_backup' },
    { name: 'poly_backup ADMIN on pg_read_all_data', setup: () => 'GRANT pg_read_all_data TO poly_backup WITH ADMIN OPTION', undo: () => 'REVOKE ADMIN OPTION FOR pg_read_all_data FROM poly_backup' },
    { name: 'GRANT poly_backup TO poly_app (S5)', setup: () => 'GRANT poly_backup TO poly_app', undo: () => 'REVOKE poly_backup FROM poly_app' },
    { name: 'NOLOGIN', setup: () => 'ALTER ROLE poly_backup NOLOGIN', undo: () => 'ALTER ROLE poly_backup LOGIN' },
    { name: 'CONNECTION LIMIT 5', setup: () => 'ALTER ROLE poly_backup CONNECTION LIMIT 5', undo: () => 'ALTER ROLE poly_backup CONNECTION LIMIT 3' },
    { name: 'NOBYPASSRLS', setup: () => 'ALTER ROLE poly_backup NOBYPASSRLS', undo: () => 'ALTER ROLE poly_backup BYPASSRLS' },
    { name: 'CREATEDB', setup: () => 'ALTER ROLE poly_backup CREATEDB', undo: () => 'ALTER ROLE poly_backup NOCREATEDB' },
  ];
  for (const f of faults) {
    for (const args of [[], ['--plan']]) {
      it(`${f.name}: ${args.join(' ') || 'apply'} exits 2 refused (backup-acl), nothing applied`, async () => {
        const db = freshDb();
        const other = freshDb();
        const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
        if (f.objects) must(f.objects, db);
        must(f.setup(db, other), db);
        try {
          refused(await migrateRun(db, dir, args), BA);
          expect(tableExists(db, 'public.ta')).toBe(false);
          expect(must(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL`, db).rows[0][0]).toBe('t');
        } finally {
          must(f.undo(db, other), db);
        }
      });
    }
  }

  it('roles.sql\'s own state passes: apply exits 0, --plan exits 3 (pending) and then 0', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    const plan = await migrateRun(db, dir, ['--plan']);
    expect(plan.code, plan.err + plan.out).toBe(3);
    ok(await migrateRun(db, dir));
    expect((await migrateRun(db, dir, ['--plan'])).code).toBe(0);
  });

  it('exact CONNECT on a sibling database is exempt: a second database with poly_backup CONNECT only passes (ruling cc8f5ba6)', async () => {
    const db = freshDb();
    const other = freshDb();
    must(`GRANT CONNECT ON DATABASE ${other} TO poly_backup`, db);
    try {
      const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
      expect((await migrateRun(db, dir, ['--plan'])).code).toBe(3);
      ok(await migrateRun(db, dir));
      expect((await migrateRun(db, dir, ['--plan'])).code).toBe(0);
    } finally {
      must(`REVOKE CONNECT ON DATABASE ${other} FROM poly_backup`, db);
    }
  });

  it('CONNECT on the current database alone (roles.sql\'s own grant) passes', async () => {
    const db = freshDb();
    expect(must(`SELECT has_database_privilege('poly_backup','${db}','CONNECT')`, db).rows[0][0]).toBe('t');
    ok(await migrateRun(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])));
  });
});

// T-lock (criterion 7): two real runs of the CLI together on one slow file serialise on the advisory lock.
describe('T-lock: two migrate runs together', () => {
  it('both exit 0, one applies and one finds nothing, one tracking row, the second was seen waiting on Lock/advisory', async () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_slow', sql: 'SELECT pg_sleep(2);\n' + T('ts') }]);
    const run = () => {
      const child = spawn('node', ['--experimental-strip-types', MIGRATE_CLI], { env: { ...process.env, ...dbEnv('poly_migrator', db), POLY_MIGRATIONS_DIR: dir } });
      const r = { out: '', code: -1, done: new Promise<void>((res) => child.on('close', (c) => { r.code = c ?? -1; res(); })) };
      child.stdout.on('data', (d) => (r.out += d));
      child.stderr.on('data', (d) => (r.out += d));
      return r;
    };
    const a = run();
    const b = run();
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      seen = must(`SELECT count(*) FROM pg_stat_activity WHERE datname='${db}' AND wait_event_type='Lock' AND wait_event='advisory'`).rows[0][0] === '1';
      if (!seen) await new Promise((r) => setTimeout(r, 100));
    }
    await Promise.all([a.done, b.done]);
    expect([a.code, b.code], a.out + b.out).toEqual([0, 0]);
    const outs = [a.out, b.out];
    expect(outs.filter((o) => /applied: 0000_slow/.test(o))).toHaveLength(1);
    expect(outs.filter((o) => /nothing to apply/.test(o))).toHaveLength(1);
    expect(applied(db)).toHaveLength(1);
    expect(seen, 'the second run was seen waiting on Lock/advisory').toBe(true);
  });
});
