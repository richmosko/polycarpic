// POLY-100 T-real harness (ruling.md 3765f358, S38). Real: root, the installed dispatcher and its umask 077, install_box.py, Docker, Compose, the job's own images, Postgres, a local registry
// answering as ghcr.io over TLS. Fake: GitHub's API (`gh`, fixtures/gh) and nothing else. Prepared, NOT provisioned: users, a tmpfs at /srv/polycarpic, the edge network, env files, secrets.
// The harness NEVER creates /opt/polycarpic, releases, state/deploy or the render home: only install_box.py and the tool do, or G1 would pass unseen.
//
// What this puts on the runner (infra/ci/deploy-real-undo.sh removes all of it, always, S38 b):
//   /etc/hosts line tagged `# poly-deploy-real`; /etc/docker/certs.d/ghcr.io; container `poly-deploy-real-registry`; /usr/local/sbin/gh (only when absent) and /usr/local/sbin/polycarpic-ops;
//   users and groups `pdr-*` (uids 999, 10101, 10102, 10103, 10106, 10107) and `polycarpic-render` (10020), when they did not exist; network `polycarpic-edge-staging`; project `polycarpic-staging`
//   (containers, its default network, volumes); the tmpfs mount on /srv/polycarpic; /opt/polycarpic, /etc/polycarpic, /var/lib/polycarpic, /run/polycarpic, /run/poly-deploy-real;
//   images tagged ghcr.io/richmosko/* and the temporary `polycarpic-deploy-real-*` tags.
// A fixed set of names, no wildcard over anything the runner owned before.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const IN_CI = process.env.CI === 'true';
export const isRoot = process.getuid?.() === 0;
export const LOG = process.env.DEPLOY_REAL_LOG ?? join(tmpdir(), 'deploy-real.log');
export const RUN = '/run/poly-deploy-real';
export const ETC = '/etc/polycarpic';
export const STATE = '/var/lib/polycarpic/state/deploy/staging';
export const TOOL = '/usr/local/sbin/polycarpic-ops';
export const REG = 'ghcr.io/richmosko';
export const APP_IMAGE = process.env.POLY_APP_TEST_IMAGE ?? 'polycarpic:ci';

export type Res = { code: number; out: string; err: string; secs: number };

export function run(argv: string[], o: { input?: string; env?: Record<string, string>; timeout?: number; cwd?: string } = {}): Res {
  const t0 = Date.now();
  const r = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8', input: o.input, cwd: o.cwd, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/root', ...(o.env ?? {}) }, timeout: o.timeout ?? 600_000, maxBuffer: 256 << 20 });
  return { code: r.status ?? 127, out: r.stdout ?? '', err: r.stderr ?? '', secs: Math.round((Date.now() - t0) / 100) / 10 };
}
export const root = (argv: string[], o: { input?: string; env?: Record<string, string>; timeout?: number } = {}): Res => {
  const env = Object.entries(o.env ?? {}).map(([k, v]) => `${k}=${v}`);
  return isRoot ? run(argv, { ...o, env: o.env }) : run(['sudo', '-n', ...(env.length ? ['env', ...env] : []), ...argv], { input: o.input, timeout: o.timeout });
};
export const sh = (script: string, o: { input?: string; timeout?: number } = {}): Res => root(['sh', '-c', script], o);

/** Why this machine cannot run T-real, [] when it can. In CI a non-empty answer FAILS the suite (never a skip). */
export function missing(): string[] {
  const m: string[] = [];
  if (process.platform !== 'linux') return ['linux'];
  for (const t of ['docker', 'git', 'openssl', 'python3', 'curl']) if (run(['sh', '-c', `command -v ${t}`]).code !== 0) m.push(t);
  if (run(['docker', 'compose', 'version']).code !== 0) m.push('docker compose');
  if (!isRoot && run(['sudo', '-n', 'true']).code !== 0) m.push('root or passwordless sudo');
  return m;
}

export function log(line: string): void {
  appendFileSync(LOG, line + '\n');
}
export function logRun(label: string, r: Res): void {
  log(`## ${label}: exit ${r.code} in ${r.secs}s`);
  if (r.out.trim()) log(r.out.trimEnd());
  if (r.err.trim()) log(r.err.trimEnd());
}
export function step<T>(name: string, fn: () => T): T {
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    const line = `step ${name}: ${Math.round((Date.now() - t0) / 100) / 10}s`;
    log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
  }
}

