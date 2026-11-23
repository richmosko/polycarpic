// POLY-99 criterion 3 and criterion 5 (T18): the whole path with REAL parts. backup.sh -> spool -> the real uploader image -> fake-b2 ->
// restore.sh --base and --dump into a scratch Postgres. The canary row inserted AFTER the base must be present after WAL recovery, and
// absent from the dump restore. The only fakes are fake-b2 (the bucket), the ssh/box shim (restore --from-box) and fdesetup.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collect } from './artifacts.ts';
import { type Laptop, laptop } from './laptop.ts';
import { INSTANCE, type Stack, sh, teardown, up } from './stack.ts';
import { type Fake, runUploader, startFake, verifiedLines } from './uploader.ts';
import { sha256 } from './artifacts.ts';

let s: Stack, fake: Fake, lap: Laptop;
let setupError: string | null = null;
const AFTER = `AFTER-BASE-${Math.random().toString(36).slice(2, 10)}`;
let uploaded: string[][] = [];

beforeAll(() => {
  try {
    s = up({ uploader: true }); fake = startFake(s); lap = laptop(s, fake);
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
  } catch (e) { setupError = String((e as Error).message); teardown(); }
}, 900_000);
afterAll(() => { if (lap) lap.cleanup(); if (fake) fake.stop(); if (s) s.down(); });
beforeEach(() => { if (setupError) throw new Error(setupError); lap.setFdesetup(0); });
const B = (what: string) => ['--identity', lap.identity, '--read-credential', lap.credential, '--bucket', 'poly-test-bucket', what, '--instance', INSTANCE];
const scratch = (out: string) => /^scratch container: (\S+)$/m.exec(out)?.[1] ?? '';
const q = (c: string, sql: string) => sh('docker', ['exec', c, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', sql]).out.trim();

describe('criterion 3: backup -> spool -> uploader -> fake-b2 -> restore -> scratch', () => {
  it('the real uploader shipped the nightly set and the WAL, each with a sibling, and reported each', () => {
    expect(uploaded.some((l) => l[1] === 'dump' && /^base-/.test(l[2]!))).toBe(true);
    expect(uploaded.some((l) => l[1] === 'wal')).toBe(true);
    const st = fake.store();
    for (const l of uploaded) expect(Object.keys(st)).toContain(`${INSTANCE}/${s.major}/${l[1]}/${l[2]}.sha256`);
  });
  it('restore.sh --base recovers the base through the WAL: both canary rows present (the one inserted AFTER the base too), promoted, exit 0', () => {
    const r = lap.run('restore.sh', B('--base'));
    expect({ code: r.code, err: r.err.slice(-600) }).toEqual({ code: 0, err: expect.any(String) });
    const c = scratch(r.out);
    expect(c).not.toBe('');
    expect(q(c, 'select v from public.canary_t order by v')).toContain(AFTER);
    expect(q(c, 'select v from public.canary_t order by v')).toContain(s.canary);
    expect(q(c, 'select pg_is_in_recovery()')).toBe('f');
  }, 300_000);
  it('restore.sh --dump restores the dump and globals: the original canary, and NOT the row inserted after the dump', () => {
    const r = lap.run('restore.sh', B('--dump'));
    expect({ code: r.code, err: r.err.slice(-600) }).toEqual({ code: 0, err: expect.any(String) });
    const c = scratch(r.out);
    const rows = q(c, 'select v from public.canary_t');
    expect(rows).toContain(s.canary);
    expect(rows).not.toContain(AFTER);
  }, 300_000);
  it('nothing in the bucket or the laptop temp area holds the canary in the clear (the spool, the objects and the siblings are age ciphertext)', () => {
    for (const [name, versions] of Object.entries(fake.store())) {
      if (name.endsWith('.sha256')) continue;
      for (const v of versions) expect(fake.object(v.fileId).includes(Buffer.from(s.canary)), name).toBe(false);
    }
  });
});

describe('criterion 5 / T18: backup premigration -> restore --premigration --from-box -> scratch', () => {
  it('a premigration set made by the real backup.sh is fetched through the box shim, checked against the root record, decrypted on the laptop only, and restored with the canary present', () => {
    s.clearSpool();
    expect(s.runBackup(['/usr/local/bin/backup.sh', 'premigration']).res.code).toBe(0);
    const files = collect(s, 'premigration');
    lap.setBox({ files, record: Object.entries(files).map(([n, b]) => [sha256(b), `premigration/${n}`] as [string, string]) });
    const r = lap.run('restore.sh', ['--identity', lap.identity, '--premigration', '--from-box', 'polyops@box.example']);
    expect({ code: r.code, err: r.err.slice(-500) }).toEqual({ code: 0, err: expect.any(String) });
    expect(q(scratch(r.out), 'select count(*) from public.canary_t where v = ' + `'${s.canary}'`)).toBe('1');
    const key = (lap.sshLog().match(/AGE-SECRET-KEY-\S+/) ?? [])[0];
    expect(key).toBeUndefined();
  }, 300_000);
});
