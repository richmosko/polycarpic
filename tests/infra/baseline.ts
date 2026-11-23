// POLY-95 R7: the pass fixture, built in code so every fail fixture is "the pass fixture plus ONE mutation".
// The shape follows INFRA §2.2 and the gate-1 ruling (process/cairn/reviews/POLY-95/ruling.md @ 9e59e9b + A1 703fa9b).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

const REPO = join(dirname(new URL(import.meta.url).pathname), '..', '..');
export const PG_DIGEST = 'sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317';
export const PG_IMAGE_ENV = `ghcr.io/richmosko/polycarpic-postgres:17.10@sha256:${'d'.repeat(64)}`;
const APP = `ghcr.io/richmosko/polycarpic@sha256:${'a'.repeat(64)}`;
const TOOLS = `ghcr.io/richmosko/polycarpic-tools@sha256:${'b'.repeat(64)}`;
const CADDY = `ghcr.io/richmosko/polycarpic-caddy@sha256:${'c'.repeat(64)}`;

type Y = Record<string, any>;
export type FxSet = {
  edge: Y; prod: Y; staging: Y;
  /** raw text files keyed by path relative to the fixture root */
  text: Record<string, string>;
};

const hard = (uid: number, extra: Y = {}): Y => ({
  user: `${uid}:${uid}`, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
  restart: 'unless-stopped', healthcheck: { test: ['CMD', 'true'], interval: '30s' }, tmpfs: ['/tmp'], ulimits: { core: 0 }, ...extra, // POLY-99 C2: core 0 in x-hardened
});
/** Per-service secret directories (ruling A1): /etc/polycarpic/{secrets,staging-secrets}/<service>/<name>.
 *  One top-level secret per (service, name): key `<name>__<service>`, mounted at target `<name>`. */
export const secretFile = (prod: boolean, service: string, name: string) =>
  `/etc/polycarpic/${prod ? 'secrets' : 'staging-secrets'}/${service}/${name}`;
export function giveSecret(proj: Y, prod: boolean, service: string, name: string) {
  const key = `${name}__${service}`;
  proj.secrets ??= {};
  proj.secrets[key] = { file: secretFile(prod, service, name) };
  const s = proj.services[service];
  (s.secrets ??= []).push({ source: key, target: name });
}

const MATRIX_PROD: Record<string, string[]> = {
  postgres: ['db_superuser_password'],
  web: ['db_password_app', 'plaid_secret'], // POLY-152 R1.3: the auth secret and the mailer key moved to auth
  auth: ['db_password_auth', 'auth_secret', 'resend_api_key'],
  worker: ['db_password_worker', 'credential_keyring', 'resend_api_key'],
  migrate: ['db_password_migrator'],
  operator: ['db_password_operator'],
  backup: ['db_password_backup'],
  uploader: ['backup_store_credential'], // POLY-99 H-1: heartbeat_url is host-only (secrets/host/), root pings; no service mounts it
};

