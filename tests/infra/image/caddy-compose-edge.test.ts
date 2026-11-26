// POLY-104 F18 (first real box): Caddy could not exec (`operation not permitted`) and edge-deploy rolled back. No test had ever started our Caddy
// image under infra/compose/edge.yml's own settings. This one is a real `docker compose up` of the edge project from that file. The override moves
// only what a runner cannot have: the two host data directories (named volumes, owned and moded as provision.sh leaves them, so Linux enforces
// them on a Mac too), the secret file's host path, the two network names, and the HOST side of the two published ports.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT, sh } from './stack.ts';

const IMG = 'poly104-caddy:test';
const tag = randomBytes(3).toString('hex');
const PROJECT = `poly104edge${tag}`;
const DOMAIN = 'poly.test';
const FILE = join(ROOT, 'infra', 'compose', 'edge.yml');
const SVC = (parse(readFileSync(FILE, 'utf8')) as { services: { caddy: { user: string; read_only: boolean; cap_drop: string[]; security_opt: string[]; tmpfs: string[]; volumes: string[]; ports: string[] } } }).services.caddy;
const [UID, GID] = SVC.user.split(':') as [string, string];
const VOLUMES = { '/data': `${PROJECT}-data`, '/config': `${PROJECT}-config` };
const NETS = { 'edge-prod': `${PROJECT}-edge-prod`, 'edge-staging': `${PROJECT}-edge-staging` };
const ENV = { POLY_CADDY_IMAGE: IMG, POLY_DOMAIN: DOMAIN, POLY_TLS: 'internal', POLY_STAGING_ALLOW: '0.0.0.0/0 ::/0', POLY_BIND_ADDR: '127.0.0.1' };

let dir = '', override = '', upError = '';
const ports: Record<string, string> = {};
const compose = (...a: string[]) => sh('docker', ['compose', '-p', PROJECT, '-f', FILE, '-f', override, ...a], { env: ENV });
/** a root shell in a throwaway container of the same image: for fixtures a runner without sudo cannot make */
const asRoot = (script: string, mounts: string[]) => sh('docker', ['run', '--rm', '--user', '0:0', ...mounts.flatMap((m) => ['-v', m]), '--entrypoint', 'sh', IMG, '-c', script]);
const cid = () => compose('ps', '-a', '-q', 'caddy').out.split('\n')[0] ?? '';
const logs = () => { const r = compose('logs', '--no-color', 'caddy'); return `${r.out}\n${r.err}`; };
const state = () => `compose up: ${upError || 'ok'}\n${logs().slice(-1500)}`;
const curl = (url: string, extra: string[] = []) => {
  const u = new URL(url);
  const r = sh('curl', ['-ksS', '-D', '-', '-o', '/dev/null', '--max-time', '15', '--connect-to', `${u.host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}:127.0.0.1:${ports[u.protocol === 'https:' ? '8443' : '8080'] ?? '1'}`, ...extra, url]);
  return { status: Number(/^HTTP\/\S+ (\d+)/.exec(r.out)?.[1] ?? 0), head: r.out.toLowerCase(), err: r.err };
};

