// POLY-99 R7 (infra/restore.sh), T9-T11, T16, T17 and seceng C4-C9, C12, C7', N1. The scripts run on the host with shims for ssh, the box,
// fdesetup and uname; docker and age are logging wrappers around the real ones, the scratch Postgres is a REAL container, and the
// artifacts are REAL (backup.sh and archive-wal.sh output from the scratch stack). Mutants are copies of `infra/` with one change.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Files, collect, msToTs, plantObject, plantVersion, sha256, tsToMs } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { INSTANCE, PROJECT, type Stack, sh, teardown, up } from './stack.ts';
import { type Fake, startFake } from './uploader.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
let A: Files, B: Files, P: Files; // nightly set, a later (poisoned) nightly set, a premigration set
let tsA = '', tsB = '', tsP = '';
const POISON = `POISONED-${Math.random().toString(36).slice(2, 10)}`;
const POISON_OLD = 'x';

const setTs = (f: Files) => /-(\d{8}T\d{6}Z)\.age$/.exec(Object.keys(f)[0]!)![1]!;
const name = (f: Files, kind: string) => Object.keys(f).find((n) => n.startsWith(`${kind}-`))!;

beforeAll(() => {
  try {
    s = up({ uploader: 'stub' }); fake = startFake(s); lap = laptop(s, fake);
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'nightly']).res.code).toBe(0);
    A = collect(s, 'dump'); s.clearSpool();
    s.superSql(`UPDATE public.canary_t SET v = '${POISON}'`);
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'nightly']).res.code).toBe(0);
    B = collect(s, 'dump'); s.clearSpool();
    s.superSql(`UPDATE public.canary_t SET v = '${s.canary}'`);
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'premigration']).res.code).toBe(0);
    P = collect(s, 'premigration'); s.clearSpool();
    tsA = setTs(A); tsB = setTs(B); tsP = setTs(P);
  } catch (e) { setupError = String((e as Error).message); teardown(); }
}, 900_000);
afterAll(() => { if (lap) lap.cleanup(); if (fake) fake.stop(); if (s) s.down(); });
beforeEach(() => { if (setupError) throw new Error(setupError); fake.reset(); lap.setFdesetup(0); lap.setBox({}); });
afterEach(() => { const ids = lap.scratches(); if (ids.length) sh('docker', ['rm', '-f', '-v', ...ids]); });

