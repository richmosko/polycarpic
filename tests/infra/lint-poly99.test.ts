// POLY-99 R10 and seceng C1, C2, C3 (mount side), C10, H-1: the compose-policy lint's new rules. Each fail fixture is the pass baseline
// (baseline.ts, updated to the POLY-99 compose shape) plus ONE mutation; each rule has a pass twin so a rule that fires on everything is caught.
// Rule ids pinned here (the builder builds to them): core-dump, tmp-size, state-mount, uploader-spool-ro; host-secrets and mount-allowlist exist.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, giveSecret, materialise, PG_IMAGE_ENV, type FxSet } from './baseline.ts';

const LINT = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra', 'lint', 'compose-policy.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function run(mut: (s: FxSet) => void) {
  const s = baseline();
  mut(s);
  const root = mkdtempSync(join(tmpdir(), 'poly99-lint-'));
  made.push(root);
  materialise(root, s);
  const r = spawnSync('node', [LINT, '--root', root], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' },
  });
  return { code: r.status, err: r.stderr ?? '' };
}

const FAIL: [string, (s: FxSet) => void, string][] = [
  // C2: ulimits core 0 on every service of every project (x-hardened)
  ['C2 backup without ulimits core 0', (s) => { delete s.prod.services.backup.ulimits; }, 'core-dump'],
  ['C2 uploader with core 1', (s) => { s.prod.services.uploader.ulimits = { core: 1 }; }, 'core-dump'],
  ['C2 postgres without ulimits', (s) => { delete s.prod.services.postgres.ulimits; }, 'core-dump'],
  ['C2 a staging service without ulimits core 0', (s) => { delete s.staging.services.web.ulimits; }, 'core-dump'],
  ['C2 ulimits core set only as a soft limit above 0', (s) => { s.prod.services.web.ulimits = { core: { soft: 0, hard: 1 } }; }, 'core-dump'],
  // C1: backup's /tmp is a tmpfs of at most 1 MiB
  ['C1 backup /tmp has no size', (s) => { s.prod.services.backup.tmpfs = ['/tmp']; }, 'tmp-size'],
  ['C1 backup /tmp is 2m', (s) => { s.prod.services.backup.tmpfs = ['/tmp:size=2m']; }, 'tmp-size'],
  ['C1 backup /tmp is 1048577 bytes', (s) => { s.prod.services.backup.tmpfs = ['/tmp:size=1048577']; }, 'tmp-size'],
  ['C1 uploader /tmp has no size', (s) => { s.prod.services.uploader.tmpfs = ['/tmp']; }, 'tmp-size'],
  ['C1 backup has no /tmp tmpfs at all', (s) => { s.prod.services.backup.tmpfs = []; }, 'tmp-size'],
  // C1: no other writable mount than backup's two spool dirs
  ['C1 backup gains a writable bind', (s) => { s.prod.services.backup.volumes.push('/srv/polycarpic/staging-scratch:/scratch'); }, 'mount-allowlist'],
  ['C1 backup mounts a spool dir read-write that is not its own (wal)', (s) => { s.prod.services.backup.volumes.push('/srv/polycarpic/spool/wal:/spool/wal'); }, 'mount-allowlist'],
  // C10 / R10: nothing mounts root's state
  ['C10 a service mounts the state directory', (s) => { s.prod.services.web.volumes = ['/var/lib/polycarpic/state:/state:ro']; }, 'state-mount'],
  ['C10 a service mounts spool.sha256', (s) => { s.prod.services.backup.volumes.push('/var/lib/polycarpic/state/spool.sha256:/x:ro'); }, 'state-mount'],
  ['C10 the uploader keeps the old uploader-state mount', (s) => { s.prod.services.uploader.volumes.push('/srv/polycarpic/uploader-state:/state'); }, 'mount-allowlist'],
  ['C10 a service mounts a parent of the state directory', (s) => { s.prod.services.worker.volumes = ['/var/lib/polycarpic:/x:ro']; }, 'state-mount'],
  // C3 (mount side): the uploader reads the spool and changes nothing
  ['C3 the uploader mounts the spool read-write', (s) => { s.prod.services.uploader.volumes[0] = '/srv/polycarpic/spool:/spool'; }, 'uploader-spool-ro'],
  ['C3 the uploader mounts a spool subdirectory read-write', (s) => { s.prod.services.uploader.volumes[0] = '/srv/polycarpic/spool/dump:/spool/dump'; }, 'uploader-spool-ro'],
  ['C3 the uploader has no spool mount', (s) => { s.prod.services.uploader.volumes.shift(); }, 'uploader-spool-ro'],
  // H-1: the host-only secret directory is mounted by nothing
  ['H-1 a service mounts a secret file under secrets/host/', (s) => {
    s.prod.secrets.heartbeat_url__uploader = { file: '/etc/polycarpic/secrets/host/heartbeat_url' };
    (s.prod.services.uploader.secrets ??= []).push({ source: 'heartbeat_url__uploader', target: 'heartbeat_url' });
  }, 'host-secrets'],
  ['H-1 a service bind-mounts secrets/host/', (s) => { s.prod.services.uploader.volumes.push('/etc/polycarpic/secrets/host:/h:ro'); }, 'host-secrets'],
  ['H-1 the uploader is given the heartbeat secret from its own directory (the old shape)', (s) => giveSecret(s.prod, true, 'uploader', 'heartbeat_url'), 'secret-matrix'],
  // R10: the uploader's other mounts are exactly the script, ops.conf and host.env
  ['R10 the uploader mounts another host path', (s) => { s.prod.services.uploader.volumes.push('/etc/polycarpic/age-recipients.txt:/etc/uploader/age:ro'); }, 'mount-allowlist'],
  ['R10 the uploader binds the whole /etc/polycarpic', (s) => { s.prod.services.uploader.volumes.push('/etc/polycarpic:/etc/polycarpic'); }, 'mount-allowlist'],
];
const PASS: [string, (s: FxSet) => void][] = [
  ['the baseline (the POLY-99 compose shape) is clean', () => {}],
  ['C1 backup /tmp is exactly size=1m', (s) => { s.prod.services.backup.tmpfs = ['/tmp:size=1m']; }],
  ['C1 backup /tmp is size=1048576', (s) => { s.prod.services.backup.tmpfs = ['/tmp:size=1048576']; }],
  ['C3 the uploader mounts the spool read-only', (s) => { s.prod.services.uploader.volumes[0] = '/srv/polycarpic/spool:/spool:ro'; }],
];

describe('compose-policy lint: POLY-99 rules', () => {
  it.each(FAIL)('%s -> the rule fires', (name, mut, id) => {
    const r = run(mut);
    expect(r.code, name).not.toBe(0);
    expect(r.err).toMatch(new RegExp(`\\[${id}\\]`));
  });
  it.each(PASS)('%s', (name, mut) => {
    const r = run(mut);
    expect({ name, code: r.code, err: r.err }).toEqual({ name, code: 0, err: '' });
  });
});
