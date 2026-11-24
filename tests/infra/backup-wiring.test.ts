// POLY-99 R13 guards and CI wiring. No new job. The container suite (tests/infra/backup/**) runs in the existing `image` job through
// vitest.image.config.ts; the root-runner unit tests run in `provision` (unittest discovery picks them up); shellcheck is a `provision`
// step, so a change to any script it covers must select `provision`; the restore and drill tests need `age` and `pg_restore` on the runner.
// Agreed names with devops-99 by message before either commits (see test-plan.md, "Wiring pairs").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, node, steps, wf } from '../ci/helpers.ts';

const changed = (paths: string[]) => {
  const r = node('changes.mjs', { input: paths.join('\0') + '\0' });
  const out: Record<string, string> = {};
  for (const l of r.stdout.split('\n')) { const m = /^(\w+)=(true|false)$/.exec(l.trim()); if (m) out[m[1]!] = m[2]!; }
  return Object.keys(out).filter((k) => out[k] === 'true').sort();
};
const job = (n: string) => steps(wf('ci.yml').jobs[n]!);

describe('POLY-99 change filter: every path a job executes or reads selects that job', () => {
  const both: string[] = ['infra/backup/upload.sh', 'infra/backup/backup.sh', 'infra/backup/restore-lib.sh', 'infra/backup/tools.Dockerfile', 'infra/restore.sh', 'infra/drill.sh', 'infra/postgres/archive-wal.sh', 'infra/backup/systemd/polycarpic-backup.timer'];
  for (const p of both) {
    it(`${p} selects image and provision`, () => {
      const k = changed([p]);
      expect(k, p).toContain('image');
      expect(k, p).toContain('provision');
    });
  }
  it('tests/infra/backup/** selects image and not provision; tests/infra/ops/test_backup.py and tests/infra/provision/poly99.test.ts select provision', () => {
    const a = changed(['tests/infra/backup/restore.test.ts']);
    expect(a).toContain('image');
    expect(a).not.toContain('provision');
    for (const p of ['tests/infra/ops/test_backup.py', 'tests/infra/provision/poly99.test.ts']) expect(changed([p]), p).toContain('provision');
  });
});

describe('POLY-99 change key `backup` (ruling Guards @ 2bf5a6ba): the container suite runs only when one of its paths changed', () => {
  for (const p of ['infra/backup/upload.sh', 'infra/restore.sh', 'infra/drill.sh', 'infra/postgres/archive-wal.sh', 'infra/postgres/Dockerfile', 'infra/postgres/postgresql.prod.conf', 'infra/compose/prod.yml', 'infra/ops/commands/backup.py', 'infra/ops/commands/upload.py', 'packages/db/sql/roles.sql', 'tests/infra/backup/restore.test.ts']) {
    it(`${p} sets backup`, () => { expect(changed([p]), p).toContain('backup'); });
  }
  it('a PR touching none of them leaves `backup` false', () => {
    expect(changed(['apps/web/src/a.ts', 'docs/PRD/index.html', 'infra/caddy/Caddyfile'])).not.toContain('backup');
  });
});

describe('POLY-99 CI steps', () => {
  const BKRUN = /vitest run -c tests\/infra\/vitest\.backup\.config\.ts/;
  it('the backup vitest config selects tests/infra/backup/*.test.ts with the one globalSetup, and the image config no longer does', () => {
    const c = readFileSync(join(ROOT, 'tests/infra/vitest.backup.config.ts'), 'utf8');
    expect(c).toContain('tests/infra/backup/*.test.ts');
    expect(c).toContain('tests/infra/backup/global-setup.ts');
    expect(readFileSync(join(ROOT, 'tests/infra/vitest.image.config.ts'), 'utf8')).not.toContain('tests/infra/backup');
  });
  it('the image job runs the backup suite as one step, gated on the `backup` output (no new job)', () => {
    const st = job('image').find((s) => BKRUN.test(s.run ?? ''));
    expect(st, 'the backup suite step').toBeDefined();
    expect(String((st as any).if ?? '')).toContain("needs.changes.outputs.backup == 'true'");
  });
  it('the image job installs `age` and the PostgreSQL client (pg_restore) before it runs the backup suite', () => {
    const steps_ = job('image');
    const run = steps_.findIndex((s) => BKRUN.test(s.run ?? ''));
    const inst = steps_.findIndex((s) => /apt-get install[^\n]*\bage\b/.test(s.run ?? '') && /postgresql-client/.test(s.run ?? ''));
    expect(inst, 'a step that installs age and postgresql-client').toBeGreaterThan(-1);
    expect(inst).toBeLessThan(run);
  });
  it('shellcheck (a provision step) covers every POLY-99 script', () => {
    const sc = job('provision').find((s) => /shellcheck/.test(s.run ?? ''));
    expect(sc, 'shellcheck step').toBeDefined();
    for (const f of ['infra/backup/backup.sh', 'infra/backup/upload.sh', 'infra/backup/restore-lib.sh', 'infra/restore.sh', 'infra/drill.sh', 'infra/postgres/archive-wal.sh']) expect(sc!.run, f).toContain(f);
  });
  it('no new job and the unit-test discovery picks up the runner tests', () => {
    expect(Object.keys(wf('ci.yml').jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'deploy-real', 'guard', 'image', 'lint', 'provision', 'unit']);
    for (const f of ['tests/infra/ops/test_backup.py', 'tests/infra/ops/test_upload.py', 'tests/infra/ops/backup_base.py']) expect(readFileSync(join(ROOT, f), 'utf8').length).toBeGreaterThan(0);
  });
  it('the install bundle carries infra/backup and archive-wal.sh (PATHS), so the box runs the same scripts the tests ran', () => {
    const t = readFileSync(join(ROOT, 'infra/ops/install.sh'), 'utf8');
    expect(t).toContain('infra/backup');
    expect(t).toContain('infra/postgres/archive-wal.sh');
  });
});
