// POLY-100 F1 (i): the BUILT image's own tar. `docker create` + `docker cp <cid>:/release/infra -` of the app image, fed to the installed filter (`release.read_tar`): accepted, and exactly
// the manifest. The unit tests build their bundles from the Dockerfile's list; only a real tar settles PAX headers, owners and whatever the image really holds.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const IMG = process.env.POLY_APP_TEST_IMAGE ?? 'poly100-app:test';
const sh = (cmd: string, args: string[], o: { input?: Buffer | string; cwd?: string } = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'buffer', input: o.input, cwd: o.cwd, maxBuffer: 256 * 1024 * 1024, timeout: 900_000 });
  return { code: r.status ?? 127, out: r.stdout, err: (r.stderr ?? Buffer.alloc(0)).toString() };
};

let cid = '';
let tmp = '';
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'poly100-bundle-'));
  if (!process.env.POLY_APP_TEST_IMAGE) {
    const b = sh('docker', ['build', '-q', '-t', IMG, '.'], { cwd: ROOT });
    if (b.code !== 0) throw new Error(`docker build of the app image failed: ${b.err.slice(-600)}`);
  }
  const c = sh('docker', ['create', IMG]);
  if (c.code !== 0) throw new Error(`docker create failed: ${c.err}`);
  cid = c.out.toString().trim();
}, 900_000);
afterAll(() => {
  if (cid) sh('docker', ['rm', '-f', cid]);
  rmSync(tmp, { recursive: true, force: true });
});

const READ = `
import sys
sys.path.insert(0, sys.argv[1])
from lib import release
data = sys.stdin.buffer.read()
files = release.read_tar(data)
print("\\n".join(sorted(files)))
`;

describe('F1: the app image ships exactly the manifest at /release/infra', () => {
  it('docker cp <cid>:/release/infra - is accepted by the installed filter and holds exactly the manifest (FILES plus infra/postgres/**)', () => {
    const tar = sh('docker', ['cp', `${cid}:/release/infra`, '-']);
    expect(tar.code, tar.err).toBe(0);
    expect(tar.out.length).toBeLessThan(64 << 20);
    writeFileSync(join(tmp, 'read.py'), READ);
    const r = sh('python3', ['-I', join(tmp, 'read.py'), join(ROOT, 'infra', 'ops')], { input: tar.out });
    expect(r.code, r.err).toBe(0);
    const got = r.out.toString().trim().split('\n');
    const files = ['infra/compose/prod.yml', 'infra/compose/staging.yml', 'infra/compose/edge.yml', 'infra/caddy/Caddyfile', 'infra/backup/backup.sh', 'infra/backup/upload.sh', 'infra/postgres-major', 'infra/release/images.env'];
    for (const f of files) expect(got, f).toContain(f);
    expect(got.filter((g) => !files.includes(g) && !g.startsWith('infra/postgres/')), 'nothing off the manifest').toEqual([]);
  });

  it('the old path is not the contract: /app/infra holds more than the manifest, and the installed filter refuses it (the mutant `cp of /app/infra`)', () => {
    const tar = sh('docker', ['cp', `${cid}:/app/infra`, '-']);
    if (tar.code !== 0) return; // an image that no longer ships /app/infra is fine
    writeFileSync(join(tmp, 'read.py'), READ);
    const r = sh('python3', ['-I', join(tmp, 'read.py'), join(ROOT, 'infra', 'ops')], { input: tar.out });
    expect(r.code, 'the filter must refuse the whole infra tree').not.toBe(0);
  });

  it('image.sh build writes an all-zero images.env when none exists (a PR or a local build), and the box refuses zeros (V5)', () => {
    const tar = sh('docker', ['cp', `${cid}:/release/infra/release/images.env`, '-']);
    expect(tar.code, tar.err).toBe(0);
    const text = tar.out.toString('latin1');
    expect(text).toMatch(/POLY_(POSTGRES|TOOLS|CADDY)_IMAGE=ghcr\.io\/richmosko\/polycarpic-(postgres|tools|caddy)@sha256:0{64}/);
  });
});
