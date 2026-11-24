// POLY-100 T-real, part 1 (ruling.md 3765f358): one REAL `first-deploy staging` on the runner. Real root, install_box.py, the installed dispatcher under its own umask 077, Docker, Compose, the job's
// own images served by a registry answering as ghcr.io, real Postgres and the real roles. Fake: GitHub's API (`gh`). One real anonymous `git fetch` of two public commits of main (the second descends from the
// first) is made by the tool and by `commits()`: said here, on purpose. The tools image is NOT exercised here (staging never runs it; it is the Caddy image relabelled): the backup suite proves it. It would have caught F1 (the real tar), F16 (`run`'s options), G1 (umask 077, uid 10020) and the PLAID_ENV, MAIL_FROM and edge-network faults.
// Shown red on the product code at 2825b6f7, where G1 was found: the harness never creates /opt/polycarpic, releases, state/deploy or the render home.
import { describe, expect, it } from 'vitest';
import { CALLER, IN_CI, STATE, containerImages, commits, containers, install, missing, modeOf, offer, ops, prepare, projectContainers, readRoot, release, restartCount, root, run, settleTimer, stateFile, step, log, type Release } from './harness.ts';

const gap = missing();
if (gap.length && IN_CI) throw new Error(`deploy-real: ${gap.join(', ')} missing in CI: T-real must run, not skip`);
const suite = gap.length ? describe.skip : describe;

const SHARED = ['/opt/polycarpic', '/opt/polycarpic/releases', '/var/lib/polycarpic/state/deploy', STATE, '/var/lib/polycarpic/state/deploy/render-home'];
let rel1: Release;

