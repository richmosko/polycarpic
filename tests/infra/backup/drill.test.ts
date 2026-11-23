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
let lastFault: { fresh: string; dumpName: string } | null = null;

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
  it('the happy run: PASS on DR1-DR8, DR10, DR11; SKIP DR9 (no ledger yet) -> `DRILL INCOMPLETE: not checked: DR9`, exit 3; --report writes the markdown the lead files; the probe is the only new object', () => {
    plant();
    const report = join(lap.dir, 'drill-report.md');
    const r = lap.run('drill.sh', DRILL(['--report', report]));
    const c = checks(r.out);
    expect({ code: r.code, last: last(r.out), err: r.err.slice(-300) }).toEqual({ code: 3, last: 'DRILL INCOMPLETE: not checked: DR9', err: expect.any(String) }); // F6(b): a skipped check is not a pass
    for (const id of ['DR1', 'DR2', 'DR3', 'DR4', 'DR5', 'DR6', 'DR7', 'DR8', 'DR10', 'DR11']) expect(c[id]?.kind, `${id}: ${JSON.stringify(c[id])}`).toBe('PASS');
    expect(c.DR9?.kind).toBe('SKIP');
    expect(c.DR8?.text, 'DR8 counts the one session the stack planted').toMatch(/\b1 sessions? counted/);
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
    const mk = sh('bash', ['-c', `docker exec ${PROJECT}-postgres-1 pg_dumpall -U postgres --globals-only | grep -v '^CREATE ROLE poly_graph;' | age -r ${s.recipient.trim()} -o '${f}'`]); // F7: one role of roles.sql missing from the dump's globals
    expect(mk.code, mk.err).toBe(0);
    const wait = tsToMs(TS0()) + 75_000 - Date.now(); // the fresh name's <TS> must be more than a minute after the dump's own archive time (DR11)
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const fresh = msToTs(Date.now() - 5_000);
    plant({ rename: (n) => n.replace(TS0(), fresh), replace: { globals: readFileSync(f) }, siblingWrong: ['base'], uploadedMs: Date.now() - 1_000 });
    const dumpName = Object.keys(SET).find((n) => n.startsWith('dump-'))!.replace(TS0(), fresh);
    plantObject(fake, s.major, 'dump', dumpName, B[Object.keys(B).find((n) => n.startsWith('dump-'))!]!, Date.now()); // DR1: a newer second version WITH its own matching sibling, so it cannot cause DR2
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${dumpName}`, Buffer.from(''), Date.now() + 1_000, 'hide'); // and a hide marker after it
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/junk`, Buffer.from('junk'), Date.now()); // F1: stray objects under the instance prefix
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/../../x`, Buffer.from('x'), Date.now());
    fake.mode('permissive');
    const r = lap.run('drill.sh', DRILL());
    lastFault = { fresh, dumpName };
    const c = checks(r.out);
    for (const id of ['DR1', 'DR2', 'DR3', 'DR10', 'DR11']) expect({ id, kind: c[id]?.kind, out: r.out.slice(-1500) }).toMatchObject({ id, kind: 'FAIL' });
    expect(r.out + r.err).toMatch(/hide/i);
    // F7: DR6 on the DUMP instance runs BEFORE roles.sql is re-run, so the missing role is seen (or, if the dump instance did not come up, DR6 fails on whichever did)
    expect(c.DR6?.kind, `DR6: ${JSON.stringify(c.DR6)}`).toBe('FAIL');
    expect(c.DR6?.text).toMatch(/poly_graph|DUMP|dump|did not|no restored/i);
    // F5: identifiers (fileIds, the bucket, `<instance>/` keys) are for the operator's terminal on stderr; stdout carries only check lines, the scratch name and the verdict
    expect(r.out).not.toMatch(/4_zfake_/);
    expect(r.out).not.toContain('poly-test-bucket');
    expect(r.out).not.toContain(`${INSTANCE}/`);
    expect(r.err).toMatch(/^version 4_zfake_\d+ /m);
    const dr1 = checks(r.out).DR1!.text;
    expect(dr1).toMatch(/\b2 stray objects?\b/); // F1: loud, with a count and no names
    expect(dr1).toContain('a chosen object has a second version or a hide marker'); // one line, both causes
    expect(r.out).not.toContain('junk');
    expect(r.err).toMatch(/base-\S+ does not match its sha256 sibling/); // DR2 comes from the base sibling alone...
    expect(r.err).not.toMatch(/dump-\S+ does not match its sha256 sibling/); // ...the dump's newest version matches its own sibling
    expect({ code: r.code, last: last(r.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: (?=.*\bDR1\b)(?=.*\bDR2\b)(?=.*\bDR3\b)(?=.*\bDR10\b)(?=.*\bDR11\b)/) });
    expect(lap.scratches()).toEqual([]);
  }, 900_000);
});

describe('each fault is proven by its own mutant (architect verdict read): the same fixture, the scratch start refused, one line of the script mutated', () => {
  const NOSCRATCH = { POLY99_SCRATCH_FAIL: '1' };
  async function faultFixture() {
    const f = join(lap.dir, 'globals-with-passwords.age');
    const mk = sh('bash', ['-c', `docker exec ${PROJECT}-postgres-1 pg_dumpall -U postgres --globals-only | age -r ${s.recipient.trim()} -o '${f}'`]);
    expect(mk.code, mk.err).toBe(0);
    const wait = tsToMs(TS0()) + 75_000 - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const fresh = msToTs(Date.now() - 5_000);
    plant({ rename: (n) => n.replace(TS0(), fresh), replace: { globals: readFileSync(f) }, siblingWrong: ['base'], uploadedMs: Date.now() - 1_000 });
    const dumpName = Object.keys(SET).find((n) => n.startsWith('dump-'))!.replace(TS0(), fresh);
    plantObject(fake, s.major, 'dump', dumpName, B[Object.keys(B).find((n) => n.startsWith('dump-'))!]!, Date.now());
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/${dumpName}`, Buffer.from(''), Date.now() + 1_000, 'hide');
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/junk`, Buffer.from('junk'), Date.now());
    plantVersion(fake, `${INSTANCE}/${s.major}/dump/../../x`, Buffer.from('x'), Date.now());
  }
  it('DR2 RED ON THE FAULT: a mutant without the sibling comparison (`if [ "$got" != "$want" ]`) reports no DR2 FAIL on the lying base sibling; the real run does', async () => {
    await faultFixture();
    const real = lap.run('drill.sh', DRILL(), { env: NOSCRATCH });
    expect(checks(real.out).DR2?.kind).toBe('FAIL');
    const m = lap.mutantInfra('backup/restore-lib.sh', /if \[ "\$got" != "\$want" \]; then/, 'if false; then');
    const mut = lap.run('drill.sh', DRILL(), { infra: m, env: NOSCRATCH });
    expect(checks(mut.out).DR2?.kind).toBe('PASS');
  }, 300_000);
  it('DR1 RED ON THE FAULT: a mutant without the two-version line (`# T10`) keeps the stray text but loses the second-version cause; the real run has both', async () => {
    await faultFixture();
    const m = lap.mutantInfra('backup/restore-lib.sh', /^.*# T10\s*$/m, ':');
    const mut = lap.run('drill.sh', DRILL(), { infra: m, env: NOSCRATCH });
    const t = checks(mut.out).DR1!.text;
    expect(t).toMatch(/\b2 stray objects?\b/);
    expect(t).not.toContain('a chosen object has a second version or a hide marker');
  }, 300_000);
});

