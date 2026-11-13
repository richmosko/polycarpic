// POLY-95 R7 / R4 / R1 / criteria 1, 4, 5: the compose-policy lint, infra/lint/compose-policy.mjs.
//
// CLI CONTRACT (the seam these tests pin; the ruling names the file, not the flags):
//   node infra/lint/compose-policy.mjs --root <dir> [--policy <file>]
//   env POLY_POSTGRES_IMAGE and POLY_BIND_ADDR are passed through to `docker compose config` (the files use ${POLY_POSTGRES_IMAGE:?}).
//   <dir> mirrors the repo: infra/compose/{edge,prod,staging}.yml, infra/postgres/{Dockerfile,pg_hba.*.conf,
//   postgresql.*.conf}, infra/postgres-major, infra/caddy/Caddyfile, .github/workflows/*.yml, tests/db/docker/Dockerfile.
//   Each of edge/prod/staging.yml is rendered on its own (`docker compose -f <file> --profile '*' config --format json`);
//   they are separate projects. Default policy: infra/lint/policy.json beside the script.
//   Exit 0 = clean. Non-zero = violation, and stderr carries one `[rule-id]` per violation (ids in the table below).
//   Fail closed: a render error, or no compose file under <root>/infra/compose/, exits non-zero.
// Every fail fixture is the pass fixture (baseline.ts) with ONE mutation. The last column names what, if the lint
// regressed that way, turns the test red; the test itself is red now because the script does not exist.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, giveSecret, materialise, PG_DIGEST, PG_IMAGE_ENV, secretFile, type FxSet } from './baseline.ts';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const LINT = join(ROOT, 'infra', 'lint', 'compose-policy.mjs');

/** POLY-95 A2: async spawn so cases run concurrently (describe.concurrent, maxConcurrency 4); every case still runs the CLI end to end. */
type Out = { status: number | null; stdout: string; stderr: string };
function spawnAsync(cmd: string, args: string[], o: { encoding?: string; env?: Record<string, string> } = {}): Promise<Out> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: o.env ?? { PATH: process.env.PATH ?? '' } });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('error', (e) => resolve({ status: 127, stdout, stderr: stderr + String(e) }));
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

async function lint(root: string) {
  if (!existsSync(LINT)) throw new Error('infra/lint/compose-policy.mjs does not exist');
  const r = await spawnAsync('node', [LINT, '--root', root], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' },
  });
  return { code: r.status, err: r.stderr ?? '', out: r.stdout ?? '' };
}
async function runSet(mut: (s: FxSet) => void, opts: { skipCompose?: string[] } = {}) {
  const s = baseline();
  mut(s);
  const root = mkdtempSync(join(tmpdir(), 'poly95-lint-'));
  made.push(root);
  materialise(root, s, opts);
  return lint(root);
}
const svc = (s: FxSet, p: 'prod' | 'staging' | 'edge', n: string) => s[p].services[n];
const rule = (id: string) => new RegExp(`\\[${id}\\]`);

describe.concurrent('compose-policy lint: pass fixtures', () => {
  it('the baseline set (edge + prod + staging + pg files + Caddyfile) is clean', async () => {
    const r = await runSet(() => {});
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
  });
  it('a different major is clean when infra/postgres-major and the FROM line agree (18 / 18.1)', async () => {
    const r = await runSet((s) => {
      s.text['infra/postgres-major'] = '18\n';
      s.text['infra/postgres/Dockerfile'] = s.text['infra/postgres/Dockerfile']!.replace('postgres:17.10', 'postgres:18.1');
    });
    expect(r.code).toBe(0); // red if the lint hardcodes 17
  });
  it('the repo itself is clean (the builder\'s real files satisfy the rules the fixtures pin)', async () => {
    expect(await lint(ROOT)).toMatchObject({ code: 0 }); // red until infra/compose etc. exist and comply
  });
});

