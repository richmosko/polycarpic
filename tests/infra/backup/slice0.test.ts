// POLY-99 R12 slice 0: `backup.sh nightly` against the scratch stack, plus the watcher's own proof (it must fail on planted plaintext,
// or a clean run proves nothing). The rest of the 99c cases are written after this goes green with the builder.
import { beforeAll, describe, expect, it } from 'vitest';
import { AGE_HEADER, R2_DUMP, type Stack, attach, sh } from './stack.ts';

let s: Stack;
let setupError: string | null = null;
beforeAll(() => {
  try { s = attach(); } catch (e) { setupError = String((e as Error).message); }
});
const need = () => { if (setupError) throw new Error(setupError); };

/** effective permission of 10005 on a spool file, from getfacl */
function effective10005(path: string): string {
  const r = s.tools(`getfacl -cp ${path}`, { rw: false });
  const line = r.out.split('\n').find((l) => l.startsWith('user:10005:'));
  if (!line) return `no user:10005 entry in: ${r.out}`;
  const m = /^user:10005:(\S+)(?:\s+#effective:(\S+))?/.exec(line)!;
  return m[2] ?? m[1]!;
}

describe('the watcher (R11) fails on what it exists to catch', () => {
  it('flags a plaintext file, a canary inside an age-looking file, and anything but the passfile appearing in /tmp', () => {
    need();
    const name = s.startBackupContainer();
    const w = s.watch(name);
    s.tools(`printf 'plain text, no header\\n' > /s/dump/dump-17-1-20260101T000000Z.age; printf '${AGE_HEADER}\\n${s.canary}\\n' > /s/dump/globals-17-1-20260101T000000Z.age; printf '${AGE_HEADER}\\nbinary\\n' > /s/dump/base-17-1-20260101T000000Z.age`);
    sh('docker', ['exec', name, 'sh', '-c', 'echo x > /tmp/stray']);
    const lines = w.stop();
    sh('docker', ['rm', '-f', name]);
    s.clearSpool();
    const v = lines.filter((l) => l.startsWith('CLOSED '));
    expect(v).toContain('CLOSED /spool/dump/dump-17-1-20260101T000000Z.age PLAINTEXT-HEADER');
    expect(v).toContain('CLOSED /spool/dump/globals-17-1-20260101T000000Z.age PLAINTEXT-CANARY');
    expect(v).toContain('CLOSED /spool/dump/base-17-1-20260101T000000Z.age OK');
    expect(lines.some((l) => /^EV CREATE .*\/tmp\/stray$/.test(l))).toBe(true);
  });
});

describe('the stack itself (harness self-test, no script under test)', () => {
  it('lets the rendered backup service reach postgres as poly_backup (ordinary and replication), read the canary table, and write an age file into .inflight/', () => {
    need();
    const script = [
      'set -eu', 'umask 077',
      `printf 'postgres:5432:polycarpic:poly_backup:qa-db_password_backup__backup-fixture\\npostgres:5432:replication:poly_backup:qa-db_password_backup__backup-fixture\\n' > /tmp/pgpass`,
      'export PGPASSFILE=/tmp/pgpass PGHOST=postgres PGUSER=poly_backup PGDATABASE=polycarpic',
      `test "$(psql -XtA -c 'select count(*) from public.canary_t')" = 1`,
      `psql -XtA "dbname=replication replication=true" -c IDENTIFY_SYSTEM | cut -d'|' -f1`,
      'pg_basebackup -Ft -X none -c fast -D - | gzip -1 | age -R /etc/backup/age-recipients.txt -o /spool/dump/.inflight/probe',
      'rm -f /spool/dump/.inflight/probe',
    ].join('\n');
    const r = s.runBackup([], { script });
    expect({ code: r.res.code, err: r.res.err.slice(-400) }).toEqual({ code: 0, err: expect.any(String) });
    expect(r.res.out.trim()).toBe(s.sys);
  });
});

describe('backup.sh nightly (R1, R12 slice 0)', () => {
  let r: ReturnType<Stack['runBackup']>;
  let names: string[] = [];

  it('exits 0 and prints, as its last stdout line, `published dump <TS> <sys> <base> <dump> <globals>`; stdout holds nothing else', () => {
    need();
    s.clearSpool();
    r = s.runBackup(['/usr/local/bin/backup.sh', 'nightly']);
    expect({ code: r.res.code, err: r.res.err.slice(-300) }).toEqual({ code: 0, err: expect.any(String) });
    const lines = r.res.out.trim().split('\n');
    expect(lines).toHaveLength(1);
    const m = /^published dump (\d{8}T\d{6}Z) (\d+) (\S+) (\S+) (\S+)$/.exec(lines[0]!);
    expect(m, lines[0]).not.toBeNull();
    const [, ts, sys, ...n] = m!;
    expect(sys).toBe(s.sys);
    names = n;
    expect(names).toEqual([`base-${s.major}-${s.sys}-${ts}.age`, `dump-${s.major}-${s.sys}-${ts}.age`, `globals-${s.major}-${s.sys}-${ts}.age`]);
  });

  it('publishes exactly the three R2 names in spool/dump/ and leaves .inflight/ empty', () => {
    need();
    expect(names).toHaveLength(3);
    const got = s.ls('dump').sort();
    expect(got).toEqual([...names].sort());
    for (const n of got) expect(R2_DUMP.test(n), n).toBe(true);
    expect(s.ls('dump', true)).toEqual([]);
    expect(s.ls('premigration')).toEqual([]);
  });

  it('gives 10005 an effective r-- on each published file (C3, T13): no chmod ever ran', () => {
    need();
    expect(names).toHaveLength(3);
    for (const n of names) expect(effective10005(`/s/dump/${n}`), n).toBe('r--');
  });

  it('the watcher saw no plaintext in the spool, no canary, and nothing in /tmp but the passfile /tmp/pgpass', () => {
    need();
    expect(r?.verdicts.length).toBeGreaterThanOrEqual(3); // one CLOSED verdict per published file at least
    const bad = r.verdicts.filter((l) => !/ (OK|TMP)$/.test(l));
    expect(bad).toEqual([]);
    const tmp = r.events.filter((l) => /\/root\/tmp\/|^EV \S+ \/tmp\//.test(l)).filter((l) => !/\/tmp\/pgpass$/.test(l));
    expect(tmp).toEqual([]);
    const spoolNames = r.events.filter((l) => / \/spool\/(dump|premigration)\//.test(l)).map((l) => l.split(' ')[2]!.replace(/^\/spool\/\w+\//, ''));
    for (const n of spoolNames) {
      const ok = n === '.inflight' || R2_DUMP.test(n) || /^\.inflight\/(base|dump|globals)-\d{2}-\d+-\d{8}T\d{6}Z\.age\.\d+$/.test(n);
      expect(ok, `unexpected spool name ${n}`).toBe(true);
    }
  });
});