/** the nightly set A as the uploader leaves it, uploaded a minute after its <TS> */
const plantA = (o: { uploadedMs?: number } = {}) => { for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n, b, o.uploadedMs ?? tsToMs(tsA) + 60_000); };
const REST_BUCKET = (extra: string[] = [], what = '--dump') => ['--identity', lap.identity, '--read-credential', lap.credential, '--bucket', 'poly-test-bucket', what, '--instance', INSTANCE, ...extra];
const scratchName = (out: string) => /^scratch container: (\S+)$/m.exec(out)?.[1] ?? '';
const canaryIn = (c: string) => sh('docker', ['exec', c, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', 'select v from public.canary_t']).out.trim();
const lastErr = (r: { err: string }) => r.err.trim().split('\n').pop() ?? '';
const noScratchStarted = () => lap.dockerCalls().filter((l) => /^run /.test(l));

describe('restore.sh usage and hygiene (R7): exit 2, the message, and nothing decrypted or started', () => {
  const none = () => { expect(lap.ageCalls()).toEqual([]); expect(noScratchStarted()).toEqual([]); expect(lap.sshLog()).toBe(''); };
  it('no arguments -> exit 2 and a `usage: restore.sh` line', () => {
    const r = lap.run('restore.sh', []);
    expect({ code: r.code, last: lastErr(r).startsWith('usage: restore.sh') }).toEqual({ code: 2, last: true });
    none();
  });
  const bad: Array<[string, string[], string]> = [
    ['both modes', ['--identity', '@ID', '--premigration', '--from-box', 'u@h', '--base', '--read-credential', '@CR', '--bucket', 'b'], 'restore.sh: choose one of --premigration, --base, --dump'],
    ['--base and --dump together', ['--identity', '@ID', '--read-credential', '@CR', '--bucket', 'b', '--base', '--dump'], 'restore.sh: choose one of --premigration, --base, --dump'],
    ['no mode', ['--identity', '@ID'], 'restore.sh: choose one of --premigration, --base, --dump'],
    ['an unknown flag', ['--identity', '@ID', '--dump', '--frobnicate'], 'restore.sh: unknown option --frobnicate'],
    ['--before that is not a UTC time', ['--identity', '@ID', '--read-credential', '@CR', '--bucket', 'b', '--dump', '--before', 'yesterday'], 'restore.sh: --before must be YYYY-MM-DDTHH:MM:SSZ'],
    ['--instance with a slash', ['--identity', '@ID', '--read-credential', '@CR', '--bucket', 'b', '--dump', '--instance', '../x'], 'restore.sh: bad --instance'],
    ['--premigration without --from-box', ['--identity', '@ID', '--premigration'], 'restore.sh: --premigration needs --from-box <user@host>'],
    ['a --from-box value that starts with a dash', ['--identity', '@ID', '--premigration', '--from-box', '-oProxyCommand=x'], 'restore.sh: bad --from-box'],
    ['a --set that is not a TS', ['--identity', '@ID', '--premigration', '--from-box', 'u@h', '--set', '1;id'], 'restore.sh: bad --set'],
    ['a host or port flag (no way to point it at a running cluster)', ['--identity', '@ID', '--dump', '--host', 'x'], 'restore.sh: unknown option --host'],
  ];
  for (const [label, args, msg] of bad) {
    it(`${label} -> exit 2 \`${msg}\``, () => {
      const r = lap.run('restore.sh', args.map((a) => (a === '@ID' ? lap.identity : a === '@CR' ? lap.credential : a)));
      expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 2, last: msg });
      none();
    });
  }
  it('an identity file that is not mode 0600 or tighter -> exit 2 `restore.sh: identity file must be mode 0600 or tighter`; a missing one too (the positive twin is every later run)', () => {
    for (const mode of [0o644, 0o640, 0o604]) {
      const r = lap.run('restore.sh', REST_BUCKET(), { identityMode: mode });
      expect({ mode, code: r.code, last: lastErr(r) }).toEqual({ mode, code: 2, last: 'restore.sh: identity file must be mode 0600 or tighter' });
    }
    const r = lap.run('restore.sh', ['--identity', join(lap.dir, 'nope'), ...REST_BUCKET().slice(2)]);
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 2, last: 'restore.sh: identity file not found' });
    none();
  });
  it('the script and its library run `ulimit -c 0`, `umask 077` and `set -euo pipefail`, and neither reads a PG* variable', () => {
    const t = ['restore.sh', 'backup/restore-lib.sh'].map((f) => readFileSync(join(lap.infra, f), 'utf8')).join('\n');
    expect(t).toMatch(/ulimit -c 0/);
    expect(t).toMatch(/umask 077/);
    expect(t).toMatch(/set -euo pipefail/);
    expect(t).not.toMatch(/\bPG(HOST|PORT|USER|PASSWORD|PASSFILE|SERVICE|DATABASE)\b/);
    expect(readFileSync(join(lap.infra, 'drill.sh'), 'utf8')).toMatch(/ulimit -c 0/);
  });
  it('C12: fdesetup reporting an unencrypted disk -> exit 2 `restore.sh: disk encryption is not active (fdesetup isactive)` and no age run; active -> it proceeds', () => {
    lap.setFdesetup(1);
    const r = lap.run('restore.sh', REST_BUCKET());
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 2, last: 'restore.sh: disk encryption is not active (fdesetup isactive)' });
    expect(lap.ageCalls()).toEqual([]);
    expect(fake.log()).toEqual([]);
    lap.setFdesetup(0);
    expect(lap.run('restore.sh', REST_BUCKET()).code).not.toBe(2); // gets past the guard (it then fails for lack of objects, a different code)
  });
  it('C8: POLY_B2_AUTH_URL must be loopback http or exactly https://api.backblazeb2.com, else exit 2 before any request', () => {
    for (const url of ['http://example.com', 'https://api.backblazeb2.com.evil.example', 'http://127.0.0.1.evil.example:9', 'ftp://127.0.0.1:1', 'https://127.0.0.1:1']) {
      const r = lap.run('restore.sh', REST_BUCKET(), { env: { POLY_B2_AUTH_URL: url } });
      expect({ url, code: r.code, last: lastErr(r) }).toEqual({ url, code: 2, last: expect.stringContaining('POLY_B2_AUTH_URL') });
    }
    expect(fake.log()).toEqual([]);
  });
  it('C8: an apiUrl or downloadUrl from b2_authorize_account that is not *.backblazeb2.com (or loopback with a loopback override) is refused, exit 5, no request after the authorize', () => {
    plantA();
    fake.ctl('api?url=https%3A%2F%2Fevil.example', { post: true });
    fake.log(); const before = fake.log().length;
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(5);
    const after = fake.log().slice(before);
    expect(after.every((l) => /b2_authorize_account/.test(l))).toBe(true);
  });
});