describe('DR8 on real tables (architect, ruling R11 correction): the stack applied the migration chain and planted one session with its handle', () => {
  const NOMUT = { POLY99_NONE: '' };
  void NOMUT;
  const run = (mut: { file: string; from: RegExp; to: string }) => {
    plant();
    const m = lap.mutantInfra(mut.file, mut.from, mut.to);
    return lap.run('drill.sh', DRILL(), { infra: m });
  };
  const SQL = (q: string) => `docker exec "$SC_DUMP" psql -U postgres -X -d polycarpic -c "${q}" > /dev/null`;
  it('a mutant that deletes the handle in the dump scratch makes DR8 FAIL (a session without its handle)', () => {
    const r = run({ file: 'drill.sh', from: /^(\s*)if restore_dump; then SC_DUMP=\$SC; else SC_DUMP=''; fi\s*$/m, to: `$1if restore_dump; then SC_DUMP=$SC; else SC_DUMP=''; fi; [ -z "$SC_DUMP" ] || ${SQL('DELETE FROM app.session_handle')}` });
    expect({ kind: checks(r.out).DR8?.kind, out: r.out.slice(-900) }).toMatchObject({ kind: 'FAIL' });
    expect(last(r.out)).toMatch(/^DRILL FAILED: .*\bDR8\b/);
  }, 600_000);
  it('a mutant that drops the tables in the dump scratch makes DR8 FAIL and names them', () => {
    const r = run({ file: 'drill.sh', from: /^(\s*)if restore_dump; then SC_DUMP=\$SC; else SC_DUMP=''; fi\s*$/m, to: `$1if restore_dump; then SC_DUMP=$SC; else SC_DUMP=''; fi; [ -z "$SC_DUMP" ] || ${SQL('DROP TABLE app.session_handle; DROP TABLE public.session CASCADE')}` });
    const c = checks(r.out);
    expect(c.DR8?.kind).toBe('FAIL');
    expect(c.DR8?.text).toMatch(/public\.session/);
    expect(c.DR8?.text).toMatch(/app\.session_handle/);
  }, 600_000);
  it('a mutant that loads the dump data-only makes DR8 FAIL (INFRA F4: the whole dump, never data-only)', () => {
    const r = run({ file: 'backup/restore-lib.sh', from: /pg_restore -U postgres --create -d postgres/, to: 'pg_restore -U postgres --data-only -d postgres' });
    expect({ kind: checks(r.out).DR8?.kind, out: r.out.slice(-900) }).toMatchObject({ kind: 'FAIL' });
  }, 600_000);
});

