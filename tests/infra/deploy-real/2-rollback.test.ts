// POLY-100 T-real, part 2: the rollback case (ruling.md 3765f358). SEPARABLE: only the lead may make it optional (the first-deploy half stays); this file shares nothing with part 1 but the box part 1 left.
// A second release whose web never answers: rolled back within the window, quarantined, the first release healthy again, and the next poll skips it. Needs part 1 to have run (a healthy `current`).
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CALLER, IN_CI, STATE, TOOL, commits, containerImages, containers, isRoot, projectContainers, missing, offer, ops, readRoot, release, root, run, putRoot, stateFile, step, type Release } from './harness.ts';

const gap = missing();
if (gap.length && IN_CI) throw new Error(`deploy-real: ${gap.join(', ')} missing in CI: T-real must run, not skip`);
const suite = gap.length ? describe.skip : describe;

suite('T-real part 2: a release whose web never answers is rolled back', () => {
  let first = '';
  let second = '';
  let rel2: Release | undefined;

  it('part 1 left a healthy first release', () => {
    first = (stateFile('current') ?? '').split(' ')[0] ?? '';
    expect(first, 'no `current`: part 1 (first-deploy) did not leave a healthy release').toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // POLY-160 C28 (ruling S): a `deploy staging` of release 2 is SIGKILLed after its `up` line, the installed bundle's compose-version is then wrong, and `deploy staging` runs again: the recovery restores release 1 first,
  // then the Compose check refuses (`render-env`, exit 1), no mark is left. Red on a build that refuses before it recovers (release 2's containers stay up, the mark is kept).
  it('C28: deploy cut by SIGKILL after its `up`, then a poll under a different Compose: release 1 is running and healthy, render-env, exit 1, no mark', async () => {
    const [, c2] = commits();
    rel2 = step('images of release 2', () => release(c2, true));
    second = rel2.app;
    offer(rel2, 102);
    const argv = ['sh', '-c', 'cd "$1" && shift && umask 077 && exec "$@"', 'sh', CALLER, TOOL, 'deploy', 'staging'];
    const child = spawn(isRoot ? argv[0]! : 'sudo', isRoot ? argv.slice(1) : ['-n', ...argv], { stdio: 'ignore' });
    const exited = new Promise<number | null>((res) => child.once('exit', (c) => res(c)));
    let cut = false;
    for (let t = 0; t < 600 && !cut; t++) {
      const dl = readRoot(`${STATE}/deploy.log`) ?? '';
      if (new RegExp(`up ${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(dl)) cut = true;
      else await new Promise((r) => setTimeout(r, 500));
    }
    expect(cut, 'release 2 reached its `up` within 5 minutes').toBe(true);
    root(['pkill', '-KILL', '-f', 'polycarpic-ops deploy staging']);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 30_000))]);
    expect(stateFile('in-progress') ?? '', 'the mark is there after a SIGKILL').toContain(second);
    const vfile = root(['sh', '-c', 'echo "$(readlink -f /opt/polycarpic/ops/current)/infra/deploy/compose-version"']).out.trim();
    const original = readRoot(vfile);
    expect(original, 'the installed bundle holds a compose-version').toMatch(/^\d+\.\d+\.\d+\n$/);
    putRoot(vfile, '0.0.1\n');
    try {
      const r = step('poll under a different Compose', () => ops(['deploy', 'staging'], 'deploy staging (Compose differs)'));
      expect(r.code, r.err).toBe(1);
      expect(r.err.split('\n--- deploy.log ---')[0]!.trim().split('\n').pop(), r.err).toBe('deploy: refused render-env');
      expect((stateFile('alert') ?? '').split(/\s+/)[1]).toBe('render-env');
      expect(stateFile('in-progress'), 'no mark is left').toBeNull();
      expect((stateFile('current') ?? '').split(' ')[0], 'release 1 is still current').toBe(first);
      expect(stateFile('quarantine') ?? '', 'a box fault bans no digest').not.toContain(second);
      const imgs = Object.entries(containerImages()).filter(([n]) => /-(web|auth|worker)-/.test(n));
      expect(imgs.length).toBeGreaterThanOrEqual(3);
      for (const [n, i] of imgs) expect(i, `${n} runs release 1`).toBe(i.replace(/@.*/, '') + '@' + first);
      for (const c of containers().filter((x) => /-(web|auth|worker|postgres)-/.test(x.name))) expect(c.status, c.name).toMatch(/\(healthy\)/);
    } finally {
      putRoot(vfile, original!);
      root(['rm', '-f', `${STATE}/interrupted`, `${STATE}/alert`]);
    }
  });

  it('the second release (web never answers) is offered and polled: exit 1, rolled back within the window, quarantined, an alert', () => {
    expect(rel2, 'the C28 case made release 2').toBeDefined();
    const r = step('rollback poll', () => ops(['deploy', 'staging'], 'deploy staging (release 2: web never answers)'));
    expect(r.code, r.err).toBe(1);
    expect(r.err.split('\n--- deploy.log ---')[0]!.trim().split('\n').pop(), r.err).toBe('deploy: rolled-back'); // the harness appends deploy.log to a failed run's err
    expect(r.secs, 'the rollback window is 120 s; the restored worker needs its own first health report (60 s): 6 minutes at most').toBeLessThanOrEqual(360);
    expect(r.secs, 'B6: a poll that gave the candidate no window (rolled back at once, or its web crashed at start) is not the case under test').toBeGreaterThanOrEqual(120);
    const dl = stateFile('deploy.log') ?? '';
    expect(dl, 'B6: the candidate was started (an `up` line for its digest)').toMatch(new RegExp(`up ${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(dl, 'B6: refused for being unhealthy, not for another reason').toMatch(new RegExp(`refused unhealthy ${second}`));
    expect(stateFile('quarantine') ?? '', 'B6: quarantined with its reason').toMatch(new RegExp(`${second} \\S+ unhealthy`));
    expect(stateFile('alert') ?? '', 'B6: the alert says rolled-back').toMatch(/rolled-back/);
    expect((stateFile('current') ?? '').split(' ')[0], 'the first release is current again').toBe(first);
    expect(stateFile('quarantine') ?? '', 'the second digest is quarantined').toContain(second);
    expect(stateFile('alert') ?? '', 'an alert says so').not.toBe('');
  });

  it('the first release is healthy again, on its own digests', () => {
    const imgs = Object.entries(containerImages()).filter(([n]) => /-(web|auth|worker)-/.test(n));
    expect(imgs.length).toBeGreaterThanOrEqual(3);
    for (const [n, i] of imgs) expect(i, `${n} runs the first release`).toBe(i.replace(/@.*/, '') + '@' + first);
    for (const c of containers().filter((x) => /-(web|auth|worker|postgres)-/.test(x.name))) expect(c.status, c.name).toMatch(/\(healthy\)/);
    // B3: exactly one container per service, all healthy, nothing else (no leftover candidate)
    const all = projectContainers();
    expect(all.map((c) => c.service).sort(), `the project's containers: ${all.map((c) => c.name).join(', ')}`).toEqual(['auth', 'postgres', 'web', 'worker']);
    for (const c of all) expect(c.status, c.name).toMatch(/\(healthy\)/);
  });

  it('the next poll skips the quarantined digest: exit 0, nothing started', () => {
    const started = (): string => root(['sh', '-c', "docker ps -q --filter label=com.docker.compose.project=polycarpic-staging | xargs -r docker inspect -f '{{.Name}} {{.State.StartedAt}}' | sort"]).out;
    const s0 = started();
    const q0 = stateFile('quarantine');
    const r = step('next poll skips it', () => ops(['deploy', 'staging'], 'deploy staging (next poll)'));
    expect(r.code, r.err).toBe(0);
    expect(started()).toBe(s0);
    expect(stateFile('quarantine'), 'not quarantined twice').toBe(q0);
    expect(run(['true']).code).toBe(0);
  });
});