function project(kind: 'prod' | 'staging'): Y {
  const prod = kind === 'prod';
  const subnet = prod ? '10.201.1.0/24' : '10.202.1.0/24';
  const pgConf = prod ? 'postgresql.prod.conf' : 'postgresql.staging.conf';
  const hba = prod ? 'pg_hba.prod.conf' : 'pg_hba.staging.conf';
  const E = `edge-${kind}`;
  const services: Y = {
    postgres: hard(999, {
      image: '${POLY_POSTGRES_IMAGE:?}',
      command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'],
      environment: { POSTGRES_PASSWORD_FILE: '/run/secrets/db_superuser_password' },
      networks: prod ? ['default', 'backup-net'] : ['default'],
      tmpfs: ['/tmp', '/var/run/postgresql'],
      volumes: [
        `/srv/polycarpic/pg-${kind}:/var/lib/postgresql/data`,
        `../postgres/${pgConf}:/etc/postgresql/postgresql.conf:ro`,
        `../postgres/${hba}:/etc/postgresql/pg_hba.conf:ro`,
        '../postgres/archive-wal.sh:/usr/local/bin/archive-wal.sh:ro',
        ...(prod ? ['/etc/polycarpic/age-recipients.txt:/etc/postgresql/age-recipients.txt:ro', '/srv/polycarpic/spool/wal:/spool/wal'] : []),
      ],
    }),
    web: hard(10001, { image: APP, networks: { default: {}, [E]: { aliases: [`${kind}-web`] } } }),
    auth: hard(prod ? 10007 : 10107, { image: APP, command: ['auth'], networks: { default: {}, [E]: { aliases: [`${kind}-auth`] } } }),
    worker: hard(10002, { image: APP, networks: ['default'] }),
    migrate: hard(10003, { image: APP, networks: ['default'] }),
    // POLY-146 R3: the one-shot operator service. Its own profile, restart "no", the one secret; no long-running service holds it.
    operator: hard(prod ? 10006 : 10106, { image: APP, networks: ['default'], restart: 'no', profiles: ['operator'], logging: { driver: 'none' }, entrypoint: ['/app/bin/polycarpic', 'cli'], mem_limit: '256m' }),
  };
  if (prod) {
    // POLY-99 R10: backup.sh mounted read-only, /tmp a 1 MiB tmpfs (the passfile only); the uploader reads the whole spool read-only and
    // holds the script, ops.conf and host.env read-only, with a 1 MiB /tmp for the rclone config.
    services.backup = hard(10004, {
      image: '${POLY_POSTGRES_IMAGE:?}', networks: ['backup-net'], tmpfs: ['/tmp:size=1m'],
      volumes: ['/srv/polycarpic/spool/dump:/spool/dump', '/srv/polycarpic/spool/premigration:/spool/premigration', '/etc/polycarpic/age-recipients.txt:/etc/backup/age-recipients.txt:ro', '../backup/backup.sh:/usr/local/bin/backup.sh:ro'],
    });
    services.uploader = hard(10005, {
      image: TOOLS, networks: ['upload-net'], tmpfs: ['/tmp:size=1m'],
      volumes: ['/srv/polycarpic/spool:/spool:ro', '../backup/upload.sh:/usr/local/bin/upload.sh:ro', '/etc/polycarpic/ops.conf:/etc/uploader/ops.conf:ro', '/etc/polycarpic/host.env:/etc/uploader/host.env:ro'],
    });
  }
  const proj: Y = {
    name: `polycarpic-${kind}`,
    services,
    networks: {
      default: { name: `polycarpic-${kind}_default`, ipam: { config: [{ subnet }] } },
      [E]: { name: `polycarpic-${E}`, external: true },
      ...(prod ? {
        'backup-net': { internal: true, ipam: { config: [{ subnet: '10.201.10.0/29' }] } },
        'upload-net': {},
      } : {}),
    },
    secrets: {},
  };
  for (const [svc, names] of Object.entries(MATRIX_PROD)) {
    if (!services[svc]) continue;
    for (const n of names) giveSecret(proj, prod, svc, n);
  }
  for (const [svc, list] of Object.entries(ENV_FILES[kind])) if (services[svc]) services[svc].env_file = [...list]; // S27: the exact lists
  return proj;
}

/** S27 (ruling-review.md @ d6cb5d6b), held literally: the env_file list of each service, in order. Every other service has none. */
export const ENV_FILES = {
  prod: { auth: ['/etc/polycarpic/host.env', '/etc/polycarpic/mail.env'], worker: ['/etc/polycarpic/host.env', '/etc/polycarpic/mail.env'],
          web: ['/etc/polycarpic/host.env'], migrate: ['/etc/polycarpic/host.env'], operator: ['/etc/polycarpic/host.env'] },
  staging: { auth: ['/etc/polycarpic/staging-host.env', '/etc/polycarpic/staging-mail.env'], worker: ['/etc/polycarpic/staging-host.env', '/etc/polycarpic/staging-mail.env'],
             web: ['/etc/polycarpic/staging-host.env'], migrate: ['/etc/polycarpic/staging-host.env'], operator: ['/etc/polycarpic/staging-host.env'] },
} as const;