describe('F6(a): a check that did not run fails the verdict, whichever way it went missing (seceng)', () => {
  const NOSCRATCH = { POLY99_SCRATCH_FAIL: '1' };
  it('a mutant that deletes the DR10 block (the probe and its result lines) ends `DRILL FAILED` and names DR10 as not run', () => {
    plant();
    const m = lap.mutantInfra('drill.sh', /^if \[ "\$prc" != 0 \]; then[\s\S]*?^fi$/m, ':');
    const r = lap.run('drill.sh', DRILL(), { infra: m, env: NOSCRATCH });
    expect(checks(r.out).DR10).toMatchObject({ kind: 'FAIL', text: expect.stringContaining('did not run') }); // the verdict itself reports it
    expect(r.code).toBe(1);
    expect(last(r.out)).toMatch(/^DRILL FAILED: .*\bDR10\b/);
    expect(r.out + r.err).toMatch(/DR10 did not run/);
  }, 300_000);
  it('F8: a mutant that replaces DR10\'s block with `res SKIP DR10 "probe not run"`, on an otherwise clean real run, ends `DRILL FAILED: DR10` (exit 1): a SKIP on a run with no failure is itself a failure unless it is DR9; the happy run still ends `DRILL INCOMPLETE: not checked: DR9`', () => {
    plant();
    const m = lap.mutantInfra('drill.sh', /^if \[ "\$prc" != 0 \]; then[\s\S]*?^fi$/m, 'res SKIP DR10 "probe not run"');
    const r = lap.run('drill.sh', DRILL(), { infra: m });
    const c = checks(r.out);
    expect(c.DR10?.kind).toBe('SKIP'); // the mutant did what it says
    expect(Object.entries(c).filter(([id, v]) => id !== 'DR10' && id !== 'DR9' && v.kind === 'FAIL')).toEqual([]); // no other failure to hide behind
    expect({ code: r.code, last: last(r.out) }).toEqual({ code: 1, last: expect.stringMatching(/^DRILL FAILED: .*\bDR10\b/) });
  }, 600_000);
  it('a mutant whose DR5/DR6 loop silently skips the BASE instance, while both restores succeed, ends `DRILL FAILED` naming DR5 and DR6 (one result per instance is required)', () => {
    plant();
    const m = lap.mutantInfra('drill.sh', /for which in DUMP BASE; do/, 'for which in DUMP; do');
    const r = lap.run('drill.sh', DRILL(), { infra: m });
    expect(checks(r.out).DR4?.kind).toBe('PASS'); // the base did recover: only the loop lost an instance
    expect(r.code).toBe(1);
    expect(last(r.out)).toMatch(/^DRILL FAILED: (?=.*\bDR5\b)(?=.*\bDR6\b)/);
  }, 600_000);
});

