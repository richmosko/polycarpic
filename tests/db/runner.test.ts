// POLY-83 runner fixtures (POLY-76 ruling §4.4, SECURITY T-91, ARCH §6.2/§8.1). Each refusal = one fixture: the
// runner exits non-zero with the specific error, and NOTHING from the run is applied (tracking rows + tables unchanged).
// Error tokens (E.*) are the contract with backend-lead's runner messages; reconcile in this table only.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MIGRATE_CLI, applied, dbEnv, freshDb, journalOf, migrateCli, rewrite, setJournal, tableExists, writeMigrations } from './helpers/api';
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
  it('applies as poly_migrator via set role poly_owner: objects owned by poly_owner, one tracking row per file', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(migrateCli(db, dir));
    expect(applied(db)).toHaveLength(2);
    expect(must(`SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname IN ('ta','tb') ORDER BY relname`, db).rows)
      .toEqual([['poly_owner'], ['poly_owner']]);
    ok(migrateCli(db, dir)); // idempotent
    expect(applied(db)).toHaveLength(2);
  });

  it('poly_migrator holds no database CREATE and migrate still succeeds', () => {
    const db = freshDb();
    expect(must(`SELECT has_database_privilege('poly_migrator','${db}','CREATE')`, db).rows[0][0]).toBe('f');
    ok(migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])));
    expect(must(`SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='drizzle'`, db).rows[0][0]).toBe('poly_owner');
  });

  it('a failing file leaves schema and tracking unchanged (one transaction)', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_bad', sql: T('tb') + 'SELECT 1/0;\n' }]);
    const r = migrateCli(db, dir);
    refused(r, /division by zero/i, 1);
    expect(tableExists(db, 'public.ta')).toBe(false);
    expect(psql(`SELECT 1 FROM drizzle.__drizzle_migrations`, db).out.trim() === '' ).toBe(true);
  });
});

describe('refusals apply nothing', () => {
  it('prefix mismatch: tracking rows are not a hash prefix of the journal (journal reordered)', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(migrateCli(db, dir));
    const j = journalOf(dir);
    // swap the files behind the two applied entries, keeping `when` increasing: the journal-order check passes, the hashes diverge
    const [e0, e1] = j.entries;
    j.entries = [{ ...e0, tag: e1.tag }, { ...e1, tag: e0.tag }];
    setJournal(dir, j);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: 1_700_000_009_000, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    const r = migrateCli(db, dir);
    refused(r, E.prefix);
    refused(migrateCli(db, dir, ['--plan']), E.prefix); // --plan reports divergence with the same code
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });

  it('older timestamp: a new migration whose `when` precedes the last applied is refused, not skipped', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(migrateCli(db, dir));
    const j = journalOf(dir);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: j.entries[0].when + 1, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    const r = migrateCli(db, dir);
    refused(r, E.older);
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });

  it('edited applied file (T-91): hash differs from the tracking row, even with a pending file behind it', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
    ok(migrateCli(db, dir));
    const before = applied(db);
    rewrite(dir, '0000_a', T('ta') + '-- edited\n');
    const j = journalOf(dir);
    rewrite(dir, '0001_b', T('tb'));
    j.entries.push({ idx: 1, version: '7', when: j.entries[0].when + 5000, tag: '0001_b', breakpoints: true });
    setJournal(dir, j);
    const r = migrateCli(db, dir);
    refused(r, E.edited);
    expect(applied(db)).toEqual(before);
    expect(tableExists(db, 'public.tb')).toBe(false);
  });

  it('file check bypassed: a file ending on SET ROLE poly_authz fails the tracking insert and rolls back the whole run', () => {
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
  it('a missing membership: exit 2, nothing applied', () => {
    const db = freshDb();
    must('REVOKE poly_authz FROM poly_migrator');
    try {
      refused(migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])), /role|member|poly_authz|roles\.sql/i);
      expect(tableExists(db, 'public.ta')).toBe(false);
    } finally {
      must('GRANT poly_authz TO poly_migrator WITH INHERIT FALSE, SET TRUE');
    }
  });
  it('a membership with INHERIT TRUE: exit 2, nothing applied', () => {
    const db = freshDb();
    must('GRANT poly_authz TO poly_migrator WITH INHERIT TRUE, SET TRUE');
    try {
      refused(migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])), /inherit|member|poly_authz|roles\.sql/i);
      expect(tableExists(db, 'public.ta')).toBe(false);
    } finally {
      must('GRANT poly_authz TO poly_migrator WITH INHERIT FALSE, SET TRUE');
    }
  });
});

