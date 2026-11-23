// POLY-99 R8 (infra/drill.sh): the §6.7 assertions DR1-DR11, the last line and exit code per outcome, --report. SUITE DESIGN (ruling Guards @ 2bf5a6ba): two real
// drill runs only (each restores --base and --dump into two scratch containers): one happy, and one carrying EVERY planted fault at once, whose single output
// asserts each FAIL id. The set is the globalSetup's real one (backup.sh, archive-wal.sh), planted into fake-b2 per run.
//
// Pins 34-35 (test-plan.md): output lines are `PASS|FAIL|SKIP <id> <text>`; the last line `DRILL PASSED` (0), `DRILL PASSED WITH SKIPS: <ids>` (3) or
// `DRILL FAILED: <ids>` (1); usage 2. Today's schema has no ledger, so DR9 is SKIP and the happy run is exit 3. DR8 is PASS when neither public.session nor
// app.session_handle exists. DR10 (architect, POLY-99.md @ e585d393) runs on a probe object `<instance>/drill/probe-<UTC TS>` the drill uploads with the box
// key, never on a backup object: DELETE, `PUT ?retention` and `PUT ?object-lock` must be refused; a plain PUT over the probe's name passes only if the ORIGINAL
// version (by fileId) still downloads with its original sha256. The drill must continue past a failed check so one run reports every FAIL id.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Files, fixtures, msToTs, plantObject, plantVersion, tsToMs } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { APP_KEY, INSTANCE, KEY_ID, PROJECT, type Stack, attach, sh } from './stack.ts';
import { type Fake, attachFake } from './uploader.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
let SET: Files = {}, WAL: Files = {}, B: Files = {};
let boxCred = '';

beforeAll(() => {
  try {
    s = attach(); fake = attachFake(); lap = laptop(s, fake);
    ({ A: SET, WAL, B } = fixtures());
    boxCred = join(lap.dir, 'box-credential');
    writeFileSync(boxCred, `${KEY_ID}\n${APP_KEY}\n`); chmodSync(boxCred, 0o600);
  } catch (e) { setupError = String((e as Error).message); }
});
afterAll(() => { if (lap) lap.cleanup(); if (fake) fake.reset(); });
beforeEach(() => { if (setupError) throw new Error(setupError); lap.resetLogs(); lap.setFdesetup(0); fake.reset(); });

const tsOf = (n: string) => /-(\d{8}T\d{6}Z)\.age$/.exec(n)![1]!;
const TS0 = () => tsOf(Object.keys(SET)[0]!);
/** plant the set (as the uploader leaves it) and the WAL; `rename` maps each set name, `replace` swaps the bytes of one kind, `siblingWrong` names kinds whose sibling lies */
function plant(o: { rename?: (n: string) => string; replace?: Record<string, Buffer>; siblingWrong?: string[]; uploadedMs?: number } = {}) {
  const up = o.uploadedMs ?? tsToMs(TS0()) + 60_000;
  const rn = o.rename ?? ((n: string) => n);
  for (const [n, b] of Object.entries(SET)) {
    const kind = n.split('-')[0]!;
    plantObject(fake, s.major, 'dump', rn(n), o.replace?.[kind] ?? b, up, { sibling: o.siblingWrong?.includes(kind) ? 'wrong' : true });
  }
  for (const [n, b] of Object.entries(WAL)) plantObject(fake, s.major, 'wal', n, b, up);
}
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