// [name, mutation applied to the pass set, expected rule id, what turns the test red]
type Row = [string, (s: FxSet) => void, string, string];
const ROWS: Row[] = [
  // INFRA §2.2 hardening list, per service shape
  ['root user (uid 0)', (s) => { svc(s, 'prod', 'web').user = '0:0'; }, 'user-nonroot', 'uid 0 accepted'],
  ['user missing', (s) => { delete svc(s, 'prod', 'worker').user; }, 'user-nonroot', 'missing user: accepted (image default may be root)'],
  ['read_only false', (s) => { svc(s, 'prod', 'web').read_only = false; }, 'read-only', 'read_only not checked'],
  ['cap_drop missing', (s) => { delete svc(s, 'prod', 'worker').cap_drop; }, 'cap-drop', 'cap_drop: [ALL] not required'],
  ['cap_drop partial', (s) => { svc(s, 'prod', 'worker').cap_drop = ['NET_RAW']; }, 'cap-drop', 'any cap_drop accepted instead of ALL'],
  ['no-new-privileges missing', (s) => { delete svc(s, 'staging', 'web').security_opt; }, 'no-new-privs', 'security_opt not required'],
  ['restart missing', (s) => { delete svc(s, 'prod', 'web').restart; }, 'restart', 'restart policy not required'],
  ['healthcheck missing', (s) => { delete svc(s, 'prod', 'worker').healthcheck; }, 'healthcheck', 'healthcheck not required'],
  ['image by tag only', (s) => { svc(s, 'prod', 'web').image = 'ghcr.io/richmosko/polycarpic:latest'; }, 'image-digest', 'tag-only image accepted'],
  ['image digest truncated', (s) => { svc(s, 'prod', 'uploader').image = 'ghcr.io/x/tools@sha256:abc'; }, 'image-digest', 'digest length/hex not validated'],
  ['build: present', (s) => { svc(s, 'prod', 'web').build = '.'; }, 'no-build', 'build: allowed'],
  // C-70 bypasses
  ['network_mode: host', (s) => { svc(s, 'prod', 'worker').network_mode = 'host'; }, 'network-mode', 'network_mode not checked'],
  ['network_mode: service:postgres', (s) => { svc(s, 'prod', 'worker').network_mode = 'service:postgres'; }, 'network-mode', 'only host rejected'],
  ['pid: host', (s) => { svc(s, 'prod', 'worker').pid = 'host'; }, 'host-namespace', 'pid not checked'],
  ['ipc: host', (s) => { svc(s, 'prod', 'worker').ipc = 'host'; }, 'host-namespace', 'ipc not checked'],
  ['userns_mode: host', (s) => { svc(s, 'prod', 'worker').userns_mode = 'host'; }, 'host-namespace', 'userns_mode not checked'],
  ['privileged: true', (s) => { svc(s, 'prod', 'worker').privileged = true; }, 'privileged', 'privileged not checked'],
  ['cap_add', (s) => { svc(s, 'prod', 'worker').cap_add = ['NET_ADMIN']; }, 'cap-add', 'cap_add not checked'],
  ['devices', (s) => { svc(s, 'prod', 'worker').devices = ['/dev/kmsg:/dev/kmsg']; }, 'devices', 'devices not checked'],
  ['seccomp unconfined', (s) => { svc(s, 'prod', 'worker').security_opt = ['no-new-privileges:true', 'seccomp=unconfined']; }, 'unconfined', 'seccomp=unconfined accepted'],
  ['apparmor unconfined', (s) => { svc(s, 'prod', 'worker').security_opt = ['no-new-privileges:true', 'apparmor=unconfined']; }, 'unconfined', 'apparmor=unconfined accepted'],
  ['docker.sock mounted', (s) => { svc(s, 'prod', 'worker').volumes = ['/var/run/docker.sock:/var/run/docker.sock']; }, 'docker-sock', 'docker.sock volume accepted'],
  ['docker.sock via /run symlink path', (s) => { svc(s, 'staging', 'worker').volumes = ['/run/docker.sock:/s']; }, 'docker-sock', 'only /var/run/docker.sock matched'],
  ['env_file', (s) => { svc(s, 'prod', 'worker').env_file = ['/etc/polycarpic/host.env']; }, 'env-file', 'env_file not checked'],
  ['secret-looking environment key', (s) => { svc(s, 'prod', 'web').environment = { DB_PASSWORD: 'x' }; }, 'env-secret', 'secret-looking env not checked'],
  ['API key in environment', (s) => { svc(s, 'prod', 'web').environment = { RESEND_API_KEY: 'x' }; }, 'env-secret', 'only PASSWORD matched'],
  ['secret with environment source', (s) => { s.prod.secrets.auth_secret__web = { environment: 'AUTH' }; }, 'secret-source', 'environment-sourced secret accepted'],
  ['config with inline content', (s) => { s.prod.configs = { c: { content: 'k=v' } }; svc(s, 'prod', 'web').configs = ['c']; }, 'config-inline', 'inline config content accepted'],
  ['${VAR} in ports', (s) => { svc(s, 'edge', 'caddy').ports = ['${BIND:-0.0.0.0}:443:443']; }, 'raw-interpolation', 'interpolation in ports allowed'],
  ['${VAR} in volumes', (s) => { svc(s, 'prod', 'web').volumes = ['${DATA}:/data']; }, 'raw-interpolation', 'interpolation in volumes allowed'],
  ['${VAR} in networks', (s) => { s.prod.networks.default.name = '${EDGE}'; }, 'raw-interpolation', 'interpolation in networks allowed'],
  ['${VAR} in secrets', (s) => { s.prod.secrets.auth_secret__web.file = '${DIR}/auth_secret'; }, 'raw-interpolation', 'interpolation in secrets allowed'],
  ['compose.override.yml present', (s) => { s.text['infra/compose/compose.override.yml'] = 'services: {}\n'; }, 'override-file', 'override file tolerated'],
  ['extra -c flag on postgres', (s) => { svc(s, 'prod', 'postgres').command.push('-c', "log_statement='all'"); }, 'extra-c-flag', 'any -c accepted, bypassing the config file'],
  // ports, networks, edge
  ['sysctls', (s) => { svc(s, 'prod', 'worker').sysctls = { 'net.ipv4.ip_forward': '1' }; }, 'sysctls', 'sysctls not checked'],
  ['extra_hosts', (s) => { svc(s, 'prod', 'worker').extra_hosts = ['x:10.0.0.1']; }, 'extra-hosts', 'extra_hosts not checked'],
  ['links', (s) => { svc(s, 'prod', 'worker').links = ['postgres']; }, 'links', 'links not checked'],
  ['external_links', (s) => { svc(s, 'prod', 'worker').external_links = ['x:y']; }, 'links', 'external_links not checked'],
  ['network_mode: bridge (any value)', (s) => { svc(s, 'prod', 'worker').network_mode = 'bridge'; }, 'network-mode', 'only host/service: rejected'],
  ['/var/run mounted', (s) => { svc(s, 'prod', 'worker').volumes = ['/var/run:/r']; }, 'mount-forbidden', '/var/run not on the forbidden list'],
  ['/run mounted', (s) => { svc(s, 'prod', 'worker').volumes = ['/run:/r']; }, 'mount-forbidden', '/run not on the forbidden list'],
  ['/ mounted', (s) => { svc(s, 'prod', 'worker').volumes = ['/:/host:ro']; }, 'mount-forbidden', 'root mount accepted'],
  ['bind not in the service allowlist', (s) => { svc(s, 'prod', 'web').volumes = ['/srv/polycarpic/pg-prod:/data:ro']; }, 'mount-allowlist', 'default allow instead of default deny'],
  ['allowlisted config bind made writable', (s) => { svc(s, 'prod', 'postgres').volumes[1] = '../postgres/postgresql.prod.conf:/etc/postgresql/postgresql.conf'; }, 'mount-allowlist', ':ro not required'],
  ['POLY_BIND_ADDR with a default value', (s) => { svc(s, 'edge', 'caddy').ports = ['${POLY_BIND_ADDR:-0.0.0.0}:443:8443']; }, 'raw-interpolation', 'a default value allowed (a missing address binds 0.0.0.0)'],
  ['${VAR} in user', (s) => { svc(s, 'prod', 'web').user = '${UID}:10001'; }, 'raw-interpolation', 'interpolation allowed outside images/bind addr'],
  ['${VAR} in healthcheck', (s) => { svc(s, 'prod', 'web').healthcheck.test = ['CMD', '${X}']; }, 'raw-interpolation', 'healthcheck not scanned'],
  ['DATABASE_URL in environment', (s) => { svc(s, 'prod', 'web').environment = { DATABASE_URL: 'x' }; }, 'env-secret', 'DSN/DATABASE_URL not matched'],
  ['_FILE env pointing outside /run/secrets', (s) => { svc(s, 'prod', 'web').environment = { DB_PASSWORD_FILE: '/etc/passwd' }; }, 'env-secret', 'any *_FILE value accepted'],
  ['POLY_BIND_ADDR without :? (no guard)', (s) => { svc(s, 'edge', 'caddy').ports = ['${POLY_BIND_ADDR}:443:8443']; }, 'raw-interpolation', 'unguarded variable allowed (empty binds 0.0.0.0)'],
  ['plain 80:80 with no bind address', (s) => { svc(s, 'edge', 'caddy').ports = ['80:80', '443:8443']; }, 'ports-bind', 'ports without POLY_BIND_ADDR allowed'],
  ['docker-compose.override.yaml present', (s) => { s.text['infra/compose/docker-compose.override.yaml'] = 'services: {}\n'; }, 'override-file', 'only compose.override.yml matched'],
  ['${VAR} in cap_drop', (s) => { svc(s, 'prod', 'web').cap_drop = ['${CAP}']; }, 'raw-interpolation', 'cap_drop not scanned'],
  ['${VAR} in security_opt', (s) => { svc(s, 'prod', 'web').security_opt = ['${SO}']; }, 'raw-interpolation', 'security_opt not scanned'],
  ['root service hidden behind a profile', (s) => { s.prod.services.dbg = { ...svc(s, 'prod', 'worker'), user: '0:0', profiles: ['debug'] }; }, 'user-nonroot', 'profiled services skipped (--profile * not used)'],
  ['FOO_FILE env pointing outside /run/secrets', (s) => { svc(s, 'prod', 'web').environment = { FOO_FILE: '/etc/x' }; }, 'env-secret', '*_FILE accepted without the path check'],
  ['two services share one host secret file', (s) => { s.prod.secrets.resend_api_key__worker.file = s.prod.secrets.resend_api_key__web.file; }, 'secret-path', 'one file with two readers accepted'],
  ['ports: on web', (s) => { svc(s, 'prod', 'web').ports = ['3000:3000']; }, 'ports-caddy-only', 'ports allowed outside caddy'],
  ['ports: on postgres', (s) => { svc(s, 'staging', 'postgres').ports = ['5432:5432']; }, 'ports-caddy-only', 'staging not scanned'],
  ['caddy on a project default network', (s) => {
    s.edge.networks.d = { name: 'polycarpic-prod_default', external: true };
    svc(s, 'edge', 'caddy').networks.push('d');
  }, 'edge-network', 'caddy allowed on _default'],
  ['postgres on the edge network', (s) => { svc(s, 'prod', 'postgres').networks.push('edge-prod'); }, 'edge-network', 'edge membership not limited to caddy+web'],
  ['worker on the edge network', (s) => { svc(s, 'prod', 'worker').networks.push('edge-prod'); }, 'edge-network', 'edge membership not limited to caddy+web'],
  ['web (not caddy) on both projects\' edge networks', (s) => {
    s.prod.networks['edge-staging'] = { name: 'polycarpic-edge-staging', external: true };
    svc(s, 'prod', 'web').networks.push('edge-staging');
  }, 'cross-project', 'cross-project membership allowed for services other than caddy'],
  ['staging service on the prod default network', (s) => {
    s.staging.networks.prodnet = { name: 'polycarpic-prod_default', external: true };
    svc(s, 'staging', 'web').networks.push('prodnet');
  }, 'cross-project', 'only the edge network compared'],
  ['edge subnet overlaps a pg_hba allow CIDR', (s) => { s.edge.networks['edge-prod'].ipam.config[0].subnet = '10.201.1.0/28'; }, 'edge-overlap', 'edge subnets not compared with pg_hba allow lines'],
  ['edge network without a fixed subnet', (s) => { delete s.edge.networks['edge-staging'].ipam; }, 'edge-overlap', 'unfixed edge subnet accepted'],
  // C-79
  ['backup-net not internal', (s) => { s.prod.networks['backup-net'].internal = false; }, 'backup-net-internal', 'internal: true not required'],
  ['backup-net without a fixed subnet', (s) => { delete s.prod.networks['backup-net'].ipam; }, 'backup-net-subnet', 'missing subnet accepted'],
  ['backup-net subnet differs from pg_hba', (s) => { s.prod.networks['backup-net'].ipam.config[0].subnet = '10.201.10.8/29'; }, 'backup-net-subnet', 'subnet not compared to the poly_backup pg_hba lines'],
  ['pg_hba poly_backup subnet differs from backup-net', (s) => {
    s.text['infra/postgres/pg_hba.prod.conf'] = s.text['infra/postgres/pg_hba.prod.conf']!.replaceAll('10.201.10.0/29', '10.201.10.0/28');
  }, 'backup-net-subnet', 'comparison reads the compose side twice'],
  ['web on backup-net', (s) => { svc(s, 'prod', 'web').networks.push('backup-net'); }, 'backup-net-members', 'membership not limited to postgres+backup'],
  ['backup missing from backup-net', (s) => { svc(s, 'prod', 'backup').networks = ['upload-net']; }, 'backup-net-members', 'only extra members checked'],
  ['backup on the default network', (s) => { svc(s, 'prod', 'backup').networks.push('default'); }, 'backup-net-members', 'backup allowed on the app network'],
  ['uploader on the default network', (s) => { svc(s, 'prod', 'uploader').networks.push('default'); }, 'uploader-isolation', 'uploader sharing a network with postgres allowed'],
  ['uploader on backup-net', (s) => { svc(s, 'prod', 'uploader').networks.push('backup-net'); }, 'uploader-isolation', 'uploader sharing backup-net with postgres allowed'],
  // secret matrix and per-service paths (ruling A1)
  ['db_password_backup in a second service', (s) => { giveSecret(s.prod, true, 'worker', 'db_password_backup'); }, 'secret-matrix', 'second consumer of db_password_backup accepted'],
  ['backup_store_credential in backup', (s) => { giveSecret(s.prod, true, 'backup', 'backup_store_credential'); }, 'secret-matrix', 'second consumer of the bucket pair accepted'],
  ['backup also holds the superuser secret', (s) => { giveSecret(s.prod, true, 'backup', 'db_superuser_password'); }, 'secret-matrix', 'per-service allowlist not enforced, only per-secret'],
  ['credential_keyring in web', (s) => { giveSecret(s.prod, true, 'web', 'credential_keyring'); }, 'secret-matrix', 'web may open credentials'],
  ['unknown secret not in the matrix', (s) => { giveSecret(s.prod, true, 'web', 'extra'); }, 'secret-matrix', 'unlisted secrets pass'],
  ['staging secret not in the staging matrix', (s) => { giveSecret(s.staging, false, 'web', 'db_password_backup'); }, 'secret-matrix', 'staging matrix not applied'],
  ['web secret sourced from worker\'s directory', (s) => { s.prod.secrets.db_password_app__web.file = secretFile(true, 'worker', 'db_password_app'); }, 'secret-path', 'service-own directory not enforced'],
  ['flat secret path (no service directory)', (s) => { s.prod.secrets.auth_secret__web.file = '/etc/polycarpic/secrets/auth_secret'; }, 'secret-path', 'flat layout accepted'],
  ['prod secret under staging-secrets', (s) => { s.prod.secrets.auth_secret__web.file = secretFile(false, 'web', 'auth_secret'); }, 'secret-path', 'prod path prefix not checked'],
  ['staging secret under secrets', (s) => { s.staging.secrets.auth_secret__web.file = secretFile(true, 'web', 'auth_secret'); }, 'secret-path', 'staging path prefix not checked'],
  ['secret path outside /etc/polycarpic', (s) => { s.prod.secrets.auth_secret__web.file = '/tmp/web/auth_secret'; }, 'secret-path', 'any absolute path accepted'],
  ['caddy secret from another service\'s directory', (s) => { s.edge.secrets.staging_basic_auth__caddy.file = secretFile(true, 'web', 'staging_basic_auth'); }, 'secret-path', 'edge project not checked'],
  // per-service identities
  ['two services share a uid', (s) => { svc(s, 'prod', 'worker').user = '10001:10002'; }, 'user-distinct', 'uid uniqueness not checked'],
  ['two services share a gid', (s) => { svc(s, 'prod', 'worker').user = '10002:10001'; }, 'user-distinct', 'gid uniqueness not checked'],
  ['non-numeric user', (s) => { svc(s, 'prod', 'web').user = 'node'; }, 'user-nonroot', 'a user name accepted (image defaults not trusted)'],
  ['uid without gid', (s) => { svc(s, 'prod', 'web').user = '10001'; }, 'user-nonroot', 'bare uid accepted'],
  ['group_add', (s) => { svc(s, 'prod', 'web').group_add = ['10002']; }, 'group-add', 'group_add lets a service read another\'s files'],
  // R4: one place for tag + digest
  ['compose retypes the postgres tag', (s) => { svc(s, 'prod', 'postgres').image = 'postgres:17.10'; }, 'postgres-tag-literal', 'literal postgres:<digit> in compose accepted'],
  ['compose retypes tag+digest on staging', (s) => { svc(s, 'staging', 'postgres').image = `postgres:17.10@${PG_DIGEST}`; }, 'postgres-tag-literal', 'only prod scanned, or only tag-only matched'],
  ['backup image differs from postgres image', (s) => { svc(s, 'prod', 'backup').image = `ghcr.io/richmosko/polycarpic-postgres:17.10@sha256:${'e'.repeat(64)}`; }, 'image-var-same', 'postgres/backup equality not asserted'],
  ['workflow retypes postgres tag', (s) => { s.text['.github/workflows/ci.yml'] += '    # services:\n  x:\n    services:\n      pg:\n        image: postgres:17.10\n'; }, 'postgres-tag-literal', '.github/workflows not scanned'],
  ['db test Dockerfile retypes FROM postgres:17', (s) => { s.text['tests/db/docker/Dockerfile'] = s.text['tests/db/docker/Dockerfile']!.replace('FROM ${PG_BASE}', 'FROM postgres:17'); }, 'postgres-tag-literal', 'tests/db/docker not scanned'],
  ['FROM line without a digest', (s) => { s.text['infra/postgres/Dockerfile'] = s.text['infra/postgres/Dockerfile']!.replace(`@${PG_DIGEST}`, ''); }, 'from-digest', 'FROM line need not carry @sha256:<64 hex>'],
  ['FROM line digest malformed', (s) => { s.text['infra/postgres/Dockerfile'] = s.text['infra/postgres/Dockerfile']!.replace(PG_DIGEST, 'sha256:zz'); }, 'from-digest', 'digest shape not validated'],
  // criterion 5
  ['FROM major 18, infra/postgres-major 17', (s) => { s.text['infra/postgres/Dockerfile'] = s.text['infra/postgres/Dockerfile']!.replace('postgres:17.10', 'postgres:18.1'); }, 'major-drift', 'major comparison missing'],
  ['infra/postgres-major 18, FROM major 17', (s) => { s.text['infra/postgres-major'] = '18\n'; }, 'major-drift', 'comparison one-directional or reads the wrong file'],
  ['infra/postgres-major has trailing junk', (s) => { s.text['infra/postgres-major'] = '17.1\n'; }, 'major-drift', 'file not required to be a bare major'],
  // R5 staging halves
  ['staging archive_mode on', (s) => { s.text['infra/postgres/postgresql.staging.conf'] = 'archive_mode = on\n'; }, 'staging-archive-mode', 'staging archive_mode not asserted off'],
  ['staging pg_hba admits poly_backup', (s) => { s.text['infra/postgres/pg_hba.staging.conf'] = 'host  polycarpic  poly_backup  10.202.1.0/24  scram-sha-256\n' + s.text['infra/postgres/pg_hba.staging.conf']; }, 'pg-hba-staging', 'staging allow line for poly_backup tolerated'],
  ['prod pg_hba: C-79 lines not first', (s) => {
    const l = s.text['infra/postgres/pg_hba.prod.conf']!.split('\n');
    s.text['infra/postgres/pg_hba.prod.conf'] = [...l.slice(4, 5), ...l.slice(0, 4), ...l.slice(5)].join('\n');
  }, 'pg-hba-prod', 'order of the first four lines not checked'],
  // POLY-146 AC2 / AC6 (ruling R3): the auth secret leaves the worker; the operator secret stays in the one-shot service
  ['prod worker mounts auth_secret', (s) => { giveSecret(s.prod, true, 'worker', 'auth_secret'); }, 'secret-matrix', 'the worker may hold the auth secret'],
  ['staging worker mounts auth_secret', (s) => { giveSecret(s.staging, false, 'worker', 'auth_secret'); }, 'secret-matrix', 'the staging matrix still lists auth_secret for the worker'],
  ['prod worker mounts db_password_operator', (s) => { giveSecret(s.prod, true, 'worker', 'db_password_operator'); }, 'secret-matrix', 'a long-running service may hold the operator password'],
  ['prod web mounts db_password_operator', (s) => { giveSecret(s.prod, true, 'web', 'db_password_operator'); }, 'secret-matrix', 'web may hold the operator password'],
  ['staging worker mounts db_password_operator', (s) => { giveSecret(s.staging, false, 'worker', 'db_password_operator'); }, 'secret-matrix', 'staging worker may hold the operator password'],
  ['staging web mounts db_password_operator', (s) => { giveSecret(s.staging, false, 'web', 'db_password_operator'); }, 'secret-matrix', 'staging web may hold the operator password'],
  ['prod operator restarts unless-stopped', (s) => { svc(s, 'prod', 'operator').restart = 'unless-stopped'; }, 'operator-one-shot', 'the operator may be long-running'],
  ['staging operator restarts unless-stopped', (s) => { svc(s, 'staging', 'operator').restart = 'unless-stopped'; }, 'operator-one-shot', 'staging operator may be long-running'],
  ['prod operator without its profile', (s) => { delete svc(s, 'prod', 'operator').profiles; }, 'operator-one-shot', 'the operator starts with the stack'],
  ['staging operator without its profile', (s) => { delete svc(s, 'staging', 'operator').profiles; }, 'operator-one-shot', 'the staging operator starts with the stack'],
  ['prod operator in a second profile', (s) => { svc(s, 'prod', 'operator').profiles = ['operator', 'extra']; }, 'operator-one-shot', 'profiles not exactly [operator]'],
  ['prod operator without logging driver none', (s) => { delete svc(s, 'prod', 'operator').logging; }, 'operator-one-shot', 'the invitation link on stdout reaches the log driver (A1.1)'],
  ['staging operator with the json-file log driver', (s) => { svc(s, 'staging', 'operator').logging = { driver: 'json-file' }; }, 'operator-one-shot', 'only the absence of logging is checked, not the driver'],
  // R1
  ['Caddy site block without the headers snippet', (s) => { s.text['infra/caddy/Caddyfile'] = s.text['infra/caddy/Caddyfile']!.replace('\timport security_headers\n\tbasic_auth', '\tbasic_auth'); }, 'caddy-headers', 'per-site snippet import not checked'],
  ['Caddy snippet lacks nosniff', (s) => { s.text['infra/caddy/Caddyfile'] = s.text['infra/caddy/Caddyfile']!.replace('\t\tX-Content-Type-Options "nosniff"\n', ''); }, 'caddy-headers', 'snippet contents not checked'],
  ['Caddy snippet adds includeSubDomains', (s) => { s.text['infra/caddy/Caddyfile'] = s.text['infra/caddy/Caddyfile']!.replace('max-age=31536000"', 'max-age=31536000; includeSubDomains"'); }, 'caddy-headers', 'HSTS value not exact (ruling: no includeSubDomains/preload)'],
  ['Caddy snippet without defer', (s) => { s.text['infra/caddy/Caddyfile'] = s.text['infra/caddy/Caddyfile']!.replace('\t\tdefer\n', ''); }, 'caddy-headers', 'upstream could override the headers'],
  ['Caddy sets a CSP', (s) => { s.text['infra/caddy/Caddyfile'] = s.text['infra/caddy/Caddyfile']!.replace('\t\tdefer\n', '\t\tdefer\n\t\tContent-Security-Policy "default-src *"\n'); }, 'caddy-csp', 'Caddy allowed to set or strip the CSP (it is Kit\'s)'],
];

