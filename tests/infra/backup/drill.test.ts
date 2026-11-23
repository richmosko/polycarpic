// POLY-99 R8 (infra/drill.sh): the §6.7 assertions DR1-DR11, the last line and exit code per outcome, --report. The drill runs restore.sh's
// selection and restore code for BOTH --base and --dump into two scratch containers, so each run is slow; the cases are few and each one
// shows a different check red. The set is REAL (backup.sh, archive-wal.sh, the real uploader) and re-planted into fake-b2 per case.
//
// Pins 34-37 (test-plan.md): output lines are `PASS|FAIL|SKIP <id> <text>`; the last line `DRILL PASSED` (0), `DRILL PASSED WITH SKIPS: <ids>`
// (3), `DRILL FAILED: <ids>` (1); usage 2. Today's schema has no ledger, so DR9 is SKIP and the happy run is exit 3. DR8 is PASS when
// neither public.session nor app.session_handle exists (nothing to check). DR10 uses the box key against the S3 half: DELETE, a conditional
// PUT (`If-None-Match: *`) over an existing name, PutObjectRetention (`?retention`) and PutObjectLockConfiguration (`?object-lock`); each must be refused.
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Files, collect, plantObject, plantVersion } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { APP_KEY, INSTANCE, KEY_ID, PROJECT, type Stack, sh, teardown, up } from './stack.ts';
import { type Fake, runUploader, startFake } from './uploader.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
let SET: Files = {}, WAL: Files = {};
let boxCred = '';

beforeAll(() => {
  try {
    s = up({ uploader: true }); fake = startFake(s); lap = laptop(s, fake);
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'nightly']).res.code).toBe(0);
    s.superSql('SELECT pg_switch_wal()');
    for (let i = 0; i < 60; i++) { if (s.ls('wal').some((n) => /^wal-\d+-\d+-[0-9A-F]{24}\.age$/.test(n))) { sh('sleep', ['3']); break; } sh('sleep', ['2']); }
    SET = collect(s, 'dump'); WAL = collect(s, 'wal');
    boxCred = join(lap.dir, 'box-credential');
    writeFileSync(boxCred, `${KEY_ID}\n${APP_KEY}\n`); chmodSync(boxCred, 0o600);
    expect(runUploader(s).code).toBe(0);
  } catch (e) { setupError = String((e as Error).message); teardown(); }
}, 900_000);
afterAll(() => { if (lap) lap.cleanup(); if (fake) fake.stop(); if (s) s.down(); });
beforeEach(() => { if (setupError) throw new Error(setupError); lap.setFdesetup(0); });

const tsOf = (n: string) => /-(\d{8}T\d{6}Z)\.age$/.exec(n)![1]!;
const tsMs = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(9, 11), +ts.slice(11, 13), +ts.slice(13, 15));
const plant = (o: { replace?: Record<string, Buffer>; sibling?: 'wrong'; hideDump?: boolean } = {}) => {
  fake.reset();
  const up_ = tsMs(tsOf(Object.keys(SET)[0]!)) + 60_000;
  for (const [n, b] of Object.entries(SET)) plantObject(fake, s.major, 'dump', n, o.replace?.[n.split('-')[0]!] ?? b, up_, { sibling: o.sibling === 'wrong' && n.startsWith('dump-') ? 'wrong' : true });
  for (const [n, b] of Object.entries(WAL)) plantObject(fake, s.major, 'wal', n, b, up_);
};
const DRILL = (extra: string[] = []) => ['--identity', lap.identity, '--read-credential', lap.credential, '--bucket', 'poly-test-bucket', '--box-credential', boxCred, '--instance', INSTANCE, ...extra];
const checks = (out: string) => Object.fromEntries(out.split('\n').flatMap((l) => { const m = /^(PASS|FAIL|SKIP) (DR\d+) ?(.*)$/.exec(l); return m ? [[m[2]!, { kind: m[1]!, text: m[3]! }]] : []; }));
const last = (out: string) => out.trim().split('\n').pop() ?? '';