beforeAll(() => {
  const b = sh('docker', ['build', '-t', IMG, join(ROOT, 'infra', 'caddy')]);
  if (b.code !== 0) throw new Error(`docker build infra/caddy failed: ${b.err.slice(-500)}`);
  // data directories: <uid>:<gid> 0700 (POLY-104 F6). nocopy below, or Docker would copy the image's root-owned /data over an empty volume.
  for (const v of Object.values(VOLUMES)) {
    sh('docker', ['volume', 'create', v]);
    const r = asRoot(`chown ${UID}:${GID} /d && chmod 0700 /d`, [`${v}:/d`]);
    if (r.code !== 0) throw new Error(`preparing ${v}: ${r.err}`);
  }
  // the secret as the box holds it: root:<caddy gid> 0440
  dir = mkdtempSync(join(tmpdir(), 'poly104-edge-'));
  chmodSync(dir, 0o755);
  // hashed in a plain container: under edge.yml's settings the binary under test may not start at all
  const hash = sh('docker', ['run', '--rm', IMG, 'caddy', 'hash-password', '--plaintext', 'pw']);
  if (hash.code !== 0) throw new Error(`caddy hash-password: ${hash.err}`);
  writeFileSync(join(dir, 'staging_basic_auth'), `qa ${hash.out.trim()}\n`);
  const own = asRoot(`chown 0:${GID} /w/staging_basic_auth && chmod 0440 /w/staging_basic_auth`, [`${dir}:/w`]);
  if (own.code !== 0) throw new Error(`preparing the secret: ${own.err}`);
  for (const n of Object.values(NETS)) sh('docker', ['network', 'create', n]);
  override = join(dir, 'override.yml');
  writeFileSync(override, [
    'services:', '  caddy:', '    ports: !override', "      - '127.0.0.1::8080'", "      - '127.0.0.1::8443'",
    '    volumes:', ...Object.entries(VOLUMES).flatMap(([target, v]) => ['      - type: volume', `        source: ${v}`, `        target: ${target}`, '        volume: {nocopy: true}']),
    'volumes:', ...Object.values(VOLUMES).map((v) => `  ${v}: {external: true}`),
    'networks:', ...Object.entries(NETS).map(([k, n]) => `  ${k}: {name: ${n}, external: true}`),
    'secrets:', `  staging_basic_auth__caddy: {file: ${join(dir, 'staging_basic_auth')}}`, '',
  ].join('\n'));
  const u = compose('up', '-d', 'caddy');
  if (u.code !== 0) { upError = u.err.trim().split('\n').slice(-3).join(' | '); return; }
  for (const p of ['8080', '8443']) ports[p] = compose('port', 'caddy', p).out.trim().split(':').pop() ?? '';
  for (let i = 0; i < 30; i++) { if (curl(`https://app.${DOMAIN}/`).status) break; sh('sleep', ['1']); }
});
afterAll(() => {
  if (override) compose('down', '--remove-orphans', '-t', '2');
  for (const v of Object.values(VOLUMES)) sh('docker', ['volume', 'rm', '-f', v]);
  for (const n of Object.values(NETS)) sh('docker', ['network', 'rm', n]);
  if (dir) asRoot('rm -f /w/staging_basic_auth', [`${dir}:/w`]);
});

describe('F18: the edge project, as infra/compose/edge.yml defines it', () => {
  it('control: edge.yml still publishes to 8080 and 8443 and mounts /data and /config, the parts the override stands in for', () => {
    expect(SVC.ports.map((p) => p.split(':').pop()).sort()).toEqual(['8080', '8443']);
    expect(SVC.volumes.map((v) => v.split(':')[1]).sort()).toEqual(Object.keys(VOLUMES).sort());
  });

  it('the container runs with the file\'s own user, read-only root, dropped capabilities, no-new-privileges and tmpfs', () => {
    const id = cid();
    expect(id, state()).not.toBe('');
    const [i] = JSON.parse(sh('docker', ['inspect', id]).out) as [{ Config: { User: string }; HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; CapAdd: string[] | null; SecurityOpt: string[]; Tmpfs: Record<string, string> } }];
    expect([i.Config.User, i.HostConfig.ReadonlyRootfs, i.HostConfig.CapDrop, i.HostConfig.CapAdd ?? [], i.HostConfig.SecurityOpt, Object.keys(i.HostConfig.Tmpfs)])
      .toEqual([SVC.user, SVC.read_only, SVC.cap_drop, [], SVC.security_opt, SVC.tmpfs]);
  });

  // the file's own healthcheck, not a faster one from the override: its first run comes one interval (60 s) after the start
  it('starts and stays up: still running after 30 s, never restarted, and healthy by edge.yml\'s own healthcheck', { timeout: 150_000 }, () => {
    expect(upError, state()).toBe('');
    const read = () => {
      const [running, restarts, health, started] = sh('docker', ['inspect', '-f', '{{.State.Running}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.StartedAt}}', cid()]).out.trim().split(' ');
      return { running, restarts, health, age: (Date.now() - Date.parse(started ?? '')) / 1000 };
    };
    let s = read();
    for (let i = 0; i < 100 && s.running === 'true' && s.restarts === '0' && (s.health === 'starting' || s.age < 30); i++) { sh('sleep', ['1']); s = read(); }
    expect([s.running, s.restarts, s.health], state()).toEqual(['true', '0', 'healthy']);
    expect(s.age, 'seconds up').toBeGreaterThanOrEqual(30);
  });

  it('its process 1 is caddy and holds no capability at all: CapPrm, CapEff and CapBnd are zero', () => {
    const r = compose('exec', '-T', 'caddy', 'cat', '/proc/1/status');
    expect(r.code, r.err + state()).toBe(0);
    const field = (name: string) => new RegExp(`^${name}:\\s+(\\S+)$`, 'm').exec(r.out)?.[1];
    expect([field('Name'), field('CapPrm'), field('CapEff'), field('CapBnd')]).toEqual(['caddy', ...Array(3).fill('0000000000000000')]);
  });

  it('answers on 8443 for both sites (no upstream here: 502), asks staging for its password from the mounted secret, and redirects 8080 to https', () => {
    const app = curl(`https://app.${DOMAIN}/`);
    expect(app.status, app.err + state()).toBe(502);
    expect(app.head).toContain('strict-transport-security: max-age=31536000');
    expect(curl(`https://staging.${DOMAIN}/`).status, state()).toBe(401);
    expect(curl(`https://staging.${DOMAIN}/`, ['-u', 'qa:wrong']).status, state()).toBe(401);
    expect(curl(`https://staging.${DOMAIN}/`, ['-u', 'qa:pw']).status, state()).toBe(502);
    const plain = curl(`http://app.${DOMAIN}/x`);
    expect([301, 302, 308], plain.err + state()).toContain(plain.status);
    expect(plain.head).toContain(`location: https://app.${DOMAIN}/x`);
  });

  it('keeps its certificate authority in /data as its own user, and logs no permission or read-only error', () => {
    const r = asRoot(`find /data -type f | head -n 20; echo ==; find /data /config -mindepth 1 ! -user ${UID} | wc -l`, [`${VOLUMES['/data']}:/data`, `${VOLUMES['/config']}:/config`]);
    const [files, foreign] = r.out.split('==\n') as [string, string];
    expect(files, state()).toMatch(/\/data\/.*root\.(crt|key)/);
    expect(foreign.trim()).toBe('0');
    expect(logs().split('\n').filter((l) => /permission denied|read-only file system|operation not permitted/i.test(l)), state()).toEqual([]);
  });
});

