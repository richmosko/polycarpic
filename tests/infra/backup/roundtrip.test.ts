// POLY-99 criterion 3 and criterion 5 (T18): the whole path with REAL parts. backup.sh -> spool -> the real uploader image -> fake-b2 -> restore.sh --base and
// --dump into a scratch Postgres, and a premigration set through the box shim. These are three of the suite's real scratch restores (ruling Guards @ 2bf5a6ba):
// T11's decoy rides on the --dump run, C6's flags are asserted on all three, and the F4 / C11 checks ride on them. The canary row inserted AFTER the base
// must be present after WAL recovery and absent from the dump restore.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtures, sha256 } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { INSTANCE, PROJECT, type Stack, attach, sh } from './stack.ts';
import { type Fake, attachFake, runUploader, verifiedLines } from './uploader.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
const AFTER = `AFTER-BASE-${Math.random().toString(36).slice(2, 10)}`;
let uploaded: string[][] = [];

beforeAll(() => {
  try {
    s = attach(); fake = attachFake(); lap = laptop(s, fake);
    fake.reset(); s.clearSpool();
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'nightly']).res.code).toBe(0);
    s.superSql(`INSERT INTO public.canary_t VALUES ('${AFTER}')`);
    s.superSql('SELECT pg_switch_wal()');
    for (let i = 0; i < 60; i++) { // the archiver ships the switched segment into spool/wal
      if (s.ls('wal').some((n) => /^wal-\d+-\d+-[0-9A-F]{24}\.age$/.test(n))) { sh('sleep', ['3']); break; }
      sh('sleep', ['2']);
    }
    const r = runUploader(s);
    if (r.code !== 0) throw new Error(`the real uploader failed: exit ${r.code}: ${r.err.slice(-400)}`);
    uploaded = verifiedLines(r.out);
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
afterAll(() => {
  if (lap) lap.cleanup();
  if (s) { try { s.superSql(`DELETE FROM public.canary_t WHERE v = '${AFTER}'`); } catch { /* best effort */ } s.clearSpool(); }
  if (fake) fake.reset();
});
beforeEach(() => { if (setupError) throw new Error(setupError); lap.setFdesetup(0); });
const B = (what: string) => ['--identity', lap.identity, '--read-credential', lap.credential, '--bucket', 'poly-test-bucket', what, '--instance', INSTANCE];
const scratch = (out: string) => /^scratch container: (\S+)$/m.exec(out)?.[1] ?? '';
const q = (c: string, sql: string) => sh('docker', ['exec', c, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', sql]).out.trim();
const lastRun = () => lap.dockerCalls().filter((l) => /^run /.test(l)).pop() ?? '';
/** C6: every hardening flag, a digest-pinned image, no bind mount, no environment, no published port, no identity */
function assertScratchFlags(l: string) {
  for (const f of ['--network none', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 999:999', '--pids-limit 512', '--memory 2g', 'polycarpic.restore=scratch']) expect(l, f).toContain(f);
  expect(l).toMatch(/postgres:[\w.]+@sha256:[0-9a-f]{64}/);
  expect(l).not.toMatch(/(^| )(-v|--volume|--mount|-p|--publish|-e|--env|--env-file)( |=)/);
  expect(l).not.toContain(lap.identity);
  const from = /^FROM (\S+)/m.exec(readFileSync(join(lap.infra, 'postgres', 'Dockerfile'), 'utf8'))![1]!;
  expect(l).toContain(from);
}

describe('criterion 3: backup -> spool -> uploader -> fake-b2 -> restore -> scratch', () => {
  it('the real uploader shipped the nightly set and the WAL, each with a sibling, and reported each; no plaintext canary in any object', () => {
    expect(uploaded.some((l) => l[1] === 'dump' && /^base-/.test(l[2]!))).toBe(true);
    expect(uploaded.some((l) => l[1] === 'wal')).toBe(true);
    const st = fake.store();
    for (const l of uploaded) expect(Object.keys(st)).toContain(`${INSTANCE}/${s.major}/${l[1]}/${l[2]}.sha256`);
    for (const [name, versions] of Object.entries(st)) {
      if (name.endsWith('.sha256')) continue;
      for (const v of versions) expect(fake.object(v.fileId).includes(Buffer.from(s.canary)), name).toBe(false);
    }
  });
  it('restore.sh --base recovers the base through the WAL: both canary rows present (the one inserted AFTER the base too), promoted, exit 0; C6 flags', () => {
    const r = lap.run('restore.sh', B('--base'));
    expect({ code: r.code, err: r.err.slice(-600) }).toEqual({ code: 0, err: expect.any(String) });
    const c = scratch(r.out);
    expect(c).not.toBe('');
    const rows = q(c, 'select v from public.canary_t order by v');
    expect(rows).toContain(AFTER);
    expect(rows).toContain(s.canary);
    expect(q(c, 'select pg_is_in_recovery()')).toBe('f');
    assertScratchFlags(lastRun());
    sh('docker', ['rm', '-f', '-v', c]);
  }, 300_000);
  it('restore.sh --dump restores the dump and globals (the original canary, NOT the row inserted after the dump; roles and the whole dump, F4) while PGHOST/PGPORT point at a running decoy Postgres that sees no connection (T11); C6 flags', () => {
    const decoy = `${PROJECT}-decoy`;
    sh('docker', ['rm', '-f', decoy]);
    const from = /^FROM (\S+)/m.exec(readFileSync(join(lap.infra, 'postgres', 'Dockerfile'), 'utf8'))![1]!;
    expect(sh('docker', ['run', '-d', '--name', decoy, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=decoy', from, '-c', 'log_connections=on']).code).toBe(0);
    try {
      for (let i = 0; i < 40 && sh('docker', ['exec', decoy, 'pg_isready', '-U', 'postgres']).code !== 0; i++) sh('sleep', ['1']);
      const port = sh('docker', ['port', decoy, '5432/tcp']).out.trim().split(':').pop()!;
      const connections = () => { const l = sh('docker', ['logs', decoy]); return (l.out + l.err).split('\n').filter((x) => /connection authorized|connection received/.test(x)).filter((x) => !/\[local\]|pg_isready/.test(x)).length; };
      const before = connections();
      const env = { PGHOST: '127.0.0.1', PGPORT: port, PGUSER: 'postgres', PGPASSWORD: 'decoy', PGDATABASE: 'postgres' };
      const r = lap.run('restore.sh', B('--dump'), { env });
      expect({ code: r.code, err: r.err.slice(-600) }).toEqual({ code: 0, err: expect.any(String) });
      const c = scratch(r.out);
      const rows = q(c, 'select v from public.canary_t');
      expect(rows).toContain(s.canary);
      expect(rows).not.toContain(AFTER);
      expect(q(c, "select count(*) from pg_roles where rolname in ('poly_app','poly_backup','poly_migrator')")).toBe('3');
      assertScratchFlags(lastRun());
      expect(connections()).toBe(before);
      sh('docker', ['rm', '-f', '-v', c]);
      // the detector works: a mutant that runs one psql from the host (honouring PGHOST) is seen by the same decoy (scratch start refused: nothing else restored)
      const m = lap.mutantInfra('restore.sh', /^(set -euo pipefail.*)$/m, "$1\npsql -X -c 'select 1' >/dev/null 2>&1 || true");
      lap.run('restore.sh', B('--dump'), { env: { ...env, POLY99_SCRATCH_FAIL: '1' }, infra: m });
      expect(connections()).toBeGreaterThan(before);
    } finally { sh('docker', ['rm', '-f', decoy]); }
  }, 400_000);
});

describe('criterion 5 / T18: a premigration set -> restore --premigration --from-box -> scratch', () => {
  it('the set the real backup.sh made (the globalSetup fixture) is fetched through the box shim, checked against the root record, decrypted on the laptop only, and restored with the canary present; C6 flags', () => {
    const { P } = fixtures();
    lap.setBox({ files: P, record: Object.entries(P).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
    const r = lap.run('restore.sh', ['--identity', lap.identity, '--premigration', '--from-box', 'polyops@box.example']);
    expect({ code: r.code, err: r.err.slice(-500) }).toEqual({ code: 0, err: expect.any(String) });
    const c = scratch(r.out);
    expect(q(c, `select count(*) from public.canary_t where v = '${s.canary}'`)).toBe('1');
    assertScratchFlags(lastRun());
    expect((lap.sshLog().match(/AGE-SECRET-KEY-\S+/) ?? [])[0]).toBeUndefined();
    sh('docker', ['rm', '-f', '-v', c]);
  }, 300_000);
});