suite('T-real part 1: first-deploy staging, for real', () => {
  it('the tool is installed by install_box.py alone: nothing of /opt/polycarpic existed before it, and every shared directory is root 0755 after', () => {
    prepare();
    expect(root(['test', '-e', '/opt/polycarpic']).code, 'the harness must not create /opt/polycarpic: only install_box.py and the tool do (G1)').not.toBe(0);
    const r = step('install', () => install());
    expect(r.code, r.err).toBe(0);
    expect(root(['test', '-x', '/usr/local/sbin/polycarpic-ops']).code).toBe(0);
  });

  it('the first release is built, pushed to the local ghcr.io, and offered by the fake GitHub', () => {
    const [c1] = commits();
    rel1 = step('images of release 1', () => release(c1));
    offer(rel1, 101);
    expect(rel1.app).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('first-deploy staging: exit 4 roles-missing, with the command that fixes it', () => {
    const r = step('first-deploy (roles-missing)', () => ops(['first-deploy', 'staging'], 'first-deploy staging #1'));
    expect(r.code, r.err).toBe(4);
    expect(r.err + r.out).toContain('roles-missing');
    expect(r.err + r.out).toContain('provision --stage database --project staging');
    // G12 (fcca8d3b): asked of Postgres, not read from an authentication error: no one-off was started, and a box fault bans no digest
    expect(root(['sh', '-c', 'docker ps -a --format {{.Names}} | grep -c -- "-run-" || true']).out.trim(), 'a one-off `compose run` was started').toBe('0');
    expect(stateFile('quarantine') ?? '', 'roles-missing is no reason to ban the digest').not.toContain(rel1.app);
  });

  it('provision --stage database: the real roles.sql and the login passwords, on the real Postgres', () => {
    const r = step('provision --stage database', () => ops(['provision', '--stage', 'database', '--project', 'staging'], 'provision --stage database'));
    expect(r.code, r.err).toBe(0);
  });

  it('first-deploy staging again: exit 0, healthy, the containers run the digests of the release, the real timer is enabled (then stopped, and its service waited out)', () => {
    const r = step('first-deploy (healthy)', () => ops(['first-deploy', 'staging'], 'first-deploy staging #2'));
    expect(r.code, r.err).toBe(0); // exact (ruling 1ccc4fb9): the two real deploy units are installed by prepare()
    const t = settleTimer();
    expect(t.enabled, 'first-deploy enabled the deploy timer').toBe('enabled');
    const cur = (stateFile('current') ?? '').split(' ');
    expect(cur[0], 'current is the offered digest').toBe(rel1.app);
    const imgs = containerImages();
    const byService = (svc: string) => Object.entries(imgs).filter(([n]) => n.includes(`-${svc}-`)).map(([, i]) => i);
    for (const svc of ['web', 'auth', 'worker']) expect(byService(svc).every((i) => i.endsWith('@' + rel1.app)), `${svc} runs the release's digest`).toBe(true);
    expect(byService('postgres').every((i) => i.endsWith('@' + rel1.siblings.postgres)), 'postgres runs its sibling digest').toBe(true);
    for (const c of containers().filter((x) => /-(web|auth|worker|postgres)-/.test(x.name))) expect(c.status, c.name).toMatch(/\(healthy\)/);
    // verdict B3: exactly one container per service, none else (a name filter over zero containers passes every `every`/loop above)
    const all = projectContainers();
    expect(all.map((c) => c.service).sort(), `the project's containers: ${all.map((c) => c.name).join(', ')}`).toEqual(['auth', 'postgres', 'web', 'worker']);
    for (const c of all) expect(c.status, c.name).toMatch(/\(healthy\)/);
    // verdict B2 (G14): the worker runs `worker` and has not restarted since it started (a restart loop that ends healthy would pass the status alone)
    const worker = all.find((c) => c.service === 'worker')!;
    expect(restartCount(worker.name), 'the worker restarted').toBe('0');
    expect(root(['docker', 'inspect', '-f', '{{json .Config.Cmd}}', worker.name]).out.trim(), 'the worker runs the command `worker`').toBe('["worker"]');
  });

  it('verdict B4: the caller\'s directory is unreadable to the tool\'s own users, and the hostile `.env` and compose.yaml changed nothing: no operator, no planted service, no migrate left behind', () => {
    expect(modeOf(CALLER), 'the caller directory').toBe('700 root:root');
    for (const uid of ['10020', '10001']) expect(root(['setpriv', `--reuid=${uid}`, `--regid=${uid}`, '--clear-groups', 'ls', CALLER]).code, `uid ${uid} can list the hostile directory`).not.toBe(0);
    expect(readRoot(`${CALLER}/.env`) ?? '', 'the hostile .env is really there (control)').toContain('COMPOSE_PROFILES=migrate,operator');
    const services = projectContainers().map((c) => c.service);
    for (const bad of ['operator', 'planted', 'migrate']) expect(services, `a ${bad} container exists`).not.toContain(bad);
    expect(root(['sh', '-c', 'docker ps -a --format {{.Image}} | grep -c planted || true']).out.trim(), 'the planted image was never used').toBe('0');
  });

  it('G1: every shared directory is root exactly 0755 under the dispatcher\'s umask 077, the render home is empty, the release tree and the saved render have the ruled modes', () => {
    for (const d of SHARED) expect(modeOf(d), d).toBe('755 root:root');
    expect(root(['sh', '-c', 'ls -A /var/lib/polycarpic/state/deploy/render-home | wc -l']).out.trim(), 'the render home stays empty (S37)').toBe('0');
    const bad = root(['sh', '-c', 'find /opt/polycarpic/releases -type d ! -perm 0755 -o -type f ! -perm 0644 ! -perm 0755']).out.trim();
    expect(bad, 'dirs 0755, files 0644 or 0755 in every release tree').toBe('');
    const renders = root(['sh', '-c', `ls ${STATE}`]).out.split('\n').filter((n) => /^render-[0-9a-f]{12}\.(json|sha256)$/.test(n));
    expect(renders.length, 'a saved render and its hash').toBeGreaterThanOrEqual(2);
    for (const n of renders) expect(modeOf(`${STATE}/${n}`), n).toBe('600 root:root');
  });

  it('a second poll changes nothing: the same containers, the same pointer, no new start', () => {
    const started = (): string => root(['sh', '-c', "docker ps -q --filter label=com.docker.compose.project=polycarpic-staging | xargs -r docker inspect -f '{{.Name}} {{.State.StartedAt}}' | sort"]).out;
    const s0 = started();
    const cur0 = stateFile('current');
    const r = step('second poll', () => ops(['deploy', 'staging'], 'deploy staging (second poll)'));
    expect(r.code, r.err).toBe(0);
    expect(started(), 'no container was restarted').toBe(s0);
    expect(stateFile('current')).toBe(cur0);
    expect(s0.trim().length, 'there are containers to compare').toBeGreaterThan(0);
  });

  it('no argv of the run names the edge: no edge container or project exists', () => {
    expect(run(['sh', '-c', 'docker ps -a --format {{.Names}} | grep -c "^polycarpic-edge" || true']).out.trim()).toBe('0');
    log('part 1 done');
  });
});