describe.concurrent('compose-policy lint: fail fixtures (pass baseline + one mutation each)', () => {
  it.each(ROWS)('%s -> rule fires', async (name, mut, id) => {
    const r = await runSet(mut);
    expect(r.code, `${name}: ${r.err}`).not.toBe(0);
    expect(r.err).toMatch(rule(id));
  });
  // The "turns red when" column, kept machine-readable so the table above is the single source.
  it('every row documents the mutation that turns it red', async () => {
    for (const row of ROWS) expect(row[3].length).toBeGreaterThan(8);
  });
});

// POLY-146 AC6, AC7 (ruling R3): the repo's own files, read statically (the rendered-file lint runs on them in the pass test above).
describe('POLY-146: the repo\'s compose and pg_hba files', () => {
  const doc = (f: string) => parse(readFileSync(join(ROOT, 'infra/compose', f), 'utf8'), { merge: true });
  const secretNames = (service: any): string[] => (service.secrets ?? []).map((x: any) => (typeof x === 'string' ? x : x.target ?? x.source));
  for (const f of ['prod.yml', 'staging.yml']) {
    it(`${f}: an operator service exists, one-shot, under its own profile, holding db_password_operator and nothing else  [red if: no operator service, long-running, or other secrets]`, () => {
      const op = doc(f).services.operator;
      expect(op, 'operator service').toBeDefined();
      expect(String(op.restart)).toBe('no');
      expect(op.profiles).toEqual(['operator']);
      expect(op.logging?.driver, 'A1.1: the link on stdout must not reach a log driver').toBe('none');
      expect(secretNames(op)).toEqual(['db_password_operator']);
    });
    it(`${f}: no service but operator mounts db_password_operator; web, worker and migrate hold no operator secret  [red if: a long-running service has the operator password (seceng #2)]`, () => {
      const services = doc(f).services as Record<string, any>;
      for (const [n, sv] of Object.entries(services)) if (n !== 'operator') expect(secretNames(sv), n).not.toContain('db_password_operator');
      for (const n of ['web', 'worker']) {
        expect(JSON.stringify(services[n]), `${n} names no operator secret`).not.toMatch(/operator/i);
      }
    });
    it(`${f}: the worker mounts no auth secret and sets no AUTH_SECRET_FILE; web still does  [red if: the worker keeps the secret]`, () => {
      const services = doc(f).services as Record<string, any>;
      expect(secretNames(services.worker)).not.toContain('auth_secret');
      expect(JSON.stringify(services.worker.environment ?? {})).not.toContain('AUTH_SECRET_FILE');
      expect(secretNames(services.web)).toContain('auth_secret');
    });
  }
  for (const [f, cidr] of [['pg_hba.prod.conf', '10.201.1.0/24'], ['pg_hba.staging.conf', '10.202.1.0/24']] as const) {
    it(`${f}: poly_operator is admitted from ${cidr} with scram-sha-256, before the final reject  [red if: the line is missing, not scram, or after the reject]`, () => {
      const rows = readFileSync(join(ROOT, 'infra/postgres', f), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((r) => r[0] === 'host');
      const at = rows.findIndex((r) => r[2] === 'poly_operator');
      expect(at, 'poly_operator line').toBeGreaterThanOrEqual(0);
      expect(rows[at]).toEqual(['host', 'polycarpic', 'poly_operator', cidr, 'scram-sha-256']);
      const finalReject = rows.findIndex((r) => r[1] === 'all' && r[2] === 'all' && r[4] === 'reject');
      expect(at).toBeLessThan(finalReject);
    });
  }
});

describe.concurrent('compose-policy lint: fail closed', () => {
  it('no compose files under infra/compose -> non-zero [no-files]', async () => {
    const r = await runSet(() => {}, { skipCompose: ['edge', 'prod', 'staging'] });
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(rule('no-files')); // red if zero files renders as a pass
  });
  it('one of the three files missing -> non-zero', async () => {
    expect((await runSet(() => {}, { skipCompose: ['staging'] })).code).not.toBe(0); // red if only existing files are checked
  });
  it('a file docker compose cannot render -> non-zero [render-error], never skipped', async () => {
    const r = await runSet((s) => { svc(s, 'prod', 'web').networks = ['nonexistent']; });
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(rule('render-error')); // red if render errors are swallowed
  });
  it('POLY_POSTGRES_IMAGE unset -> non-zero (the :? guard fires, the lint does not default it)', async () => {
    const s = baseline();
    const root = mkdtempSync(join(tmpdir(), 'poly95-lint-'));
    made.push(root);
    materialise(root, s);
    if (!existsSync(LINT)) throw new Error('infra/lint/compose-policy.mjs does not exist');
    const r = await spawnAsync('node', [LINT, '--root', root], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(r.status).not.toBe(0);
  });
  it('docker compose not on PATH -> non-zero [no-docker]', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poly95-lint-'));
    made.push(root);
    materialise(root, baseline());
    if (!existsSync(LINT)) throw new Error('infra/lint/compose-policy.mjs does not exist');
    const r = await spawnAsync(process.execPath, [LINT, '--root', root], { encoding: 'utf8', env: { PATH: '/nonexistent', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(rule('no-docker')); // red: a missing docker is a pass
  });
  it('a project that renders zero services -> non-zero', async () => {
    expect((await runSet((s) => { s.staging.services = {}; })).code).not.toBe(0); // red: empty render treated as clean
  });
  it('policy.json missing or invalid -> non-zero [policy]', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poly95-lint-'));
    made.push(root);
    materialise(root, baseline());
    writeFileSync(join(root, 'bad.json'), '{');
    if (!existsSync(LINT)) throw new Error('infra/lint/compose-policy.mjs does not exist');
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' };
    for (const pol of ['bad.json', 'missing.json']) {
      const r = await spawnAsync('node', [LINT, '--root', root, '--policy', join(root, pol)], { encoding: 'utf8', env });
      expect(r.status, pol).not.toBe(0);
      expect(r.stderr).toMatch(rule('policy'));
    }
  });
  it('a missing --root argument -> non-zero', async () => {
    if (!existsSync(LINT)) throw new Error('infra/lint/compose-policy.mjs does not exist');
    expect((await spawnAsync('node', [LINT], { encoding: 'utf8' })).status).not.toBe(0);
  });
});

// keep helpers referenced for the type checker
void mkdirSync;
