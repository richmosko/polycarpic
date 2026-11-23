// POLY-99 R1, R12 (T1, T2, T13), seceng C-conditions on backup.sh. Container suite: the rendered `backup` service against the scratch
// stack (stack.ts). Each security-bearing behaviour has a mutant copy of backup.sh (never a fake of it) that the SAME check flags: the
// "red on the fault" tests assert that the fault is observable, so a check that passes with and without the fix cannot hide here.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_SH, type Res, type Stack, execText, mutate, pgContainer, recipientsPath, sh, teardown, up } from './stack.ts';

let s: Stack;
let setupError: string | null = null;
beforeAll(() => {
  try { s = up(); } catch (e) { setupError = String((e as Error).message); teardown(); }
}, 900_000);
afterAll(() => { if (s) s.down(); });
const need = () => { if (setupError) throw new Error(setupError); };
const REAL = '/usr/local/bin/backup.sh';
const text = () => readFileSync(BACKUP_SH, 'utf8');

type Run = { res: Res; verdicts: string[]; events: string[] };
/** run the real script (mutant === null) or a mutant text in the backup container, watched */
function run(args: string[], o: { mutant?: string; env?: Record<string, string>; pre?: string } = {}): Run {
  s.clearSpool();
  const name = s.startBackupContainer();
  const w = s.watch(name);
  if (o.pre) sh('docker', ['exec', name, 'bash', '-c', o.pre]);
  let res: Res;
  if (o.mutant !== undefined) {
    const e = execText(name, o.mutant, args, o.env);
    res = sh('docker', e.argv, { input: e.input });
  } else {
    const envArgs = Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    res = sh('docker', ['exec', ...envArgs, name, REAL, ...args]);
  }
  const lines = w.stop();
  sh('docker', ['rm', '-f', name]);
  return { res, verdicts: lines.filter((l) => l.startsWith('CLOSED ')), events: lines.filter((l) => l.startsWith('EV ')) };
}
const lastLine = (t: string) => t.trim().split('\n').pop() ?? '';
const nothingPublished = () => ({ dump: s.ls('dump'), dumpInflight: s.ls('dump', true), pre: s.ls('premigration'), preInflight: s.ls('premigration', true) });
const EMPTY = { dump: [], dumpInflight: [], pre: [], preInflight: [] };