// ---- files as root ----
export function putRoot(path: string, content: string, mode = '0644', owner = 'root', group = 'root'): void {
  // `install /dev/stdin` fails through sudo on a pipe ("No such device or address"): write with a shell, then set the mode and owner
  const r = root(['sh', '-c', 'umask 077; mkdir -p "$(dirname "$1")" && cat > "$1" && chmod "$2" "$1" && chown "$3:$4" "$1"', 'sh', path, mode, owner, group], { input: content });
  if (r.code !== 0) throw new Error(`put ${path}: ${r.err}`);
}
export function readRoot(path: string): string | null {
  const r = root(['cat', path]);
  return r.code === 0 ? r.out : null;
}
export const modeOf = (path: string): string => root(['stat', '-c', '%a %U:%G', path]).out.trim();

// ---- secrets: random per run, kept (root 0600) for the sweep of the kept log (S38 d) ----
export function secret(name: string, bytes = 32): string {
  const v = randomBytes(bytes).toString('base64');
  const cur = JSON.parse(readRoot(`${RUN}/secrets.json`) ?? '{}');
  cur[name] = v;
  putRoot(`${RUN}/secrets.json`, JSON.stringify(cur), '0600');
  return v;
}
export const secretEntries = (): [string, string][] => Object.entries(JSON.parse(readRoot(`${RUN}/secrets.json`) ?? '{}') as Record<string, string>);

// ---- the box, prepared ----
const USERS: [string, number][] = [['pdr-postgres', 999], ['pdr-web', 10101], ['pdr-worker', 10102], ['pdr-migrate', 10103], ['pdr-operator', 10106], ['pdr-auth', 10107], ['polycarpic-render', 10020]];
const SECRETS: Record<string, { gid: number; files: string[] }> = {
  postgres: { gid: 999, files: ['db_superuser_password'] },
  web: { gid: 10101, files: ['db_password_app', 'plaid_secret'] },
  auth: { gid: 10107, files: ['db_password_auth', 'auth_secret', 'resend_api_key'] },
  worker: { gid: 10102, files: ['db_password_worker', 'credential_keyring', 'resend_api_key'] },
  migrate: { gid: 10103, files: ['db_password_migrator'] },
  operator: { gid: 10106, files: ['db_password_operator'] },
};

