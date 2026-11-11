// POLY-95 R7: the pass fixture, built in code so every fail fixture is "the pass fixture plus ONE mutation".
// The shape follows INFRA §2.2 and the gate-1 ruling (process/cairn/reviews/POLY-95/ruling.md @ 2669725).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

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
  restart: 'unless-stopped', healthcheck: { test: ['CMD', 'true'], interval: '30s' }, tmpfs: ['/tmp'], ...extra,
});
const sec = (dir: string, names: string[]) => Object.fromEntries(names.map((n) => [n, { file: `${dir}/${n}` }]));

function project(kind: 'prod' | 'staging'): Y {
  const prod = kind === 'prod';
  const dir = prod ? '/etc/polycarpic/secrets' : '/etc/polycarpic/staging-secrets';
  const subnet = prod ? '10.201.1.0/24' : '10.202.1.0/24';
  const names = ['db_superuser_password', 'db_password_app', 'db_password_worker', 'db_password_migrator', 'auth_secret',
    'resend_api_key', 'plaid_secret', 'credential_keyring', ...(prod ? ['db_password_backup', 'backup_store_credential', 'heartbeat_url'] : [])];
  const pgConf = prod ? 'postgresql.prod.conf' : 'postgresql.staging.conf';
  const hba = prod ? 'pg_hba.prod.conf' : 'pg_hba.staging.conf';
  const services: Y = {
    postgres: hard(999, {
      image: '${POLY_POSTGRES_IMAGE:?}',
      command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'],
      environment: { POSTGRES_PASSWORD_FILE: '/run/secrets/db_superuser_password' },
      secrets: ['db_superuser_password'], networks: prod ? ['default', 'backup-net'] : ['default'],
      tmpfs: ['/tmp', '/var/run/postgresql'],
      volumes: [
        `/srv/polycarpic/pg-${kind}:/var/lib/postgresql/data`,
        `../postgres/${pgConf}:/etc/postgresql/postgresql.conf:ro`,
        `../postgres/${hba}:/etc/postgresql/pg_hba.conf:ro`,
        '../postgres/archive-wal.sh:/usr/local/bin/archive-wal.sh:ro',
        ...(prod ? ['/etc/polycarpic/age-recipients.txt:/etc/postgresql/age-recipients.txt:ro', '/srv/polycarpic/spool/wal:/spool/wal'] : []),
      ],
    }),
    web: hard(10001, { image: APP, secrets: ['db_password_app', 'auth_secret', 'resend_api_key', 'plaid_secret'], networks: ['default', 'edge'] }),
    worker: hard(10002, { image: APP, secrets: ['db_password_worker', 'auth_secret', 'credential_keyring', 'resend_api_key'], networks: ['default'] }),
    migrate: hard(10003, { image: APP, secrets: ['db_password_migrator'], networks: ['default'] }),
  };
  if (prod) {
    services.backup = hard(10004, { image: '${POLY_POSTGRES_IMAGE:?}', secrets: ['db_password_backup'], networks: ['backup-net'] });
    services.uploader = hard(10005, { image: TOOLS, secrets: ['backup_store_credential', 'heartbeat_url'], networks: ['upload-net'] });
  }
  return {
    name: `polycarpic-${kind}`,
    services,
    networks: {
      default: { name: `polycarpic-${kind}_default`, ipam: { config: [{ subnet }] } },
      edge: { name: `polycarpic-${kind}-edge` },
      ...(prod ? {
        'backup-net': { internal: true, ipam: { config: [{ subnet: '10.201.10.0/29' }] } },
        'upload-net': {},
      } : {}),
    },
    secrets: sec(dir, names),
  };
}

const HBA_PROD = `host  replication  poly_backup    10.201.10.0/29  scram-sha-256
host  polycarpic   poly_backup    10.201.10.0/29  scram-sha-256
host  all          poly_backup    all             reject
host  replication  all            all             reject
host  polycarpic   poly_app       10.201.1.0/24   scram-sha-256
host  polycarpic   poly_worker    10.201.1.0/24   scram-sha-256
host  polycarpic   poly_migrator  10.201.1.0/24   scram-sha-256
host  all          all            all             reject
local all          postgres                       peer
`;
const HBA_STAGING = `host  all          poly_backup    all             reject
host  replication  all            all             reject
host  polycarpic   poly_app       10.202.1.0/24   scram-sha-256
host  polycarpic   poly_worker    10.202.1.0/24   scram-sha-256
host  polycarpic   poly_migrator  10.202.1.0/24   scram-sha-256
host  all          all            all             reject
local all          postgres                       peer
`;
export const CADDYFILE = `(security_headers) {
\theader {
\t\tdefer
\t\tStrict-Transport-Security "max-age=31536000"
\t\tX-Content-Type-Options "nosniff"
\t\tReferrer-Policy "strict-origin-when-cross-origin"
\t}
}

app.{$POLY_DOMAIN} {
\timport security_headers
\treverse_proxy prod-web:3000
}

staging.{$POLY_DOMAIN} {
\timport security_headers
\tbasic_auth {
\t\t{file./run/secrets/staging_basic_auth}
\t}
\t@denied not remote_ip {$POLY_STAGING_ALLOW}
\trespond @denied 403
\treverse_proxy staging-web:3000
}
`;

export function baseline(): FxSet {
  return {
    edge: {
      name: 'polycarpic-edge',
      services: {
        caddy: hard(10010, {
          image: CADDY, ports: ['80:80', '443:443'], networks: ['prod-edge', 'staging-edge'], secrets: ['staging_basic_auth'],
          volumes: ['/srv/polycarpic/caddy:/data', '../caddy/Caddyfile:/etc/caddy/Caddyfile:ro'],
        }),
      },
      networks: {
        'prod-edge': { name: 'polycarpic-prod-edge', external: true },
        'staging-edge': { name: 'polycarpic-staging-edge', external: true },
      },
      secrets: { staging_basic_auth: { file: '/etc/polycarpic/secrets/staging_basic_auth' } },
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
      'infra/caddy/Caddyfile': CADDYFILE,
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