// Every container of ours runs with cap_drop ALL: a binary with an effective file capability then fails to exec, and one without the effective bit has
// no use for it. The merged filesystem is what is asked (`docker export`), not one layer.
describe('F18: no file in any of our images carries security.capability', () => {
  const scan = (image: string): { entries: number; capabilities: string[] } => {
    const name = `poly104-scan-${tag}-${Math.random().toString(36).slice(2, 8)}`;
    const c = sh('docker', ['create', '--name', name, image]);
    if (c.code !== 0) throw new Error(`docker create ${image}: ${c.err}`);
    try {
      const r = sh('bash', ['-c', 'set -o pipefail; docker export "$1" | python3 -I "$2"', 'scan', name, join(ROOT, 'tests', 'infra', 'image', 'file-caps.py')]);
      if (r.code !== 0) throw new Error(`scanning ${image}: ${r.err}`);
      const out = JSON.parse(r.out) as { entries: number; capabilities: string[] };
      if (out.entries < 100) throw new Error(`scanning ${image}: only ${out.entries} entries`);
      return out;
    } finally { sh('docker', ['rm', '-f', name]); }
  };

  it('control: the scan finds the capability the official Caddy base image ships on usr/bin/caddy', () => {
    const base = /^FROM (caddy:\S+@sha256:[0-9a-f]{64})\s*$/m.exec(readFileSync(join(ROOT, 'infra', 'caddy', 'Dockerfile'), 'utf8'))?.[1];
    expect(base, 'the final FROM of infra/caddy/Dockerfile').toBeDefined();
    sh('docker', ['pull', '-q', base!]);
    expect(scan(base!).capabilities).toContain('usr/bin/caddy');
  });

  it('caddy: none, usr/bin/caddy included', () => { expect(scan(IMG).capabilities).toEqual([]); });

  it('postgres: none', () => {
    const b = sh('docker', ['build', '-t', 'poly104-pg:test', join(ROOT, 'infra', 'postgres')]);
    expect(b.code, b.err.slice(-500)).toBe(0);
    expect(scan('poly104-pg:test').capabilities).toEqual([]);
  });

  it('app (web, worker, migrate, operator, auth): none', () => {
    const app = process.env.POLY_APP_TEST_IMAGE ?? 'polycarpic:ci'; // the image job passes the one it built; locally `bash infra/ci/image.sh build` makes polycarpic:ci
    expect(sh('docker', ['image', 'inspect', '-f', 'ok', app]).out, `no image ${app}: set POLY_APP_TEST_IMAGE`).toBe('ok');
    expect(scan(app).capabilities).toEqual([]);
  });
});
