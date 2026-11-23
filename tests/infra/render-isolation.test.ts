// POLY-100 S31 / F4 (a) on the REAL tools (ruling.md F4 row; T-render's lint step, Linux): `unshare --net -- setpriv --reuid 10020 --regid 10020 --clear-groups --no-new-privs -- docker compose … config`.
//   (1) a root-only file reached through a local `include` fails the render (and rendered as root it would not: the control);
//   (2) a canary in a 0400 root `env_file` is never in a render or its error (rendered as root it is: the control);
//   (3) a remote `include: oci://127.0.0.1:<port>/…` makes no connection from inside `unshare --net` (outside it, it does: the control), so it fails.
// Needs Linux, root or passwordless `sudo`, `unshare`, `setpriv` and the compose CLI. In CI (CI=true) a missing tool FAILS the test; a developer machine without them (macOS) skips with the reason,
// and the first run of these cases is CI's lint job. Mutants: render as root (1, 2 red), no `unshare` (3 red), `--reuid 65534` (all green here: S31's own number is A18's 10020, pinned in the unit tests).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const IN_CI = process.env.CI === 'true';
const isRoot = process.getuid?.() === 0;
const run = (argv: string[], env: Record<string, string> = {}) => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 120_000 });
const asRoot = (argv: string[], env: Record<string, string> = {}) => (isRoot ? run(argv, env) : run(['sudo', '-n', 'env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...argv]));
const have = (cmd: string) => run(['sh', '-c', `command -v ${cmd}`]).status === 0;

const missing: string[] = [];
if (process.platform !== 'linux') missing.push('linux');
else {
  for (const t of ['unshare', 'setpriv', 'docker']) if (!have(t)) missing.push(t);
  if (!missing.length && run(['docker', 'compose', 'version']).status !== 0) missing.push('docker compose');
  if (!isRoot && !missing.length && run(['sudo', '-n', 'true']).status !== 0) missing.push('root or passwordless sudo');
}
const ready = missing.length === 0;
if (!ready && IN_CI) throw new Error(`render-isolation: ${missing.join(', ')} missing in CI: these cases must run, not skip (S31)`);
const suite = ready ? describe : describe.skip;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) asRoot(['rm', '-rf', d]); });

const PREFIX = ['unshare', '--net', '--', 'setpriv', '--reuid', '10020', '--regid', '10020', '--clear-groups', '--no-new-privs', '--'];
const HARDEN = { COMPOSE_EXPERIMENTAL_GIT_REMOTE: '0', COMPOSE_EXPERIMENTAL_OCI_REMOTE: '0' };

function world() {
  const d = mkdtempSync(join(tmpdir(), 'poly100-s31-'));
  dirs.push(d);
  chmodSync(d, 0o755);
  const home = join(d, 'home');
  mkdirSync(home, { mode: 0o755 });
  const env = { HOME: home, XDG_CACHE_HOME: home, ...HARDEN };
  const render = (compose: string, as: 'render' | 'root' | 'render-with-network') => {
    const argv = ['docker', 'compose', '-p', 'polycarpic-s31', '--project-directory', d, '-f', compose, '--profile', '*', 'config', '--format', 'json'];
    if (as === 'root') return asRoot(argv, env);
    if (as === 'render-with-network') return asRoot(['setpriv', '--reuid', '10020', '--regid', '10020', '--clear-groups', '--no-new-privs', '--', ...argv], { HOME: home, XDG_CACHE_HOME: home });
    return asRoot([...PREFIX, ...argv], env);
  };
  return { d, render };
}