describe('restore --premigration --from-box (R7, T9, T16, C4, C5)', () => {
  const setP = (record = true) => lap.setBox({ files: P, record: record ? Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) : [] });
  const FROMBOX = () => ['--identity', lap.identity, '--premigration', '--from-box', 'polyops@box.example'];

  it('restores the newest set into a scratch cluster; ssh sends only list-premigration and fetch-premigration <name>, with every ruled option', () => {
    setP();
    const r = lap.run('restore.sh', FROMBOX());
    expect({ code: r.code, err: r.err.slice(-400) }).toEqual({ code: 0, err: expect.any(String) });
    const c = scratchName(r.out);
    expect(c).not.toBe('');
    expect(r.out).toContain(`connect: docker exec -it ${c} psql -U postgres`);
    expect(canaryIn(c)).toBe(s.canary);
    const ssh = lap.sshLog().split('\n').filter((l) => l.startsWith('SSH '));
    expect(ssh).toHaveLength(3); // list, then one fetch per file
    for (const l of ssh) for (const o of ['[-a]', '[-x]', '[ForwardAgent=no]', '[ClearAllForwardings=yes]', '[BatchMode=yes]']) expect(l, o).toContain(o);
    const cmds = ssh.map((l) => l.replace(/^.*\[polyops@box\.example\] /, '').replace(/\]$/, '').replace(/\] \[/g, ' '));
    expect(cmds[0]).toBe('sudo polycarpic-ops backup list-premigration');
    expect(cmds.slice(1).sort()).toEqual(Object.keys(P).map((n) => `sudo polycarpic-ops backup fetch-premigration ${n}`).sort());
  });

  it('T9: no byte of the identity and no `age -d` is ever sent over ssh (argv or stdin); decryption is a local `age -d -i <file>`; the identity is never in a docker call', () => {
    setP();
    expect(lap.run('restore.sh', FROMBOX()).code).toBe(0);
    const log = lap.sshLog();
    const key = readFileSync(lap.identity, 'utf8').split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))!;
    expect(log).not.toContain(key);
    expect(log).not.toMatch(/age -d|\[age\]|-i \[/);
    expect(log.split('\n').filter((l) => l.startsWith('STDIN ')).every((l) => l === 'STDIN ')).toBe(true);
    const ages = lap.ageCalls();
    expect(ages.length).toBeGreaterThan(0);
    for (const a of ages) expect(a.startsWith(`-d -i ${lap.identity}`)).toBe(true);
    expect(lap.dockerCalls().join('\n')).not.toContain(key);
    expect(lap.dockerCalls().join('\n')).not.toContain(lap.identity);
  });
  it('T9 RED ON THE FAULT: a mutant that sends `age -d` over ssh (the ssh line is marked `# T9`) is flagged by the same log check', () => {
    setP();
    const m = lap.mutantInfra('restore.sh', /^(.*ssh .*?)\s*# T9\s*$/m, '$1 age -d -i /nonexistent');
    lap.run('restore.sh', FROMBOX(), { infra: m });
    expect(lap.sshLog()).toMatch(/age -d|\[age\]/);
  });

  it('C4: root replaces the published dump with another valid age file -> restore exits 4 `restore.sh: <name> does not match the spool record`, no scratch started', () => {
    setP();
    const dump = name(P, 'dump');
    lap.setBox({ files: { ...P, [dump]: B[name(B, 'dump')]! }, record: Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
    const r = lap.run('restore.sh', FROMBOX());
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 4, last: `restore.sh: ${dump} does not match the spool record` });
    expect(noScratchStarted()).toEqual([]);
    expect(lap.scratches()).toEqual([]);
  });
  it('without a bucket cross-check the run prints `WARN not cross-checked against the bucket` (D1 pending: the always-required variant is pinned after the Principal chooses)', () => {
    setP();
    const r = lap.run('restore.sh', FROMBOX());
    expect(r.err + r.out).toContain('WARN not cross-checked against the bucket');
  });

  describe('T16/C5: names and text from the box are data', () => {
    const d = () => name(P, 'dump'), g = () => name(P, 'globals');
    const line = (dn: string, gn = g()) => `${tsP} ${dn} ${'a'.repeat(64)} ${gn} ${'b'.repeat(64)} pending\n`;
    const MARK = () => join(lap.dir, 'pwned');
    const evil = () => ({
      semicolon: `dump-17-1-${tsP}.age;touch ${MARK()}`, subshell: `dump-17-1-${tsP}.age$(touch ${MARK()})`,
      newline: `dump-17-1-${tsP}.age\ntouch ${MARK()}`, slash: `../dump-17-1-${tsP}.age`, backtick: `dump-17-1-${tsP}.age\`touch ${MARK()}\``,
    } as Record<string, string>);
    for (const k of ['semicolon', 'subshell', 'newline', 'slash', 'backtick']) {
      it(`a box line whose name carries ${k} -> exit 5, only the list call was sent, nothing ran on the box`, () => {
        lap.setBox({ files: P, list: line(evil()[k]!) });
        const r = lap.run('restore.sh', FROMBOX());
        expect({ code: r.code }).toEqual({ code: 5 });
        expect(lap.sshLog().split('\n').filter((l) => l.startsWith('SSH '))).toHaveLength(1);
        expect(existsSync(MARK())).toBe(false);
        expect(noScratchStarted()).toEqual([]);
      });
    }
    it('T16 RED ON THE FAULT: a mutant without the check (the line marked `# T16` removed) sends the name and the box runs it', () => {
      const m = lap.mutantInfra('restore.sh', /^.*# T16\s*$/m, ':');
      lap.setBox({ files: P, list: line(evil().semicolon!) });
      lap.run('restore.sh', FROMBOX(), { infra: m });
      expect(existsSync(MARK())).toBe(true);
    });
    it('control characters and ESC sequences in box text are replaced before anything is printed', () => {
      lap.setBox({ files: P, list: `${tsP} dump-17-1-${tsP}.age\x1b[31m\x07 ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} pending\n` });
      const r = lap.run('restore.sh', FROMBOX());
      expect(r.code).toBe(5);
      expect(r.out + r.err).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    });
    it('a tampered TS (not YYYYMMDDTHHMMSSZ) or a sha that is not 64 hex is refused (exit 5)', () => {
      for (const bad of [`2026-11-22 ${d()} ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} pending\n`, `${tsP} ${d()} xyz ${g()} ${'b'.repeat(64)} pending\n`, `${tsP} ${d()} ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} maybe\n`]) {
        lap.setBox({ files: P, list: bad });
        expect(lap.run('restore.sh', FROMBOX()).code).toBe(5);
      }
    });
    it('a `stray <n>` line from the box is shown (sanitized) and does not stop a good set', () => {
      lap.setBox({ files: P, list: `stray 2\n${line(d())}`, record: Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
      const r = lap.run('restore.sh', FROMBOX());
      expect(r.err + r.out).toContain('stray 2');
    });
  });
});

describe('restore --dump from the bucket (R7, T10, C5, C7, C7\', C9)', () => {
  const ids = (out: string) => [...out.matchAll(/^version (\S+) (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) /gm)].map((m) => m[1]!);
  it('restores the dump and globals of the newest complete set; every download matches its sibling; the restored canary is present; a WARN names the overridden auth URL', () => {
    plantA();
    const r = lap.run('restore.sh', REST_BUCKET());
    expect({ code: r.code, err: r.err.slice(-500) }).toEqual({ code: 0, err: expect.any(String) });
    expect(r.err).toContain(`WARN B2 auth URL overridden: ${fake.nativeUrl}`);
    expect(canaryIn(scratchName(r.out))).toBe(s.canary);
    const log = fake.log().join('\n');
    expect(log).toContain('b2_authorize_account');
    expect(log).not.toMatch(/^(PUT|DELETE|HEAD) /m);
    // C11: the read key and the identity reach no docker call, no age call and no output
    const key = readFileSync(lap.identity, 'utf8').split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))!;
    for (const blob of [lap.dockerCalls().join('\n'), lap.ageCalls().join('\n'), r.out, r.err, lap.sshLog()]) {
      expect(blob).not.toContain(key);
      expect(blob).not.toContain('K004FIXTUREREADAPPKEY0000000000000');
    }
  });
  it('T10: two versions of the dump and a hide marker -> exit 3 listing every version (fileId, upload time); no download', () => {
    plantA();
    const dump = name(A, 'dump');
    const v2 = plantObject(fake, s.major, 'dump', dump, B[name(B, 'dump')]!, tsToMs(tsA) + 120_000, { sibling: false });
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${dump}`, Buffer.from(''), tsToMs(tsA) + 180_000, 'hide');
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(3);
    const listed = ids(r.out + r.err);
    expect(listed.length).toBeGreaterThanOrEqual(3);
    expect(listed).toContain(v2.fileId);
    expect(fake.log().some((l) => /b2_download_file_by_id/.test(l))).toBe(false);
    expect(noScratchStarted()).toEqual([]);
  });
  it('T10: with --before the older version is downloaded and the restored canary is the original, with a WARN', () => {
    plantA();
    const dump = name(A, 'dump');
    plantObject(fake, s.major, 'dump', dump, B[name(B, 'dump')]!, tsToMs(tsA) + 120_000, { sibling: false });
    const r = lap.run('restore.sh', REST_BUCKET(['--before', new Date(tsToMs(tsA) + 90_000).toISOString().replace(/\.\d+Z/, 'Z')]));
    expect({ code: r.code, err: r.err.slice(-500) }).toEqual({ code: 0, err: expect.any(String) });
    expect(r.err).toContain('WARN');
    expect(canaryIn(scratchName(r.out))).toBe(s.canary);
    expect(canaryIn(scratchName(r.out))).not.toBe(POISON);
  });
  it('T10 RED ON THE FAULT: a mutant without the two-version refusal (the line marked `# T10`) restores the newest, poisoned version', () => {
    plantA();
    const dump = name(A, 'dump');
    plantObject(fake, s.major, 'dump', dump, B[name(B, 'dump')]!, tsToMs(tsA) + 120_000, { sibling: false });
    const m = lap.mutantInfra('backup/restore-lib.sh', /^.*# T10\s*$/m, ':');
    const r = lap.run('restore.sh', REST_BUCKET(), { infra: m });
    expect(canaryIn(scratchName(r.out))).toBe(POISON);
  });
  it('C9: version 1 hidden and unsiblinged, version 2 siblinged -> the refusal lists both, and --before after v2 restores v2', () => {
    for (const [n, b] of Object.entries(A)) if (n !== name(A, 'dump')) plantObject(fake, s.major, 'dump', n, b, tsToMs(tsA) + 60_000);
    const dump = name(A, 'dump');
    const v1 = plantObject(fake, s.major, 'dump', dump, A[dump]!, tsToMs(tsA) + 60_000, { sibling: false });
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${dump}`, Buffer.from(''), tsToMs(tsA) + 70_000, 'hide');
    const v2 = plantObject(fake, s.major, 'dump', dump, A[dump]!, tsToMs(tsA) + 120_000);
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(3);
    const got = ids(r.out + r.err);
    expect(got).toContain(v1.fileId);
    expect(got).toContain(v2.fileId);
    expect(r.out + r.err).toMatch(/hide marker/i);
    const after = lap.run('restore.sh', REST_BUCKET(['--before', new Date(tsToMs(tsA) + 150_000).toISOString().replace(/\.\d+Z/, 'Z')]));
    expect(after.code).toBe(0);
  });
  it('C5: an object key that is not <instance>/<M>/<dir>/<R2 name> (`..` segments) is refused (exit 5); nothing is written outside the temp directory; files are named by fileId', () => {
    plantA();
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/../../x`, Buffer.from('payload'), tsToMs(tsA) + 60_000);
    const r = lap.run('restore.sh', REST_BUCKET(['--keep']));
    expect(r.code).toBe(5);
    expect(existsSync(join(lap.dir, 'x'))).toBe(false);
    expect(readdirSync(join(lap.dir, 'tmp')).length).toBeLessThanOrEqual(1);
  });
  it('--keep prints the decrypt directory on stderr and keeps it; without --keep nothing is left under TMPDIR', () => {
    plantA();
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(0);
    expect(readdirSync(join(lap.dir, 'tmp'))).toEqual([]);
    const k = lap.run('restore.sh', REST_BUCKET(['--keep']));
    const path = /keep(?:ing)?[: ]+(\/\S+)/i.exec(k.err)?.[1] ?? '';
    expect(existsSync(path)).toBe(true);
    expect((readdirSync(path)).every((f) => /^[A-Za-z0-9_-]+(\.\w+)?$/.test(f))).toBe(true);
  });

  describe("C7' set choice and the replay check", () => {
    it('a set whose <TS> is in the future is refused (exit 3, listed)', () => {
      const future = msToTs(Date.now() + 6 * 3600_000);
      for (const k of ['base', 'dump', 'globals']) plantObject(fake, s.major, 'dump', `${k}-${s.major}-${s.sys}-${future}.age`, Buffer.from('age-encryption.org/v1\nx'), Date.now());
      const r = lap.run('restore.sh', REST_BUCKET());
      expect(r.code).toBe(3);
      expect(r.out + r.err).toContain(future);
    });
    it('two complete nightly sets in one UTC day -> exit 3 listing both', () => {
      plantA();
      for (const [n, b] of Object.entries(B)) plantObject(fake, s.major, 'dump', n, b, tsToMs(tsB) + 60_000);
      const r = lap.run('restore.sh', REST_BUCKET());
      expect(r.code).toBe(3);
      expect(r.out + r.err).toContain(tsA);
      expect(r.out + r.err).toContain(tsB);
    });
    it('a version uploaded before its <TS>, or more than 4 h after it, is refused (exit 3); --set <TS> passes the late one with WARN late upload', () => {
      plantA({ uploadedMs: tsToMs(tsA) - 3600_000 });
      expect(lap.run('restore.sh', REST_BUCKET()).code).toBe(3);
      fake.reset();
      plantA({ uploadedMs: tsToMs(tsA) + 5 * 3600_000 });
      const refused = lap.run('restore.sh', REST_BUCKET());
      expect(refused.code).toBe(3);
      const r = lap.run('restore.sh', REST_BUCKET(['--set', tsA]));
      expect({ code: r.code, err: r.err.slice(-400) }).toEqual({ code: 0, err: expect.any(String) });
      expect(r.err).toContain('WARN late upload');
    });
    it("C7': a dump whose archive time is 2 h after its name's <TS> restores in a NIGHTLY set (window TS+3 h) and is refused (exit 4) in a PREMIGRATION set (window TS+30 min)", () => {
      const older = msToTs(tsToMs(tsA) - 2 * 3600_000);
      for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n.replace(tsA, older), b, tsToMs(tsA) + 60_000);
      const nightly = lap.run('restore.sh', REST_BUCKET());
      expect({ code: nightly.code, err: nightly.err.slice(-300) }).toEqual({ code: 0, err: expect.any(String) });
      const olderP = msToTs(tsToMs(tsP) - 2 * 3600_000);
      const renamed = Object.fromEntries(Object.entries(P).map(([n, b]) => [n.replace(tsP, olderP), b]));
      lap.setBox({ files: renamed, record: Object.entries(renamed).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
      const prem = lap.run('restore.sh', ['--identity', lap.identity, '--premigration', '--from-box', 'polyops@box.example']);
      expect(prem.code).toBe(4);
      expect(prem.out + prem.err).toMatch(/archive time|replay/i);
    }, 300_000);
    it('T17: a dump whose own archive time is more than a minute before its name\'s <TS> (an old file under a fresh name) -> exit 4, no scratch', async () => {
      const wait = tsToMs(tsA) + 75_000 - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      const fresh = msToTs(Date.now() - 5_000);
      for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n.replace(tsA, fresh), b, Date.now() - 1_000);
      const r = lap.run('restore.sh', REST_BUCKET());
      expect({ code: r.code }).toEqual({ code: 4 });
      expect(r.out + r.err).toMatch(/archive time|replay/i);
      expect(noScratchStarted()).toEqual([]);
    }, 200_000);
    it('T17 RED ON THE FAULT: a mutant without the content-time check (the line marked `# T17`) restores the replayed dump', async () => {
      const m = lap.mutantInfra('backup/restore-lib.sh', /^.*# T17\s*$/m, ':');
      const fresh = msToTs(Date.now() - 5_000);
      for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n.replace(tsA, fresh), b, Date.now() - 1_000);
      const r = lap.run('restore.sh', REST_BUCKET(), { infra: m });
      expect(r.code).toBe(0);
    }, 200_000);
  });
});

