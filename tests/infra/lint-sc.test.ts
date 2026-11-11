// POLY-95 seceng build review SC1, SC2, SC4: fail fixtures for the bind allowlist keyed by <project>.<service>, for
// volumes that are neither bind nor tmpfs, and for backup's spool mounts. Each is the pass baseline plus ONE mutation.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, materialise, PG_IMAGE_ENV, type FxSet } from './baseline.ts';

const LINT = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra', 'lint', 'compose-policy.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function run(mut: (s: FxSet) => void) {
  const s = baseline();
  mut(s);
  const root = mkdtempSync(join(tmpdir(), 'poly95-lintsc-'));
  made.push(root);
  materialise(root, s);
  const r = spawnSync('node', [LINT, '--root', root], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' },
  });
  return { code: r.status, err: r.stderr ?? '' };
}

const ROWS: [string, (s: FxSet) => void, string][] = [
  ['SC1 staging postgres binds prod\'s data directory', (s) => { s.staging.services.postgres.volumes[0] = '/srv/polycarpic/pg-prod:/var/lib/postgresql/data'; }, 'mount-allowlist'],
  ['SC1 prod postgres mounts the staging pg_hba', (s) => { s.prod.services.postgres.volumes[2] = '../postgres/pg_hba.staging.conf:/etc/postgresql/pg_hba.conf:ro'; }, 'mount-allowlist'],
  ['SC1 prod postgres mounts the staging fragment', (s) => { s.prod.services.postgres.volumes[1] = '../postgres/postgresql.staging.conf:/etc/postgresql/postgresql.conf:ro'; }, 'mount-allowlist'],
  ['SC2 top-level volume with driver_opts bind to /var/run', (s) => {
    s.prod.volumes = { pwn: { driver: 'local', driver_opts: { type: 'none', o: 'bind', device: '/var/run' } } };
    s.prod.services.web.volumes = ['pwn:/mnt'];
  }, 'volume-type'],
  ['SC2 a top-level volumes: entry nothing mounts', (s) => { s.prod.volumes = { unused: {} }; }, 'top-level-volumes'],
  ['SC4 backup binds the whole spool', (s) => { s.prod.services.backup.volumes = ['/srv/polycarpic/spool:/spool']; }, 'mount-allowlist'],
  ['SC4 backup binds spool/wal', (s) => { s.prod.services.backup.volumes = ['/srv/polycarpic/spool/wal:/spool/wal']; }, 'mount-allowlist'],
];
const PASS: [string, (s: FxSet) => void][] = [
  ['SC4 backup binds spool/dump and spool/premigration', (s) => {
    s.prod.services.backup.volumes = ['/srv/polycarpic/spool/dump:/spool/dump', '/srv/polycarpic/spool/premigration:/spool/premigration'];
  }],
];

describe('compose-policy lint: SC1, SC2, SC4', () => {
  it.each(ROWS)('%s -> rule fires', (name, mut, id) => {
    const r = run(mut);
    expect(r.code, name).not.toBe(0);
    expect(r.err).toMatch(new RegExp(`\\[${id}\\]`));
  });
  it.each(PASS)('%s is clean', (name, mut) => {
    const r = run(mut);
    expect({ name, code: r.code, err: r.err }).toEqual({ name, code: 0, err: '' });
  });
});