suite('S31 on the real tools: the render runs as an unprivileged, network-less user', () => {
  it('(1) a root-only file reached through a local include fails the render; the same render as root works (so the isolation is what refuses it)', () => {
    const { d, render } = world();
    const secret = join(d, 'rootonly');
    mkdirSync(secret, { mode: 0o700 });
    writeFileSync(join(secret, 'inc.yml'), 'services:\n  leak:\n    image: example.invalid/x@sha256:' + '1'.repeat(64) + '\n');
    asRoot(['chown', '-R', 'root:root', secret]);
    asRoot(['chmod', '0700', secret]);
    writeFileSync(join(d, 'c.yml'), `include:\n  - path: ${join(secret, 'inc.yml')}\nservices:\n  a:\n    image: example.invalid/a@sha256:${'2'.repeat(64)}\n`);
    chmodSync(join(d, 'c.yml'), 0o644);
    const asRootOut = render(join(d, 'c.yml'), 'root');
    expect(asRootOut.status, 'control: root can read it, so the file and the compose are valid: ' + asRootOut.stderr).toBe(0);
    expect(asRootOut.stdout).toContain('leak');
    const r = render(join(d, 'c.yml'), 'render');
    expect(r.status, 'the render user must not read a root-only include').not.toBe(0);
    expect(r.stdout).not.toContain('leak');
  });

  it('(2) a canary in a 0400 root env_file never appears in a render or its error; as root it does (the control)', () => {
    const { d, render } = world();
    const canary = 'canary' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    writeFileSync(join(d, 'secret.env'), `S=${canary}\n`);
    asRoot(['chown', 'root:root', join(d, 'secret.env')]);
    asRoot(['chmod', '0400', join(d, 'secret.env')]);
    writeFileSync(join(d, 'c.yml'), `services:\n  a:\n    image: example.invalid/a@sha256:${'2'.repeat(64)}\n    env_file:\n      - path: ${join(d, 'secret.env')}\n        required: true\n`);
    chmodSync(join(d, 'c.yml'), 0o644);
    const asRootOut = render(join(d, 'c.yml'), 'root');
    expect(asRootOut.status, asRootOut.stderr).toBe(0);
    expect(asRootOut.stdout, 'control: a root render does carry the value').toContain(canary);
    const r = render(join(d, 'c.yml'), 'render');
    expect(r.stdout + r.stderr).not.toContain(canary);
    expect(r.status).not.toBe(0);
  });

  it('(3) a remote include makes no connection from inside unshare --net (the same render with the network does), and fails', async () => {
    const { d, render } = world();
    let hits = 0;
    const srv = createServer((s) => { hits++; s.destroy(); });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    writeFileSync(join(d, 'c.yml'), `include:\n  - oci://127.0.0.1:${port}/x/y:1\nservices:\n  a:\n    image: example.invalid/a@sha256:${'2'.repeat(64)}\n`);
    chmodSync(join(d, 'c.yml'), 0o644);
    try {
      // the control runs async so the in-process listener can answer; spawnSync would block the event loop
      const ctl = await new Promise<number>((ok) => {
        const argv = ['setpriv', '--reuid', '10020', '--regid', '10020', '--clear-groups', '--no-new-privs', '--', 'docker', 'compose', '-p', 'polycarpic-s31', '--project-directory', d, '-f', join(d, 'c.yml'), 'config'];
        const full = isRoot ? argv : ['sudo', '-n', 'env', `HOME=${join(d, 'home')}`, `XDG_CACHE_HOME=${join(d, 'home')}`, ...argv];
        const c = spawn(full[0], full.slice(1), { env: { PATH: process.env.PATH ?? '', HOME: join(d, 'home'), XDG_CACHE_HOME: join(d, 'home') } });
        c.on('close', () => ok(hits));
      });
      expect(ctl, 'control: with the network (and the remote flags unset) compose does try to connect: otherwise this case cannot tell isolation from nothing').toBeGreaterThan(0);
      const before = hits;
      const r = render(join(d, 'c.yml'), 'render');
      expect(r.status, 'a remote include cannot be fetched, so the render fails').not.toBe(0);
      expect(hits, 'no connection reached the host listener from inside unshare --net').toBe(before);
    } finally {
      srv.close();
    }
  }, 180_000);
});