describe('the scratch cluster (R7, C6, T11)', () => {
  it('C6: docker run carries every hardening flag, a digest-pinned image, no bind mount, no environment secret, no published port', () => {
    plantA();
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(0);
    const runs = lap.dockerCalls().filter((l) => /^run /.test(l));
    expect(runs).toHaveLength(1);
    const l = runs[0]!;
    for (const f of ['--network none', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 999:999', '--pids-limit 512', '--memory 2g', 'polycarpic.restore=scratch']) expect(l, f).toContain(f);
    expect(l).toMatch(/postgres:[\w.]+@sha256:[0-9a-f]{64}/);
    expect(l).not.toMatch(/(^| )(-v|--volume|--mount|-p|--publish|-e|--env|--env-file)( |=)/);
    expect(l).not.toContain(lap.identity);
    const from = /^FROM (\S+)/m.exec(readFileSync(join(lap.infra, 'postgres', 'Dockerfile'), 'utf8'))![1]!;
    expect(l).toContain(from);
  });
  it('T11: with PGHOST/PGPORT/PGUSER pointing at a running decoy Postgres, the decoy sees no connection from restore.sh', () => {
    plantA();
    const decoy = `${PROJECT}-decoy`;
    sh('docker', ['rm', '-f', decoy]);
    expect(sh('docker', ['run', '-d', '--name', decoy, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=decoy', /^FROM (\S+)/m.exec(readFileSync(join(lap.infra, 'postgres', 'Dockerfile'), 'utf8'))![1]!, '-c', 'log_connections=on']).code).toBe(0);
    try {
      for (let i = 0; i < 40 && sh('docker', ['exec', decoy, 'pg_isready', '-U', 'postgres']).code !== 0; i++) sh('sleep', ['1']);
      const port = sh('docker', ['port', decoy, '5432/tcp']).out.trim().split(':').pop()!;
      const connections = () => (sh('docker', ['logs', decoy]).err + sh('docker', ['logs', decoy]).out).split('\n').filter((l) => /connection authorized|connection received/.test(l)).filter((l) => !/user=postgres.*database=postgres.*application_name=pg_isready/.test(l) && !/\[local\]/.test(l)).length;
      const before = connections();
      const env = { PGHOST: '127.0.0.1', PGPORT: port, PGUSER: 'postgres', PGPASSWORD: 'decoy', PGDATABASE: 'postgres' };
      const r = lap.run('restore.sh', REST_BUCKET(), { env });
      expect(r.code).toBe(0);
      expect(connections()).toBe(before);
      // the detector works: a mutant that runs one psql from the host (honouring PGHOST) is seen by the same decoy
      const m = lap.mutantInfra('restore.sh', /^(set -euo pipefail.*)$/m, "$1\npsql -X -c 'select 1' >/dev/null 2>&1 || true");
      lap.run('restore.sh', REST_BUCKET(), { env, infra: m });
      expect(connections()).toBeGreaterThan(before);
    } finally { sh('docker', ['rm', '-f', decoy]); }
  }, 300_000);
  it('restores globals first and the whole dump (never --data-only): the session handle table that comes with `session` is present (F4)', () => {
    plantA();
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(0);
    const c = scratchName(r.out);
    const roles = sh('docker', ['exec', c, 'psql', '-U', 'postgres', '-tAc', "select count(*) from pg_roles where rolname in ('poly_app','poly_backup','poly_migrator')"]).out.trim();
    expect(roles).toBe('3');
    expect(readFileSync(join(lap.infra, 'backup', 'restore-lib.sh'), 'utf8')).not.toMatch(/--data-only|\s-a\s/);
  });
});