function must(r: Res, what: string): Res {
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${r.err.trim() || r.out.trim()}`);
  return r;
}

export function prepare(): void {
  try {
    prepareBox();
  } catch (e) {
    throw new Error(`T-real SETUP failed (the box was not prepared; nothing of the product ran): ${(e as Error).message}`);
  }
}

function prepareBox(): void {
  if (existsSync('/run/poly-deploy-real/prepared') || readRoot(`${RUN}/prepared`) !== null) return;
  must(sh(`install -d -m 0700 ${RUN}`), 'run dir');
  for (const [name, id] of USERS) {
    must(sh(`getent group ${id} > /dev/null || groupadd -g ${id} ${name}; getent passwd ${id} > /dev/null || useradd --system -u ${id} -g ${id} -M -d /nonexistent -s /usr/sbin/nologin ${name}`), `user ${name}`);
  }
  // the tool's own trust check (R1, K1) wants every parent of its install root-owned and not group- or world-writable: a real box's /opt is; the runner's may not be. Its original mode and owner are kept
  // for the undo (RUN/opt.orig) and logged; the check itself is never weakened.
  const opt = root(['stat', '-c', '%a %u:%g', '/opt']).out.trim();
  log(`runner /opt was ${opt}`);
  putRoot(`${RUN}/opt.orig`, opt + '\n', '0600');
  const [omode, oown] = opt.split(' ');
  if (oown !== '0:0' || (parseInt(omode!, 8) & 0o022) !== 0) must(sh('chown root:root /opt && chmod u=rwx,g=rx,o=rx /opt'), '/opt as a real box has it');
  must(sh('install -d -m 0755 /srv/polycarpic && mount -t tmpfs -o mode=0755,size=1g tmpfs /srv/polycarpic && install -d -m 0700 -o 999 -g 999 /srv/polycarpic/pg-staging'), 'tmpfs at /srv/polycarpic');
  must(sh(`install -d -m 0755 ${ETC} && install -d -m 0700 ${ETC}/staging-secrets ${ETC}/secrets ${ETC}/secrets/host`), '/etc/polycarpic');
  for (const [svc, { gid, files }] of Object.entries(SECRETS)) {
    must(sh(`install -d -m 0750 -o root -g ${gid} ${ETC}/staging-secrets/${svc}`), `secrets dir ${svc}`);
    for (const f of files) putRoot(`${ETC}/staging-secrets/${svc}/${f}`, secret(`${svc}/${f}`) + '\n', '0440', 'root', String(gid));
  }
  putRoot(`${ETC}/staging-host.env`, 'TLS_MODE=real-domain\nPUBLIC_ORIGIN=https://staging.example.test\nPOLY_INSTANCE=polycarpic-staging\n');
  putRoot(`${ETC}/staging-mail.env`, 'MAIL_FROM="ops@example.test"\n');
  putRoot(`${ETC}/secrets/host/github_read_token`, 'github_pat_' + randomBytes(62).toString('base64url').slice(0, 82) + '\n', '0400');
  const cur = JSON.parse(readRoot(`${RUN}/secrets.json`) ?? '{}'); // the sweep looks for the token's own text too
  cur.github_read_token = readRoot(`${ETC}/secrets/host/github_read_token`)!.trim();
  putRoot(`${RUN}/secrets.json`, JSON.stringify(cur), '0600');
  if (run(['docker', 'network', 'inspect', 'polycarpic-edge-staging']).code !== 0) must(run(['sudo', '-n', 'docker', 'network', 'create', '--driver', 'bridge', '--subnet', '10.202.30.0/28', 'polycarpic-edge-staging']), 'edge network');
  registry();
  const fake = '/usr/local/sbin/gh';
  if (root(['test', '-e', fake]).code === 0) throw new Error('a gh already sits at /usr/local/sbin/gh: the fake is never written over a real one');
  must(root(['install', '-m', '0755', '-o', 'root', '-g', 'root', join(ROOT, 'tests/infra/deploy-real/fixtures/gh'), fake]), 'fake gh');
  // the two real deploy units (ruling 1ccc4fb9): `first-deploy` enables the timer for real; the undo stops both, removes both and reloads
  for (const u of ['polycarpic-deploy@.service', 'polycarpic-deploy@.timer']) must(root(['install', '-m', '0644', '-o', 'root', '-g', 'root', join(ROOT, 'infra/deploy/systemd', u), `/etc/systemd/system/${u}`]), `unit ${u}`);
  must(root(['systemctl', 'daemon-reload']), 'daemon-reload');
  must(sh(`install -m 0600 /dev/null ${RUN}/gh-calls.log && touch ${RUN}/prepared`), 'prepared marker');
}

/** A registry answering as ghcr.io over TLS: a CA made here, /etc/hosts, /etc/docker/certs.d/ghcr.io, a `registry:2` container on 127.0.0.1:443. */
function registry(): void {
  const certs = `${RUN}/certs`;
  must(sh(`install -d -m 0700 ${certs} && cd ${certs} && openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -subj /CN=poly-deploy-real-ca -days 1 2> /dev/null \
    && openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj /CN=ghcr.io 2> /dev/null \
    && printf 'subjectAltName=DNS:ghcr.io\\n' > san.ext && openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 1 -extfile san.ext 2> /dev/null \
    && chmod 0644 server.key ca.crt server.crt`), 'registry certificates');
  must(sh(`install -d -m 0755 /etc/docker/certs.d/ghcr.io && cp ${certs}/ca.crt /etc/docker/certs.d/ghcr.io/ca.crt && printf '127.0.0.1 ghcr.io # poly-deploy-real\\n' >> /etc/hosts`), 'hosts and CA');
  must(sh(`docker run -d --name poly-deploy-real-registry -p 127.0.0.1:443:5000 -v ${certs}:/certs:ro -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/server.crt -e REGISTRY_HTTP_TLS_KEY=/certs/server.key registry:2`), 'registry container');
  for (let i = 0; i < 30; i++) {
    if (run(['curl', '-sf', '--cacert', '/dev/null', '--resolve', 'ghcr.io:443:127.0.0.1', '-k', 'https://ghcr.io/v2/']).code === 0) return;
    run(['sleep', '2']);
  }
  throw new Error('registry-not-up: https://ghcr.io/v2/ did not answer in 60 s');
}

// ---- commits: two real, public ones; the second descends from the first (the tool's own anonymous `git fetch` checks them) ----
export function commits(): [string, string] {
  const cached = readRoot(`${RUN}/commits.json`);
  if (cached) return JSON.parse(cached);
  const d = mkdtempSync(join(tmpdir(), 'poly-real-git-'));
  must(run(['git', 'init', '-q', d]), 'git init');
  must(run(['git', '-C', d, 'fetch', '-q', '--depth', '20', 'https://github.com/richmosko/polycarpic', 'main']), 'anonymous fetch of main (the one real network read of the test)');
  const tip = must(run(['git', '-C', d, 'rev-parse', 'FETCH_HEAD']), 'rev-parse').out.trim();
  const base = must(run(['git', '-C', d, 'rev-parse', 'FETCH_HEAD~3']), 'rev-parse parent').out.trim();
  putRoot(`${RUN}/commits.json`, JSON.stringify([base, tip]), '0600');
  return [base, tip];
}

// ---- images: the job's own, relabelled per commit, pushed to the local registry ----
const dockerRoot = (argv: string[], o: { input?: string; timeout?: number } = {}) => root(['docker', ...argv], o);

function push(local: string, name: string): string {
  const ref = `${REG}/${name}:t-${randomBytes(4).toString('hex')}`;
  must(dockerRoot(['tag', local, ref]), `tag ${name}`);
  const r = must(dockerRoot(['push', ref]), `push ${name}`);
  const m = /digest: (sha256:[0-9a-f]{64})/.exec(r.out + r.err);
  if (!m) throw new Error(`push ${name}: no digest in the output`);
  return m[1]!;
}

function derived(tag: string, base: string, commit: string, extra = '', files: Record<string, string> = {}): void {
  const ctx = mkdtempSync(join(tmpdir(), 'poly-real-img-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(ctx, n), c);
  writeFileSync(join(ctx, 'Dockerfile'), `FROM ${base}\nLABEL org.opencontainers.image.revision=${commit}\n${extra}\n`);
  must(dockerRoot(['build', '-q', '-t', tag, ctx], { timeout: 900_000 }), `build ${tag}`);
}

export type Release = { commit: string; app: string; siblings: Record<string, string> };

/** The three siblings (the job's Postgres and Caddy builds; tools is the Caddy image relabelled: staging never runs it) and an app image whose bundle names them. `badWeb`: web never answers. */
export function release(commit: string, badWeb = false): Release {
  const bases: Record<string, string> = { postgres: 'polycarpic-postgres:ci', caddy: 'polycarpic-caddy:ci', tools: 'polycarpic-caddy:ci' };
  const siblings: Record<string, string> = {};
  for (const [n, base] of Object.entries(bases)) {
    derived(`polycarpic-deploy-real-${n}:${commit.slice(0, 12)}`, base, commit);
    siblings[n] = push(`polycarpic-deploy-real-${n}:${commit.slice(0, 12)}`, `polycarpic-${n}`);
  }
  const env = ['postgres', 'tools', 'caddy'].map((n) => `POLY_${n.toUpperCase()}_IMAGE=${REG}/polycarpic-${n}@${siblings[n]}`).join('\n') + '\n';
  const files: Record<string, string> = { 'images.env': env };
  let extra = 'COPY --chown=root:root --chmod=0644 images.env /release/infra/release/images.env';
  if (badWeb) {
    files['web-main.ts'] = readFileSync(join(ROOT, 'tests/infra/deploy-real/fixtures/web-main-stub.ts'), 'utf8');
    extra += '\nCOPY --chown=root:root --chmod=0644 web-main.ts /app/apps/web/src/main.ts';
  }
  derived(`polycarpic-deploy-real-app:${commit.slice(0, 12)}${badWeb ? '-bad' : ''}`, APP_IMAGE, commit, extra, files);
  const app = push(`polycarpic-deploy-real-app:${commit.slice(0, 12)}${badWeb ? '-bad' : ''}`, 'polycarpic');
  return { commit, app, siblings };
}

/** The fake GitHub's answer: the newest successful build.yml run on main for `rel`; every digest of it attested. */
export function offer(rel: Release, runId: number): void {
  const all = [rel.app, ...Object.values(rel.siblings)];
  const prev = JSON.parse(readRoot(`${RUN}/gh.json`) ?? '{"runs":[],"artifacts":{},"attested":[]}');
  const run_ = { id: runId, head_sha: rel.commit, head_branch: 'main', event: 'push', path: '.github/workflows/build.yml', status: 'completed', conclusion: 'success' };
  putRoot(`${RUN}/gh.json`, JSON.stringify({ runs: [run_, ...prev.runs], artifacts: { ...prev.artifacts, [String(runId)]: rel.app }, attested: [...prev.attested, ...all] }), '0600');
}

// ---- the tool ----
/** install_box.py as the box's own installer runs it: the tar of the committed bundle paths on stdin; it makes /opt/polycarpic and /usr/local/sbin/polycarpic-ops. */
export function install(): Res {
  const paths = /^PATHS="([^"]+)"/m.exec(readFileSync(join(ROOT, 'infra/ops/install.sh'), 'utf8'))![1]!.split(/\s+/);
  const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', 'HEAD', '--', ...paths], { maxBuffer: 256 << 20 });
  if (tar.status !== 0) throw new Error(`git archive: ${tar.stderr}`);
  const id = 'git-' + run(['git', '-C', ROOT, 'rev-parse', 'HEAD']).out.trim().slice(0, 12);
  const argv = ['python3', '-I', join(ROOT, 'infra/ops/install_box.py'), id];
  const r = spawnSync(...(isRoot ? [argv[0]!, argv.slice(1)] : ['sudo', ['-n', ...argv]] as [string, string[]]), { input: tar.stdout, encoding: 'utf8', maxBuffer: 64 << 20 });
  const res: Res = { code: r.status ?? 127, out: r.stdout ?? '', err: r.stderr ?? '', secs: 0 };
  logRun('install_box', res);
  return res;
}

/** The installed dispatcher as root under the umask 077 it sets itself. */
export function ops(args: string[], label: string, timeout = 1_200_000): Res {
  const r = root(['sh', '-c', 'umask 077; exec "$@"', 'sh', TOOL, ...args], { timeout });
  logRun(label, r);
  return r;
}

export const stateFile = (name: string): string | null => readRoot(`${STATE}/${name}`);
export const containers = (): { name: string; image: string; status: string }[] =>
  must(dockerRoot(['ps', '-a', '--filter', 'label=com.docker.compose.project=polycarpic-staging', '--format', '{{.Names}}|{{.Image}}|{{.Status}}']), 'docker ps').out.trim().split('\n').filter(Boolean).map((l) => {
    const [name, image, status] = l.split('|');
    return { name: name!, image: image!, status: status! };
  });
export const containerImages = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of containers()) {
    const r = dockerRoot(['inspect', '-f', '{{.Config.Image}}', c.name]);
    out[c.name] = r.out.trim();
  }
  return out;
};

/** After `first-deploy` enabled the timer: assert it is enabled, then stop it and wait for the service to be inactive, so no timer poll races the steps that follow (ruling 1ccc4fb9). */
export function settleTimer(): { enabled: string } {
  const enabled = root(['systemctl', 'is-enabled', 'polycarpic-deploy@staging.timer']).out.trim();
  root(['systemctl', 'stop', 'polycarpic-deploy@staging.timer']);
  for (let i = 0; i < 60; i++) {
    if (root(['systemctl', 'is-active', 'polycarpic-deploy@staging.service']).out.trim() !== 'active') return { enabled };
    run(['sleep', '2']);
  }
  throw new Error('timer-service-still-active: polycarpic-deploy@staging.service did not become inactive in 120 s');
}
