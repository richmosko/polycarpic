// POLY-99 R7 (infra/restore.sh), T9-T11, T16, T17 and seceng C4-C9, C12, C7', N1. The scripts run on the host with shims for ssh, the box, fdesetup and
// uname; docker and age are logging wrappers around the real ones. SUITE DESIGN (architect, ruling Guards @ 2bf5a6ba): one shared stack and real set
// (globalSetup); a refusal asserts its code and that NO scratch was started (the fake docker log); a case that only needs to see whether the script reached
// the scratch runs with POLY99_SCRATCH_FAIL=1 (the scratch start is refused at once, so nothing is restored). This file starts ONE real scratch (T10 --before);
// the other real restores are in roundtrip.test.ts (--base, --dump, --premigration) and drill.test.ts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Files, fixtures, msToTs, plantObject, plantVersion, sha256, tsToMs } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { INSTANCE, type Stack, attach, sh } from './stack.ts';
import { type Fake, attachFake } from './uploader.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
let A: Files, B: Files, P: Files;
let tsA = '', tsB = '', tsP = '';
const setTs = (f: Files) => /-(\d{8}T\d{6}Z)\.age$/.exec(Object.keys(f)[0]!)![1]!;
const name = (f: Files, kind: string) => Object.keys(f).find((n) => n.startsWith(`${kind}-`))!;

beforeAll(() => {
  try {
    s = attach(); fake = attachFake(); lap = laptop(s, fake);
    ({ A, B, P } = fixtures());
    tsA = setTs(A); tsB = setTs(B); tsP = setTs(P);
  } catch (e) { setupError = String((e as Error).message); }
});
afterAll(() => { if (lap) lap.cleanup(); });
beforeEach(() => { if (setupError) throw new Error(setupError); fake.reset(); lap.setFdesetup(0); lap.setBox({}); });

const NOSCRATCH = { POLY99_SCRATCH_FAIL: '1' };
/** the nightly set A as the uploader leaves it, uploaded a minute after its <TS> */
const plantA = (o: { uploadedMs?: number } = {}) => { for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n, b, o.uploadedMs ?? tsToMs(tsA) + 60_000); };
const REST_BUCKET = (extra: string[] = [], what = '--dump') => ['--identity', lap.identity, '--read-credential', lap.credential, '--bucket', 'poly-test-bucket', what, '--instance', INSTANCE, ...extra];
const scratchName = (out: string) => /^scratch container: (\S+)$/m.exec(out)?.[1] ?? '';
const canaryIn = (c: string) => sh('docker', ['exec', c, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', 'select v from public.canary_t']).out.trim();
const lastErr = (r: { err: string }) => r.err.trim().split('\n').pop() ?? '';
const scratchRuns = () => lap.dockerCalls().filter((l) => /^run /.test(l));
const noScratch = () => { expect(scratchRuns()).toEqual([]); expect(lap.scratches()).toEqual([]); };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z/, 'Z');

describe('restore.sh usage and hygiene (R7): exit 2, the message, and nothing decrypted or started', () => {
  const none = () => { expect(lap.ageCalls()).toEqual([]); noScratch(); expect(lap.sshLog()).toBe(''); };
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
  it('every bad invocation exits 2 with its exact message and starts nothing (one table)', () => {
    for (const [label, args, msg] of bad) {
      const r = lap.run('restore.sh', args.map((a) => (a === '@ID' ? lap.identity : a === '@CR' ? lap.credential : a)));
      expect({ label, code: r.code, last: lastErr(r) }).toEqual({ label, code: 2, last: msg });
    }
    none();
  });
  it('an identity file that is not mode 0600 or tighter -> exit 2 `restore.sh: identity file must be mode 0600 or tighter`; a missing one too', () => {
    for (const mode of [0o644, 0o640, 0o604]) {
      const r = lap.run('restore.sh', REST_BUCKET(), { identityMode: mode });
      expect({ mode, code: r.code, last: lastErr(r) }).toEqual({ mode, code: 2, last: 'restore.sh: identity file must be mode 0600 or tighter' });
    }
    const r = lap.run('restore.sh', ['--identity', join(lap.dir, 'nope'), ...REST_BUCKET().slice(2)]);
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 2, last: 'restore.sh: identity file not found' });
    none();
  });
  it('the script and its library run `ulimit -c 0`, `umask 077` and `set -euo pipefail`, read no PG* variable and never use --data-only', () => {
    const t = ['restore.sh', 'backup/restore-lib.sh'].map((f) => readFileSync(join(lap.infra, f), 'utf8')).join('\n');
    expect(t).toMatch(/ulimit -c 0/);
    expect(t).toMatch(/umask 077/);
    expect(t).toMatch(/set -euo pipefail/);
    expect(t).not.toMatch(/\bPG(HOST|PORT|USER|PASSWORD|PASSFILE|SERVICE|DATABASE)\b/);
    expect(t).not.toMatch(/--data-only|\s-a\s/);
    expect(readFileSync(join(lap.infra, 'drill.sh'), 'utf8')).toMatch(/ulimit -c 0/);
  });
  it('C12: fdesetup reporting an unencrypted disk -> exit 2 `restore.sh: disk encryption is not active (fdesetup isactive)`, no age run, no scratch', () => {
    lap.setFdesetup(1);
    const r = lap.run('restore.sh', REST_BUCKET());
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 2, last: 'restore.sh: disk encryption is not active (fdesetup isactive)' });
    expect(lap.ageCalls()).toEqual([]);
    expect(fake.log()).toEqual([]);
    noScratch();
  });
  it('C8: POLY_B2_AUTH_URL must be loopback http or exactly https://api.backblazeb2.com, else exit 2 before any request', () => {
    for (const url of ['http://example.com', 'https://api.backblazeb2.com.evil.example', 'http://127.0.0.1.evil.example:9', 'ftp://127.0.0.1:1', 'https://127.0.0.1:1']) {
      const r = lap.run('restore.sh', REST_BUCKET(), { env: { POLY_B2_AUTH_URL: url } });
      expect({ url, code: r.code, last: lastErr(r) }).toEqual({ url, code: 2, last: expect.stringContaining('POLY_B2_AUTH_URL') });
    }
    expect(fake.log()).toEqual([]);
  });
  it('C8: an apiUrl or downloadUrl from b2_authorize_account that is not *.backblazeb2.com is refused, exit 5, no request after the authorize, no scratch', () => {
    plantA();
    fake.ctl('api?url=https%3A%2F%2Fevil.example', { post: true });
    const before = fake.log().length;
    const r = lap.run('restore.sh', REST_BUCKET());
    expect(r.code).toBe(5);
    expect(fake.log().slice(before).every((l) => /b2_authorize_account/.test(l))).toBe(true);
    noScratch();
  });
});