describe('drill.sh usage and hygiene (R8)', () => {
  it('no arguments or a missing required option -> exit 2 with a `usage: drill.sh` line; a 0644 identity -> exit 2; nothing is decrypted or started', () => {
    for (const args of [[], DRILL().filter((a) => a !== '--box-credential' && a !== boxCred), ['--identity', lap.identity]]) {
      const r = lap.run('drill.sh', args);
      expect({ code: r.code, last: last(r.err).startsWith('usage: drill.sh') || last(r.out).startsWith('usage: drill.sh') }).toEqual({ code: 2, last: true });
    }
    const m = lap.run('drill.sh', DRILL(), { identityMode: 0o644 });
    expect(m.code).toBe(2);
    expect(lap.ageCalls()).toEqual([]);
    expect(lap.dockerCalls().filter((l) => /^run /.test(l))).toEqual([]);
  });
});

describe('drill.sh on the real set (R8: DR1-DR11, the last line, --report)', () => {
  it('the happy run: PASS on DR1-DR8, DR10, DR11; SKIP DR9 (no ledger yet) -> `DRILL PASSED WITH SKIPS: DR9`, exit 3; --report writes the markdown the lead files', () => {
    plant();
    const report = join(lap.dir, 'drill-report.md');
    const r = lap.run('drill.sh', DRILL(['--report', report]));
    const c = checks(r.out);
    expect({ code: r.code, last: last(r.out), err: r.err.slice(-300) }).toEqual({ code: 3, last: 'DRILL PASSED WITH SKIPS: DR9', err: expect.any(String) });
    for (const id of ['DR1', 'DR2', 'DR3', 'DR4', 'DR5', 'DR6', 'DR7', 'DR8', 'DR10', 'DR11']) expect(c[id]?.kind, `${id}: ${JSON.stringify(c[id])}`).toBe('PASS');
    expect(c.DR9?.kind).toBe('SKIP');
    expect(existsSync(report)).toBe(true);
    const md = readFileSync(report, 'utf8');
    expect(md).toMatch(/\d{4}-\d\d-\d\d/); // the date
    for (const n of Object.keys(SET)) expect(md).toContain(n); // object names
    expect(md).toMatch(/4_zfake_\d+/); // fileIds
    for (const id of ['DR1', 'DR10', 'DR11']) expect(md).toContain(id);
    expect(lap.scratches()).toEqual([]); // scratch containers are removed on exit
    expect(r.out + r.err).not.toContain(APP_KEY);
    expect(r.out + r.err).not.toContain(readFileSync(lap.identity, 'utf8').split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))!);
  }, 600_000);

  it('DR3: a globals file that carries role passwords is FAIL -> the last line names DR3, exit 1', () => {
    const f = join(lap.dir, 'globals-with-passwords.age');
    const rcpt = s.recipient.trim();
    const mk = sh('bash', ['-c', `docker exec ${PROJECT}-postgres-1 pg_dumpall -U postgres --globals-only | age -r ${rcpt} -o '${f}'`]);
    expect(mk.code, mk.err).toBe(0);
    plant({ replace: { globals: readFileSync(f) } });
    const r = lap.run('drill.sh', DRILL());
    const c = checks(r.out);
    expect(c.DR3?.kind, r.out.slice(-800)).toBe('FAIL');
    expect({ code: r.code, last: last(r.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: .*\bDR3\b/) });
  }, 600_000);

  it('DR10: a bucket that lets the box key delete, overwrite or change retention (fake-b2 permissive) is FAIL -> the last line names DR10, exit 1', () => {
    plant();
    fake.mode('permissive');
    const r = lap.run('drill.sh', DRILL());
    expect(checks(r.out).DR10?.kind, r.out.slice(-800)).toBe('FAIL');
    expect({ code: r.code, last: last(r.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: .*\bDR10\b/) });
  }, 600_000);

  it('DR1: a hide marker on a chosen object is FAIL and lists it; DR2: a download that differs from its sibling is FAIL', () => {
    plant();
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${Object.keys(SET).find((n) => n.startsWith('dump-'))!}`, Buffer.from(''), tsMs(tsOf(Object.keys(SET)[0]!)) + 120_000, 'hide');
    const r1 = lap.run('drill.sh', DRILL());
    expect(checks(r1.out).DR1?.kind, r1.out.slice(-800)).toBe('FAIL');
    expect(r1.out).toMatch(/hide/i);
    expect({ code: r1.code, last: last(r1.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: .*\bDR1\b/) });
    plant({ sibling: 'wrong' });
    const r2 = lap.run('drill.sh', DRILL());
    expect(checks(r2.out).DR2?.kind, r2.out.slice(-800)).toBe('FAIL');
    expect({ code: r2.code, last: last(r2.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: .*\bDR2\b/) });
  }, 900_000);
});
