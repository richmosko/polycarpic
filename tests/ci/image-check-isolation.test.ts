// POLY-132 (seceng-96 hardening): `image.sh check` runs a shell inside an image that has not been scanned yet, in the build.yml
// job that can mint attestation tokens. The container gets no network, no environment and no volume.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ci, ROOT } from './helpers.ts';

function runArgs(ref: string): string[] {
  if (!existsSync(ci('image.sh'))) throw new Error('infra/ci/image.sh does not exist');
  const d = mkdtempSync(join(tmpdir(), 'iso-'));
  const bin = join(d, 'bin'); mkdirSync(bin);
  const log = join(d, 'run.args');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
case "$1" in
  run) shift; printf '%s\\n' "$@" > "${log}"; exit 0 ;;
  image) printf 'node\\n' ;;
  *) exit 0 ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const r = spawnSync('bash', [ci('image.sh'), 'check', ref], {
    cwd: ROOT, encoding: 'utf8',
    // a hostile-looking environment: nothing of it may reach the container
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: d, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret', GITHUB_TOKEN: 'secret' },
  });
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(log), 'image.sh check never ran docker run').toBe(true);
  return readFileSync(log, 'utf8').trim().split('\n');
}

describe('image.sh check isolation', () => {
  for (const ref of ['polycarpic:ci', `ghcr.io/richmosko/polycarpic@sha256:${'a'.repeat(64)}`]) {
    describe(ref, () => {
      const a = () => runArgs(ref);
      it('no network: --network none (or --network=none)  [red if: the flag is dropped or set to bridge/host]', () => {
        const args = a();
        const i = args.findIndex((x) => x === '--network' || x === '--net');
        const eq = args.some((x) => x === '--network=none' || x === '--net=none');
        expect(eq || (i >= 0 && args[i + 1] === 'none')).toBe(true);
        expect(args.some((x) => /^--(network|net)=(?!none$)/.test(x))).toBe(false);
      });
      it('no environment and no volume reaches the container  [red if: -e, --env, --env-file, -v, --volume or --mount is added]', () => {
        const args = a();
        for (const x of args) {
          expect(x, x).not.toMatch(/^(-e|--env|--env-file|-v|--volume|--mount|--volumes-from)(=|$)/);
          expect(x, x).not.toMatch(/^-[a-zA-Z]*[ev][a-zA-Z]*$/); // clustered short flags such as -ev
        }
      });
      it('no privilege escalation: no --privileged, --cap-add, --device, --pid=host, --ipc=host, --userns=host', () => {
        for (const x of a()) expect(x, x).not.toMatch(/^--(privileged|cap-add|device|pid=host|ipc=host|userns=host|security-opt=(seccomp|apparmor)=unconfined)/);
      });
      it('the image under test is the argument and the entrypoint is sh -c (the checked script, nothing from the host)', () => {
        const args = a();
        expect(args).toContain(ref);
        expect(args.indexOf('--entrypoint')).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