describe('restore --premigration --from-box (R7, T9, T16, C4, C5): everything up to the scratch, then a refused scratch start', () => {
  const setP = (files: Files = P) => lap.setBox({ files, record: Object.entries(files).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
  const FROMBOX = () => ['--identity', lap.identity, '--premigration', '--from-box', 'polyops@box.example'];

  it('ssh sends only list-premigration and fetch-premigration <name>, each with every ruled option and an empty stdin; T9: no identity byte and no `age -d` over ssh; decryption is a local `age -d -i <file>`; WARN not cross-checked', () => {
    setP();
    const r = lap.run('restore.sh', FROMBOX(), { env: NOSCRATCH });
    const ssh = lap.sshLog().split('\n').filter((l) => l.startsWith('SSH '));
    expect(ssh).toHaveLength(3); // list, then one fetch per file
    for (const l of ssh) for (const o of ['[-a]', '[-x]', '[ForwardAgent=no]', '[ClearAllForwardings=yes]', '[BatchMode=yes]']) expect(l, o).toContain(o);
    const cmds = ssh.map((l) => l.replace(/^.*\[polyops@box\.example\] /, '').replace(/\]$/, '').replace(/\] \[/g, ' '));
    expect(cmds[0]).toBe('sudo polycarpic-ops backup list-premigration');
    expect(cmds.slice(1).sort()).toEqual(Object.keys(P).map((n) => `sudo polycarpic-ops backup fetch-premigration ${n}`).sort());
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
    expect(r.err + r.out).toContain('WARN not cross-checked against the bucket'); // D1 pending: the always-required variant is pinned after the Principal chooses
    expect(scratchRuns()).toHaveLength(1); // it got as far as the scratch start
  });
  it('T9 RED ON THE FAULT: a mutant that sends `age -d` over ssh (the ssh line is marked `# T9`) is flagged by the same log check', () => {
    setP();
    const m = lap.mutantInfra('restore.sh', /^(.*ssh .*?)\s*# T9\s*$/m, '$1 age -d -i /nonexistent');
    lap.run('restore.sh', FROMBOX(), { infra: m, env: NOSCRATCH });
    expect(lap.sshLog()).toMatch(/age -d|\[age\]/);
  });
  it('C4: root replaces the published dump with another valid age file -> exit 4 `restore.sh: <name> does not match the spool record`, no scratch', () => {
    const dump = name(P, 'dump');
    lap.setBox({ files: { ...P, [dump]: B[name(B, 'dump')]! }, record: Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
    const r = lap.run('restore.sh', FROMBOX());
    expect({ code: r.code, last: lastErr(r) }).toEqual({ code: 4, last: `restore.sh: ${dump} does not match the spool record` });
    noScratch();
  });
  it("C7': a premigration dump whose archive time is 2 h after its name's <TS> is refused (exit 4: the premigration window is TS+30 min), no scratch", () => {
    const olderP = msToTs(tsToMs(tsP) - 2 * 3600_000);
    setP(Object.fromEntries(Object.entries(P).map(([n, b]) => [n.replace(tsP, olderP), b])));
    const r = lap.run('restore.sh', FROMBOX());
    expect(r.code).toBe(4);
    expect(r.out + r.err).toMatch(/archive time|replay/i);
    noScratch();
  });

  describe('T16/C5: names and text from the box are data', () => {
    const d = () => name(P, 'dump'), g = () => name(P, 'globals');
    const line = (dn: string, gn = g()) => `${tsP} ${dn} ${'a'.repeat(64)} ${gn} ${'b'.repeat(64)} pending\n`;
    const MARK = () => join(lap.dir, 'pwned');
    const evil = () => ({
      semicolon: `dump-17-1-${tsP}.age;touch ${MARK()}`, subshell: `dump-17-1-${tsP}.age$(touch ${MARK()})`,
      newline: `dump-17-1-${tsP}.age\ntouch ${MARK()}`, slash: `../dump-17-1-${tsP}.age`, backtick: `dump-17-1-${tsP}.age\`touch ${MARK()}\``,
    } as Record<string, string>);
    it('a box line whose name carries `;`, `$(…)`, a newline, `/` or a backtick -> exit 5, only the list call was sent, nothing ran on the box, no scratch (one table)', () => {
      for (const k of ['semicolon', 'subshell', 'newline', 'slash', 'backtick']) {
        lap.setBox({ files: P, list: line(evil()[k]!) });
        const before = lap.sshLog().split('\n').filter((l) => l.startsWith('SSH ')).length;
        const r = lap.run('restore.sh', FROMBOX());
        expect({ k, code: r.code }).toEqual({ k, code: 5 });
        expect({ k, calls: lap.sshLog().split('\n').filter((l) => l.startsWith('SSH ')).length - before }).toEqual({ k, calls: 1 });
        expect({ k, ran: existsSync(MARK()) }).toEqual({ k, ran: false });
      }
      noScratch();
    });
    const sshCalls = () => lap.sshLog().split('\n').filter((l) => l.startsWith('SSH ')).length;
    it('T16a RED ON THE FAULT: a mutant without the grammar check (`# T16` removed) sends a further ssh command for the hostile name (the quoting still keeps the canary away)', () => {
      const m = lap.mutantInfra('restore.sh', /^.*# T16\s*$/m, ':');
      lap.setBox({ files: P, list: line(evil().subshell!) });
      lap.run('restore.sh', FROMBOX(), { infra: m, env: NOSCRATCH });
      expect(sshCalls()).toBeGreaterThan(1);
      expect(existsSync(MARK())).toBe(false);
    });
    it('T16b RED ON THE FAULT: a mutant without the check AND without the quoting (`# T16`, `# T16q` removed) lets the box shell run the name: the canary file appears (the fake ssh runs a real sh -c)', () => {
      let m = lap.mutantInfra('restore.sh', /^.*# T16\s*$/m, ':');
      m = lap.mutantInfraFrom(m, 'restore.sh', /^(\s*)(\w+)=.*# T16q\s*$/m, '$1$2=$$1');
      lap.setBox({ files: P, list: line(evil().subshell!) });
      lap.run('restore.sh', FROMBOX(), { infra: m, env: NOSCRATCH });
      expect(existsSync(MARK())).toBe(true);
    });
    it('T16c: a mutant without the quoting only (`# T16q`) stays safe: the grammar check alone refuses the name (the quoting is an independent guard, not dead code)', () => {
      const m = lap.mutantInfra('restore.sh', /^(\s*)(\w+)=.*# T16q\s*$/m, '$1$2=$$1');
      lap.setBox({ files: P, list: line(evil().subshell!) });
      const r = lap.run('restore.sh', FROMBOX(), { infra: m });
      expect(r.code).toBe(5);
      expect(sshCalls()).toBe(1);
      expect(existsSync(MARK())).toBe(false);
    });
    it('static: the one ssh line puts `--` before the destination, and the remote command is built by one function whose quoting line is marked `# T16q`', () => {
      const t = readFileSync(join(lap.infra, 'restore.sh'), 'utf8');
      const sshLine = t.split('\n').find((l) => /# T9\s*$/.test(l)) ?? '';
      expect(sshLine).toMatch(/ssh\b.* -- /);
      expect(t.split('\n').filter((l) => /# T16q\s*$/.test(l))).toHaveLength(1);
    });
    it('control characters and ESC sequences in box text are replaced before anything is printed; a tampered TS, a sha that is not 64 hex and an unknown state are refused (exit 5)', () => {
      lap.setBox({ files: P, list: `${tsP} dump-17-1-${tsP}.age\x1b[31m\x07 ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} pending\n` });
      const r = lap.run('restore.sh', FROMBOX());
      expect(r.code).toBe(5);
      expect(r.out + r.err).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
      for (const badLine of [`2026-11-22 ${d()} ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} pending\n`, `${tsP} ${d()} xyz ${g()} ${'b'.repeat(64)} pending\n`, `${tsP} ${d()} ${'a'.repeat(64)} ${g()} ${'b'.repeat(64)} maybe\n`]) {
        lap.setBox({ files: P, list: badLine });
        expect(lap.run('restore.sh', FROMBOX()).code).toBe(5);
      }
      noScratch();
    });
    it('a `stray <n>` line from the box is shown (sanitized) and does not stop a good set', () => {
      lap.setBox({ files: P, list: `stray 2\n${line(d())}`, record: Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
      const r = lap.run('restore.sh', FROMBOX(), { env: NOSCRATCH });
      expect(r.err + r.out).toContain('stray 2');
    });
  });
});

describe("restore from the bucket (R7, T10, C5, C7, C7', C9, C11): selection, then a refused scratch start unless the case is the one real restore", () => {
  const ids = (out: string) => [...out.matchAll(/^version (\S+) (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) /gm)].map((m) => m[1]!);
  it('the dump of the newest complete set: only GETs reach fake-b2, a WARN names the overridden auth URL; the read key and the identity reach no docker call, age call or output (C11); nothing is left under TMPDIR without --keep', () => {
    plantA();
    const r = lap.run('restore.sh', REST_BUCKET(), { env: NOSCRATCH });
    expect(r.err).toContain(`WARN B2 auth URL overridden: ${fake.nativeUrl}`);
    expect(scratchRuns()).toHaveLength(1);
    const log = fake.log().join('\n');
    expect(log).toContain('b2_authorize_account');
    expect(log).not.toMatch(/^(PUT|DELETE|HEAD) /m);
    const key = readFileSync(lap.identity, 'utf8').split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))!;
    for (const blob of [lap.dockerCalls().join('\n'), lap.ageCalls().join('\n'), r.out, r.err, lap.sshLog()]) {
      expect(blob).not.toContain(key);
      expect(blob).not.toContain('K004FIXTUREREADAPPKEY0000000000000');
    }
    expect(readdirSync(join(lap.dir, 'tmp'))).toEqual([]);
  });
  it('--keep prints the decrypt directory on stderr and keeps it, named by fileId', () => {
    plantA();
    const k = lap.run('restore.sh', REST_BUCKET(['--keep']), { env: NOSCRATCH });
    const path = /keep(?:ing)?[: ]+(\/\S+)/i.exec(k.err)?.[1] ?? '';
    expect(existsSync(path)).toBe(true);
    expect(readdirSync(path).every((f) => /^[A-Za-z0-9_-]+(\.\w+)?$/.test(f))).toBe(true);
  });
  it('T10: two versions of the dump and a hide marker -> exit 3 listing every version (fileId, upload time); no download, no scratch', () => {
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
    noScratch();
  });
  it('T10 RED ON THE FAULT: a mutant without the two-version refusal (the line marked `# T10`) downloads the newest, poisoned version and goes on to the scratch', () => {
    plantA();
    const dump = name(A, 'dump');
    const v2 = plantObject(fake, s.major, 'dump', dump, B[name(B, 'dump')]!, tsToMs(tsA) + 120_000, { sibling: false });
    const m = lap.mutantInfra('backup/restore-lib.sh', /^.*# T10\s*$/m, ':');
    lap.run('restore.sh', REST_BUCKET(), { infra: m, env: NOSCRATCH });
    expect(fake.log().some((l) => l.includes(`b2_download_file_by_id?fileId=${v2.fileId}`))).toBe(true);
    expect(scratchRuns()).toHaveLength(1);
  });
  it("T10 + C7' (the one real restore here): a dump planted under a name 2 h before its archive time, with a newer poisoned version, restores the ORIGINAL with --before (nightly window TS+3 h), and warns", () => {
    const older = msToTs(tsToMs(tsA) - 2 * 3600_000);
    for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n.replace(tsA, older), b, tsToMs(tsA) + 60_000);
    plantObject(fake, s.major, 'dump', name(A, 'dump').replace(tsA, older), B[name(B, 'dump')]!, tsToMs(tsA) + 120_000, { sibling: false });
    const r = lap.run('restore.sh', REST_BUCKET(['--before', iso(tsToMs(tsA) + 90_000)]));
    expect({ code: r.code, err: r.err.slice(-500) }).toEqual({ code: 0, err: expect.any(String) });
    expect(r.err).toContain('WARN');
    const c = scratchName(r.out);
    expect(canaryIn(c)).toBe(s.canary);
    sh('docker', ['rm', '-f', '-v', c]);
  }, 300_000);
  it('C9: version 1 hidden and unsiblinged, version 2 siblinged -> the refusal lists both and names the hide marker; no scratch', () => {
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
    noScratch();
  });
  it('C5: an object key that is not <instance>/<M>/<dir>/<R2 name> (`..` segments) is refused (exit 5); nothing is written outside the temp directory; no scratch', () => {
    plantA();
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/../../x`, Buffer.from('payload'), tsToMs(tsA) + 60_000);
    const r = lap.run('restore.sh', REST_BUCKET(['--keep']));
    expect(r.code).toBe(5);
    expect(existsSync(join(lap.dir, 'x'))).toBe(false);
    noScratch();
  });

  describe("C7' set choice and the replay check", () => {
    it('refusals (exit 3, listed, no scratch): a future <TS>; two complete nightly sets in one UTC day; a version uploaded before its <TS>; one uploaded more than 4 h after it', () => {
      const future = msToTs(Date.now() + 6 * 3600_000);
      for (const k of ['base', 'dump', 'globals']) plantObject(fake, s.major, 'dump', `${k}-${s.major}-${s.sys}-${future}.age`, Buffer.from('age-encryption.org/v1\nx'), Date.now());
      let r = lap.run('restore.sh', REST_BUCKET());
      expect(r.code).toBe(3);
      expect(r.out + r.err).toContain(future);
      fake.reset();
      plantA();
      for (const [n, b] of Object.entries(B)) plantObject(fake, s.major, 'dump', n, b, tsToMs(tsB) + 60_000);
      r = lap.run('restore.sh', REST_BUCKET());
      expect(r.code).toBe(3);
      expect(r.out + r.err).toContain(tsA);
      expect(r.out + r.err).toContain(tsB);
      fake.reset();
      plantA({ uploadedMs: tsToMs(tsA) - 3600_000 });
      expect(lap.run('restore.sh', REST_BUCKET()).code).toBe(3);
      fake.reset();
      plantA({ uploadedMs: tsToMs(tsA) + 5 * 3600_000 });
      expect(lap.run('restore.sh', REST_BUCKET()).code).toBe(3);
      noScratch();
    });
    it('--set <TS> passes a late upload (more than 4 h) with `WARN late upload` and goes on to the scratch', () => {
      plantA({ uploadedMs: tsToMs(tsA) + 5 * 3600_000 });
      const r = lap.run('restore.sh', REST_BUCKET(['--set', tsA]), { env: NOSCRATCH });
      expect(r.err).toContain('WARN late upload');
      expect(scratchRuns()).toHaveLength(1);
    });
    it("T17: a dump whose own archive time is more than a minute before its name's <TS> (an old file under a fresh name) -> exit 4, no scratch; RED ON THE FAULT: a mutant without the check (`# T17`) goes on to the scratch", async () => {
      const wait = tsToMs(tsA) + 75_000 - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      const fresh = msToTs(Date.now() - 5_000);
      for (const [n, b] of Object.entries(A)) plantObject(fake, s.major, 'dump', n.replace(tsA, fresh), b, Date.now() - 1_000);
      const r = lap.run('restore.sh', REST_BUCKET());
      expect({ code: r.code }).toEqual({ code: 4 });
      expect(r.out + r.err).toMatch(/archive time|replay/i);
      noScratch();
      const m = lap.mutantInfra('backup/restore-lib.sh', /^.*# T17\s*$/m, ':');
      lap.run('restore.sh', REST_BUCKET(), { infra: m, env: NOSCRATCH });
      expect(scratchRuns()).toHaveLength(1);
    }, 200_000);
  });
});