/** what the watcher saw that must never happen (T1): any non-age closed file, or the canary in a closed file */
const plaintextSeen = (r: Run) => r.verdicts.filter((l) => /PLAINTEXT/.test(l));
function effective10005(path: string): string {
  const r = s.tools(`getfacl -cp ${path}`, { rw: false });
  const line = r.out.split('\n').find((l) => l.startsWith('user:10005:'));
  if (!line) return `no user:10005 entry`;
  const m = /^user:10005:(\S+)(?:\s+#effective:(\S+))?/.exec(line)!;
  return m[2] ?? m[1]!;
}

describe('backup.sh usage and preconditions (R1): exit code, exact stderr, nothing on stdout, nothing written', () => {
  const cases: Array<[string, string[], Record<string, string>, number, string]> = [
    ['no mode', [], {}, 2, 'usage: backup.sh nightly|premigration'],
    ['unknown mode', ['weekly'], {}, 2, 'usage: backup.sh nightly|premigration'],
    ['a mode with extra text', ['nightly; id'], {}, 2, 'usage: backup.sh nightly|premigration'],
    ['server major differs from the image major', ['nightly'], { PG_MAJOR: '16' }, 3, 'backup.sh: server major 17 does not match image major 16'],
  ];
  for (const [label, args, env, code, msg] of cases) {
    it(`${label} -> exit ${code} \`${msg}\``, () => {
      need();
      const r = run(args, { env });
      expect({ code: r.res.code, last: lastLine(r.res.err), out: r.res.out }).toEqual({ code, last: msg, out: '' });
      expect(nothingPublished()).toEqual(EMPTY);
    });
  }

  const rcpt = recipientsPath;
  const good = () => s.recipient.trim();
  const rcases: Array<[string, () => string]> = [
    ['two recipients', () => `${good()}\n${good()}\n`],
    ['no recipient (empty file)', () => ''],
    ['a line that is not an age1 recipient', () => 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample\n'],
    ['an age1 recipient with trailing text', () => `${good()} extra\n`],
  ];
  for (const [label, content] of rcases) {
    it(`recipients file with ${label} -> exit 3 \`backup.sh: recipients file must hold exactly one age1 recipient\`, nothing written`, () => {
      need();
      writeFileSync(rcpt(s.dir), content());
      try {
        const r = run(['nightly']);
        expect({ code: r.res.code, last: lastLine(r.res.err), out: r.res.out }).toEqual({ code: 3, last: 'backup.sh: recipients file must hold exactly one age1 recipient', out: '' });
        expect(nothingPublished()).toEqual(EMPTY);
      } finally { writeFileSync(rcpt(s.dir), s.recipient); }
    });
  }

  it('an empty password file -> exit 3 `backup.sh: db password file is empty`, nothing written, no passfile in /tmp', () => {
    need();
    const r = run(['nightly'], { env: { DB_PASSWORD_FILE: '/tmp/empty' }, pre: ': > /tmp/empty' });
    expect({ code: r.res.code, last: lastLine(r.res.err), out: r.res.out }).toEqual({ code: 3, last: 'backup.sh: db password file is empty', out: '' });
    expect(nothingPublished()).toEqual(EMPTY);
    expect(r.events.filter((l) => /\/pgpass$/.test(l))).toEqual([]); // the passfile is not written before the check passes
  });

  it('the positive twin: the same invocation with the good recipient, password and major exits 0', () => {
    need();
    const r = run(['nightly']);
    expect({ code: r.res.code, err: r.res.err.slice(-200) }).toEqual({ code: 0, err: expect.any(String) });
  });
});

describe('backup.sh premigration (R1)', () => {
  let r: Run;
  it('exits 0 and prints `published premigration <TS> <sys> <dump> <globals>`; stdout holds nothing else', () => {
    need();
    r = run(['premigration']);
    expect(r.res.code).toBe(0);
    const lines = r.res.out.trim().split('\n');
    expect(lines).toHaveLength(1);
    const m = /^published premigration (\d{8}T\d{6}Z) (\d+) (\S+) (\S+)$/.exec(lines[0]!);
    expect(m, lines[0]).not.toBeNull();
    expect(m![2]).toBe(s.sys);
    expect([m![3], m![4]]).toEqual([`dump-${s.major}-${s.sys}-${m![1]}.age`, `globals-${s.major}-${s.sys}-${m![1]}.age`]);
    expect(s.ls('premigration').sort()).toEqual([m![3], m![4]].sort());
  });
  it('writes nothing to spool/dump/ (no base) and leaves both .inflight/ empty; effective r-- for 10005; no plaintext seen', () => {
    need();
    expect(s.ls('dump')).toEqual([]);
    expect(s.ls('dump', true)).toEqual([]);
    expect(s.ls('premigration', true)).toEqual([]);
    for (const n of s.ls('premigration')) expect(effective10005(`/s/premigration/${n}`), n).toBe('r--');
    expect(plaintextSeen(r)).toEqual([]);
  });
});

describe('backup.sh leftovers (R1: each mode removes leftovers in its own .inflight/)', () => {
  it('a stale temporary in .inflight/ is gone after a good run; the sibling mode\'s .inflight/ is not touched', () => {
    need();
    s.clearSpool();
    s.tools('printf stale > /s/dump/.inflight/old.1 && chown 10004:10004 /s/dump/.inflight/old.1; printf keep > /s/premigration/.inflight/other.2 && chown 10004:10004 /s/premigration/.inflight/other.2');
    const name = s.startBackupContainer();
    const res = sh('docker', ['exec', name, REAL, 'nightly']);
    sh('docker', ['rm', '-f', name]);
    expect(res.code).toBe(0);
    expect(s.ls('dump', true)).toEqual([]);
    expect(s.ls('premigration', true)).toEqual(['other.2']);
    s.clearSpool();
  });
});

describe('T1: no plaintext in the spool, ever (the watcher is the check; the mutant is the fault)', () => {
  it('the real nightly run: the watcher saw only age files and no canary', () => {
    need();
    const r = run(['nightly']);
    expect(r.res.code).toBe(0);
    expect(r.verdicts.filter((l) => /OK$/.test(l)).length).toBeGreaterThanOrEqual(3);
    expect(plaintextSeen(r)).toEqual([]);
  });
  it('RED ON THE FAULT: a mutant that writes pg_dump output to .inflight/ before encrypting is flagged by the same watcher', () => {
    need();
    const m = mutate(text(), 'pg_dump -Fc | age -R "$rcpt" -o "$t"', 'pg_dump -Fc > "$t.plain"; age -R "$rcpt" -o "$t" < "$t.plain"; rm -f "$t.plain"');
    const r = run(['nightly'], { mutant: m });
    expect(r.res.code).toBe(0); // the mutant otherwise works, which is what makes it dangerous
    const bad = plaintextSeen(r);
    expect(bad.some((l) => /\.plain PLAINTEXT-(HEADER|CANARY)$/.test(l))).toBe(true);
  });
  it('C1: a /tmp detour (a mutant dumping to /tmp) fails with no space on the 1 MiB tmpfs and publishes nothing, because the scratch dump exceeds 1 MiB', () => {
    need();
    const m = mutate(text(), 'pg_dump -Fc | age -R "$rcpt" -o "$t"', 'pg_dump -Fc > /tmp/leak && age -R "$rcpt" -o "$t" < /tmp/leak');
    const r = run(['nightly'], { mutant: m });
    expect(r.res.code).not.toBe(0);
    expect(r.res.err).toMatch(/No space left on device/i);
    expect(nothingPublished()).toEqual(EMPTY);
  });
  it('C2: `ulimit -c` is 0 inside the rendered backup container', () => {
    need();
    const name = s.startBackupContainer();
    const r = sh('docker', ['exec', name, 'bash', '-c', 'ulimit -c']);
    sh('docker', ['rm', '-f', name]);
    expect(r.out.trim()).toBe('0');
  });
  it('RED ON THE FAULT: a mutant that dumps to a file in /tmp is flagged by the /tmp rule (only /tmp/pgpass may appear)', () => {
    need();
    const m = mutate(text(), 'pg_dump -Fc | age -R "$rcpt" -o "$t"', 'pg_dump -Fc > /tmp/leak; age -R "$rcpt" -o "$t" < /tmp/leak');
    const r = run(['nightly'], { mutant: m });
    const strays = r.events.filter((l) => /\/root\/tmp\//.test(l)).filter((l) => !/\/pgpass$/.test(l));
    expect(strays.length).toBeGreaterThan(0);
  });
});

describe('T13: no chmod on spool files', () => {
  it('the real run leaves 10005 an effective r-- on every published file; the script holds no chmod, chown, or umask outside the passfile subshell', () => {
    need();
    const r = run(['nightly']);
    expect(r.res.code).toBe(0);
    for (const n of s.ls('dump')) expect(effective10005(`/s/dump/${n}`), n).toBe('r--');
    const t = text();
    expect(t).not.toMatch(/\bchmod\b|\bchown\b|\bsetfacl\b/);
    expect(t.match(/\bumask\b/g)?.length ?? 0).toBe(1);
    expect(t).toMatch(/ulimit -c 0/);
    expect(t).toMatch(/set -euo pipefail/);
  });
  it('RED ON THE FAULT: a mutant adding chmod 0600 takes away the uploader\'s read (mask rewritten), seen by the same getfacl check', () => {
    need();
    const m = mutate(text(), 'for s in $steps; do sync "$(tmpf "$s")"; done', 'for s in $steps; do chmod 0600 "$(tmpf "$s")"; sync "$(tmpf "$s")"; done');
    const r = run(['nightly'], { mutant: m });
    expect(r.res.code).toBe(0);
    const eff = s.ls('dump').map((n) => effective10005(`/s/dump/${n}`));
    expect(eff).toHaveLength(3);
    expect(eff.every((e) => e === 'r--')).toBe(false);
  });
});

describe('T2: all or nothing', () => {
  /** hold ACCESS EXCLUSIVE on the canary table so pg_dump waits, kill pg_dump's backend, and report what the script did */
  async function dumpKilled(mutant?: string) {
    s.clearSpool();
    const name = s.startBackupContainer();
    const pg = pgContainer();
    const psql = (sql: string) => sh('docker', ['exec', pg, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-tA', '-c', sql]).out.trim();
    const held = "SELECT count(*) FROM pg_locks WHERE relation = 'public.canary_t'::regclass AND mode = 'AccessExclusiveLock' AND granted";
    for (let i = 0; i < 40 && psql(held) !== '0'; i++) sh('sleep', ['0.5']); // a previous run's locker must be gone first
    const locker = spawn('docker', ['exec', pg, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-c', 'BEGIN; LOCK TABLE public.canary_t IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120)'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && psql(held) === '0'; i++) sh('sleep', ['0.5']);
    if (psql(held) === '0') throw new Error('the lock was never taken');
    const argv = mutant !== undefined ? execText(name, mutant, ['nightly']) : { argv: ['exec', name, REAL, 'nightly'], input: '' };
    const child = spawn('docker', argv.argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(argv.input);
    const done = new Promise<number>((res) => child.on('close', (c) => res(c ?? 127)));
    let killed = '';
    for (let i = 0; i < 120 && killed === ''; i++) {
      killed = psql("SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name = 'pg_dump'");
      if (killed === '0') { killed = ''; sh('sleep', ['0.5']); }
    }
    const code = await done;
    psql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(120)%' AND pid <> pg_backend_pid()");
    locker.kill();
    for (let i = 0; i < 40 && psql(held) !== '0'; i++) sh('sleep', ['0.5']);
    sh('docker', ['rm', '-f', name]);
    return { code, out, err, killed, ...nothingPublished() };
  }

  it('pg_dump killed mid-run -> exit 1 `backup.sh: dump failed`, stdout empty, nothing published (not even the finished base), .inflight/ empty', async () => {
    need();
    const r = await dumpKilled();
    expect(r.killed).not.toBe('');
    expect({ code: r.code, last: lastLine(r.err), out: r.out }).toEqual({ code: 1, last: 'backup.sh: dump failed', out: '' });
    expect({ dump: r.dump, dumpInflight: r.dumpInflight, pre: r.pre }).toEqual({ dump: [], dumpInflight: [], pre: [] });
  }, 180_000);

  it('RED ON THE FAULT: a mutant without pipefail (and errexit) publishes a truncated dump and exits 0', async () => {
    need();
    const m = mutate(text(), 'set -euo pipefail', 'set -u');
    const r = await dumpKilled(m);
    expect(r.killed).not.toBe('');
    expect(r.code).toBe(0);
    expect(r.dump.some((n) => /^dump-/.test(n))).toBe(true); // the same predicate the real test asserts the opposite of
  }, 180_000);
});
