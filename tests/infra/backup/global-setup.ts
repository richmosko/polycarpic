// POLY-99 suite design (architect, ruling Guards @ 2bf5a6ba): ONE stack, ONE fake-b2 and ONE real set shared by every file. The globalSetup builds the two
// images, brings the stack up, takes a real nightly set, a later (poisoned) nightly set and a premigration set with the real backup.sh, collects the WAL the real
// archive-wal.sh shipped, and writes them read-only into a fixture directory. Files attach (stack.ts `attach`, uploader.ts `attachFake`) and restore any state they
// change in their own afterEach. Only backup.test.ts and roundtrip.test.ts take their own backups.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from './artifacts.ts';
import { PROJECT, sh, teardown, up, type Stack } from './stack.ts';
import { type Fake, startFake } from './uploader.ts';

let s: Stack | undefined;
let fake: Fake | undefined;

export default async function setup() {
  process.env.POLY99_PROJECT = PROJECT;
  try {
    s = up({ uploader: true });
    fake = startFake(s);
    const fx = join(s.dir, 'fixtures');
    const put = (name: string, files: Record<string, Buffer>) => {
      const d = join(fx, name);
      mkdirSync(d, { recursive: true });
      for (const [n, b] of Object.entries(files)) { writeFileSync(join(d, n), b); chmodSync(join(d, n), 0o444); }
    };
    // A: the nightly set of the original canary, then WAL; B: a later nightly set whose dump carries a poisoned row; P: a premigration set of the original
    const nightly = () => { const r = s!.runBackup(['/usr/local/bin/backup.sh', 'nightly']); if (r.res.code !== 0) throw new Error(`nightly backup failed: ${r.res.err.slice(-300)}`); };
    nightly();
    s.superSql('SELECT pg_switch_wal()');
    for (let i = 0; i < 60; i++) { if (s.ls('wal').some((n) => /^wal-\d+-\d+-[0-9A-F]{24}\.age$/.test(n))) { sh('sleep', ['3']); break; } sh('sleep', ['2']); }
    put('A', collect(s, 'dump')); put('WAL', collect(s, 'wal')); s.clearSpool();
    const poison = `POISONED-${Math.random().toString(36).slice(2, 10)}`;
    s.superSql(`UPDATE public.canary_t SET v = '${poison}'`);
    nightly();
    put('B', collect(s, 'dump')); s.clearSpool();
    s.superSql(`UPDATE public.canary_t SET v = '${s.canary}'`);
    const pr = s.runBackup(['/usr/local/bin/backup.sh', 'premigration']);
    if (pr.res.code !== 0) throw new Error(`premigration backup failed: ${pr.res.err.slice(-300)}`);
    put('P', collect(s, 'premigration')); s.clearSpool();
    writeFileSync(join(fx, 'poison'), poison);
    writeFileSync(join(s.dir, 'stack.json'), JSON.stringify(s.info));
    writeFileSync(join(s.dir, 'fake.json'), JSON.stringify({ name: fake.name, nativeUrl: fake.nativeUrl }));
    process.env.POLY99_INFO = join(s.dir, 'stack.json');
    process.env.POLY99_FAKE = join(s.dir, 'fake.json');
    process.env.POLY99_FIXTURES = fx;
  } catch (e) {
    teardown();
    throw e;
  }
  return () => { if (fake) fake.stop(); if (s) s.down(); };
}