describe('drill.sh on the real set (R8: DR1-DR11, the last line, --report): two real runs', () => {
  it('the happy run: PASS on DR1-DR8, DR10, DR11; SKIP DR9 (no ledger yet) -> `DRILL PASSED WITH SKIPS: DR9`, exit 3; --report writes the markdown the lead files; the probe is the only new object', () => {
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
    // F3 (the repository is public): the filed form holds each object's kind and <TS>, its upload time and its sibling sha256, and every check line; it holds no
    // fileId, no bucket name, no system id and no object key
    expect(md).not.toMatch(/4_zfake_/);
    expect(md).not.toContain('poly-test-bucket');
    expect(md).not.toContain(s.sys);
    expect(md).not.toContain(`${INSTANCE}/`);
    expect(md).not.toMatch(/\b[a-z0-9_-]+\/\d{2}\/(dump|wal|premigration)\//);
    for (const n of Object.keys(SET)) { expect(md).toContain(tsOf(n)); expect(md).toMatch(new RegExp(`\\b${n.split('-')[0]}\\b`)); expect(md).not.toContain(n); }
    for (const id of ['DR1', 'DR2', 'DR3', 'DR4', 'DR5', 'DR6', 'DR7', 'DR8', 'DR9', 'DR10', 'DR11']) expect(md).toContain(id);
    expect(lap.dockerCalls().filter((l) => /^run /.test(l)).every((l) => /(^| )--rm( |$)/.test(l))).toBe(true); // an interrupted drill cannot leave a scratch behind
    expect(lap.scratches()).toEqual([]); // scratch containers are removed on exit
    const st = fake.store();
    expect(Object.keys(st).filter((n) => n.startsWith(`${INSTANCE}/drill/probe-`)).length).toBeGreaterThanOrEqual(1); // DR10 ran against a probe
    for (const n of Object.keys(st).filter((k) => !k.startsWith(`${INSTANCE}/drill/`))) expect(st[n], n).toHaveLength(1); // every backup object still has one version (DR1 next time)
    expect(r.out + r.err).not.toContain(APP_KEY);
    expect(r.out + r.err).not.toContain(readFileSync(lap.identity, 'utf8').split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))!);
    expect(lap.dockerCalls().join('\n')).not.toContain(lap.identity);
  }, 600_000);

  it('every planted fault at once: DR1 (a second version of the dump plus a hide marker), DR2 (the base sibling lies), DR3 (globals with role passwords), DR10 (a permissive bucket), DR11 (an old dump under a fresh name) -> each FAIL id is in the one output and `DRILL FAILED: …` names them all, exit 1', async () => {
    const f = join(lap.dir, 'globals-with-passwords.age');
    const mk = sh('bash', ['-c', `docker exec ${PROJECT}-postgres-1 pg_dumpall -U postgres --globals-only | age -r ${s.recipient.trim()} -o '${f}'`]);
    expect(mk.code, mk.err).toBe(0);
    const wait = tsToMs(TS0()) + 75_000 - Date.now(); // the fresh name's <TS> must be more than a minute after the dump's own archive time (DR11)
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const fresh = msToTs(Date.now() - 5_000);
    plant({ rename: (n) => n.replace(TS0(), fresh), replace: { globals: readFileSync(f) }, siblingWrong: ['base'], uploadedMs: Date.now() - 1_000 });
    const dumpName = Object.keys(SET).find((n) => n.startsWith('dump-'))!.replace(TS0(), fresh);
    plantObject(fake, s.major, 'dump', dumpName, B[Object.keys(B).find((n) => n.startsWith('dump-'))!]!, Date.now(), { sibling: false }); // DR1: a newer second version
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${dumpName}`, Buffer.from(''), Date.now() + 1_000, 'hide'); // and a hide marker after it
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/junk`, Buffer.from('junk'), Date.now()); // F1: stray objects under the instance prefix
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/../../x`, Buffer.from('x'), Date.now());
    fake.mode('permissive');
    const r = lap.run('drill.sh', DRILL());
    const c = checks(r.out);
    for (const id of ['DR1', 'DR2', 'DR3', 'DR10', 'DR11']) expect({ id, kind: c[id]?.kind, out: r.out.slice(-1500) }).toMatchObject({ id, kind: 'FAIL' });
    expect(r.out).toMatch(/hide/i);
    expect(r.out).toMatch(/\b2 stray objects?\b/); // F1: DR1 makes the stray objects loud, with a count and no names
    expect(r.out).not.toContain('junk');
    expect({ code: r.code, last: last(r.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: (?=.*\bDR1\b)(?=.*\bDR2\b)(?=.*\bDR3\b)(?=.*\bDR10\b)(?=.*\bDR11\b)/) });
    expect(lap.scratches()).toEqual([]);
  }, 900_000);
});