describe('URL env is refused everywhere (review 1 R2)', () => {
  for (const args of [[], ['--plan']]) {
    it(`migrate ${args.join(' ') || '(apply)'} with DATABASE_URL set: exit 1 naming it, nothing applied`, () => {
      const db = freshDb();
      const r = migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }]), args, { DATABASE_URL: 'postgres://x@127.0.0.1:1/none' });
      refused(r, /DATABASE_URL/, 1);
      expect(tableExists(db, 'public.ta')).toBe(false);
      expect(must(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL`, db).rows[0][0]).toBe('t');
    });
  }
});

describe('journal when edited on an applied entry (review 1 R4)', () => {
  it('hash unchanged, created_at differs: apply and --plan exit 2, nothing applied', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    ok(migrateCli(db, dir));
    const j = journalOf(dir);
    j.entries[0].when += 1; // still strictly increasing; the file, hence its hash, is untouched
    setJournal(dir, j);
    rewrite(dir, '0002_c', T('tc'));
    j.entries.push({ idx: 2, version: '7', when: j.entries[1].when + 5000, tag: '0002_c', breakpoints: true });
    setJournal(dir, j);
    refused(migrateCli(db, dir), /created_at|when|diverg|prefix|mismatch/i);
    refused(migrateCli(db, dir, ['--plan']), /created_at|when|diverg|prefix|mismatch/i);
    expect(applied(db)).toHaveLength(2);
    expect(tableExists(db, 'public.tc')).toBe(false);
  });
});

describe('role preflight, reverse direction (seceng M-2)', () => {
  const pre = (db: string) => writeMigrations([{ tag: '0000_a', sql: T('ta') }]);
  // FINDING (qa, 00f3e87): the preflight runs on apply only. --plan (ruling R6: "steps 3-4") reports pending (exit 3) over a
  // stray membership, and neither path looks at privilege grants (GRANT CREATE ON SCHEMA public TO poly_backup applies).
  // Those cases are `it.fails`: they pass while the gap exists and turn red the day it closes, so flip them to `it` then.
  for (const args of [[], ['--plan']]) {
    const t = args.length ? it.fails : it;
    t(`a stray member of a definer-owner role (GRANT poly_authz TO poly_app): ${args.join(' ') || 'apply'} exits 2 naming it`, () => {
      const db = freshDb();
      must('GRANT poly_authz TO poly_app');
      try {
        refused(migrateCli(db, pre(db), args), /unexpected role memberships.*poly_app/i);
        expect(tableExists(db, 'public.ta')).toBe(false);
      } finally {
        must('REVOKE poly_authz FROM poly_app');
      }
    });
    t(`poly_backup in anything but pg_read_all_data (GRANT poly_app TO poly_backup): ${args.join(' ') || 'apply'} exits 2 naming it`, () => {
      const db = freshDb();
      must('GRANT poly_app TO poly_backup');
      try {
        refused(migrateCli(db, pre(db), args), /unexpected role memberships.*poly_backup/i);
        expect(tableExists(db, 'public.ta')).toBe(false);
      } finally {
        must('REVOKE poly_app FROM poly_backup');
      }
    });
    it.fails(`an extra privilege grant to poly_backup (GRANT CREATE ON SCHEMA public): ${args.join(' ') || 'apply'} exits 2 naming the role`, () => {
      const db = freshDb();
      must('GRANT CREATE ON SCHEMA public TO poly_backup', db);
      refused(migrateCli(db, pre(db), args), /poly_backup/i);
      expect(tableExists(db, 'public.ta')).toBe(false);
    });
  }
});

describe('journal order inside the runner', () => {
  it('non-increasing `when` in the journal: exit 2, nothing applied', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta'), when: 5000 }, { tag: '0001_b', sql: T('tb'), when: 4000 }]);
    refused(migrateCli(db, dir), /when|strictly|increasing|order/i);
    expect(tableExists(db, 'public.ta')).toBe(false);
  });
  it('database ahead of the journal (previous image): exit 0, nothing applied or removed', () => {
    const db = freshDb();
    ok(migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }])));
    ok(migrateCli(db, writeMigrations([{ tag: '0000_a', sql: T('ta') }])));
    expect(applied(db)).toHaveLength(2);
  });
});

describe('--plan', () => {
  it('exits 3 with pending files listed in order, 0 when none, and writes nothing', () => {
    const db = freshDb();
    const dir = writeMigrations([{ tag: '0000_a', sql: T('ta') }, { tag: '0001_b', sql: T('tb') }]);
    const r = migrateCli(db, dir, ['--plan']);
    expect(r.code, r.err).toBe(3);
    expect(r.out.indexOf('0000_a')).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf('0001_b')).toBeGreaterThan(r.out.indexOf('0000_a'));
    expect(tableExists(db, 'public.ta')).toBe(false);
    ok(migrateCli(db, dir));
    expect(migrateCli(db, dir, ['--plan']).code).toBe(0);
  });

  it('other exit code on error (unreachable database)', () => {
    const r = migrateCli('does_not_exist', writeMigrations([{ tag: '0000_a', sql: T('ta') }]), ['--plan']);
    expect(r.code, r.err).toBe(1);
    expect(r.err + r.out).toMatch(/does not exist|database|connect/i);
  });

  it('takes no advisory lock and writes nothing; the apply path does take one', async () => {
    const db = freshDb();
    // discover the runner's lock key from pg_locks while a slow migration runs (no knowledge of the key constant needed)
    const slow = writeMigrations([{ tag: '0000_slow', sql: 'SELECT pg_sleep(4);\n' + T('ts') }]);
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
      const plan = migrateCli(db2, dir, ['--plan']);
      expect(plan.code, plan.err).toBe(3);
      expect(Date.now() - t0, '--plan must not wait on the lock').toBeLessThan(10_000);
      expect(tableExists(db2, 'public.ta')).toBe(false);
      expect(must(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL`, db2).rows[0][0], '--plan must write nothing, not even the tracking table').toBe('t');

      const apply = spawn('node', ['--experimental-strip-types', MIGRATE_CLI], {
        env: { ...process.env, ...dbEnv('poly_migrator', db2), POLY_MIGRATIONS_DIR: dir },
      });
      let done = false;
      apply.on('close', () => (done = true));
      await new Promise((r) => setTimeout(r, 3000));
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