const HBA_PROD = `host  replication  poly_backup    10.201.10.0/29  scram-sha-256
host  polycarpic   poly_backup    10.201.10.0/29  scram-sha-256
host  all          poly_backup    all             reject
host  replication  all            all             reject
host  polycarpic   poly_app       10.201.1.0/24   scram-sha-256
host  polycarpic   poly_auth      10.201.1.0/24   scram-sha-256
host  polycarpic   poly_worker    10.201.1.0/24   scram-sha-256
host  polycarpic   poly_migrator  10.201.1.0/24   scram-sha-256
host  polycarpic   poly_operator  10.201.1.0/24   scram-sha-256
host  all          all            all             reject
local all          postgres                       peer
`;
const HBA_STAGING = `host  all          poly_backup    all             reject
host  replication  all            all             reject
host  polycarpic   poly_app       10.202.1.0/24   scram-sha-256
host  polycarpic   poly_auth      10.202.1.0/24   scram-sha-256
host  polycarpic   poly_worker    10.202.1.0/24   scram-sha-256
host  polycarpic   poly_migrator  10.202.1.0/24   scram-sha-256
host  polycarpic   poly_operator  10.202.1.0/24   scram-sha-256
host  all          all            all             reject
local all          postgres                       peer
`;
export const CADDYFILE = `{
\tadmin off
\thttp_port 8080
\thttps_port 8443
\tlog {
\t\toutput stderr
\t\tformat filter {
\t\t\trequest>uri regexp "^(/api/auth/[^/?#]*)[^?#]*|[?#].*" "\${1}"
\t\t\trequest>headers>Referer delete
\t\t}
\t}
}

(security_headers) {
\theader {
\t\tdefer
\t\tStrict-Transport-Security "max-age=31536000"
\t\tX-Content-Type-Options "nosniff"
\t\tX-Frame-Options "DENY"
\t\tReferrer-Policy "strict-origin-when-cross-origin"
\t}
}

(no_store) {
\t@mutable not path /_app/immutable/*
\theader @mutable {
\t\tdefer
\t\tCache-Control "no-store"
\t}
}

(upstream) {
\theader_up X-Forwarded-For {remote_host}
\theader_up -X-Real-IP
\theader_up -Forwarded
\tlb_try_duration 10s
}

http://app.{$POLY_DOMAIN}, http://staging.{$POLY_DOMAIN} {
\timport security_headers
\tredir https://{host}{uri} permanent
}

app.{$POLY_DOMAIN} {
\ttls {$POLY_TLS}
\timport security_headers
\timport no_store
\thandle_errors {
\t\timport security_headers
\t}
\troute {
\t\t@sw header Service-Worker *
\t\trespond @sw 403
\t\t@auth path /api/auth /api/auth/*
\t\treverse_proxy @auth prod-auth:3000 {
\t\t\timport upstream
\t\t}
\t\treverse_proxy prod-web:3000 {
\t\t\timport upstream
\t\t}
\t}
}

staging.{$POLY_DOMAIN} {
\ttls {$POLY_TLS}
\timport security_headers
\timport no_store
\thandle_errors {
\t\timport security_headers
\t}
\troute {
\t\t@denied not remote_ip {$POLY_STAGING_ALLOW}
\t\trespond @denied 403
\t\t@sw header Service-Worker *
\t\trespond @sw 403
\t\tbasic_auth {
\t\t\timport /run/secrets/staging_basic_auth
\t\t}
\t\t@auth path /api/auth /api/auth/*
\t\treverse_proxy @auth staging-auth:3000 {
\t\t\timport upstream
\t\t}
\t\treverse_proxy staging-web:3000 {
\t\t\timport upstream
\t\t}
\t}
}
`;

export function baseline(): FxSet {
  return {
    edge: {
      name: 'polycarpic-edge',
      services: {
        caddy: hard(10010, {
          image: CADDY, ports: ['${POLY_BIND_ADDR:?}:80:8080', '${POLY_BIND_ADDR:?}:443:8443'], networks: ['edge-prod', 'edge-staging'],
          volumes: ['/srv/polycarpic/caddy:/data', '../caddy/Caddyfile:/etc/caddy/Caddyfile:ro'],
          secrets: [{ source: 'staging_basic_auth__caddy', target: 'staging_basic_auth' }],
        }),
      },
      networks: {
        'edge-prod': { name: 'polycarpic-edge-prod', ipam: { config: [{ subnet: '10.201.30.0/28' }] } },
        'edge-staging': { name: 'polycarpic-edge-staging', ipam: { config: [{ subnet: '10.202.30.0/28' }] } },
      },
      secrets: { staging_basic_auth__caddy: { file: secretFile(true, 'caddy', 'staging_basic_auth') } },
    },
    prod: project('prod'),
    staging: project('staging'),
    text: {
      'infra/postgres-major': '17\n',
      'infra/postgres/Dockerfile': `FROM postgres:17.10@${PG_DIGEST}\nRUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age=1.2.1-1+b5 && rm -rf /var/lib/apt/lists/*\n`,
      'infra/postgres/pg_hba.prod.conf': HBA_PROD,
      'infra/postgres/pg_hba.staging.conf': HBA_STAGING,
      'infra/postgres/postgresql.prod.conf': 'archive_mode = on\nallow_alter_system = off\n',
      'infra/postgres/postgresql.staging.conf': 'archive_mode = off\nallow_alter_system = off\n',
      'infra/caddy/Caddyfile': readFileSync(join(REPO, 'infra', 'caddy', 'Caddyfile'), 'utf8'), // POLY-100 A12: the lint holds the real Caddyfile as an allowlist, so the baseline is the real one
      'infra/deploy/compose-allow.json': readFileSync(join(REPO, 'infra', 'deploy', 'compose-allow.json'), 'utf8'), // the lint and the box guard read the env_file lists from it (S27)
      'tests/db/docker/Dockerfile': 'ARG PG_BASE\nFROM ${PG_BASE}\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-17-pgtap && rm -rf /var/lib/apt/lists/*\n',
      '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  db:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
    },
  };
}

/** Write a set under `root`. `skipCompose` names compose files to leave out (the "no files found" fixture). */
export function materialise(root: string, s: FxSet, opts: { skipCompose?: string[] } = {}) {
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  for (const k of ['edge', 'prod', 'staging'] as const) if (!opts.skipCompose?.includes(k)) put(`infra/compose/${k}.yml`, stringify(s[k]));
  for (const [rel, body] of Object.entries(s.text)) put(rel, body);
}
