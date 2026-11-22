// POLY-97 shared helpers for the two files that run a real Postgres next to the dry-run box: the database-stage test (image job,
// the infra/postgres derivative) and the D-check test (provision job, the pinned base image). The box reaches Postgres over a private
// Docker network through the fake `docker compose exec -T postgres psql` (fakes/_fake), so psql, SET and ALTER ROLE are real.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET, CAPS, COMPLETE, HOST, ROOT, b2Fixture, run, sh } from './box.ts';

export const conf = join(ROOT, 'infra', 'postgres', 'postgresql.prod.conf');
export const hba = join(ROOT, 'tests', 'infra', 'provision', 'pg_hba.test.conf');
/** The base image the derivative is built FROM (read from the Dockerfile so the two never drift). */
export const BASE_IMAGE = /^FROM (\S+)/m.exec(readFileSync(join(ROOT, 'infra', 'postgres', 'Dockerfile'), 'utf8'))![1]!;

export type Names = { good: string; bad: string; fail: string; stg: string };
export const namesFor = (tag: string): Names => ({ good: `poly97-${tag}A-${process.pid}`, bad: `poly97-${tag}B-${process.pid}`, fail: `poly97-${tag}C-${process.pid}`, stg: `poly97-${tag}D-${process.pid}` });

export function startPg(name: string, net: string, image: string, superPw: string, extra: string[] = []) {
  const r = sh('docker', ['run', '-d', '--name', name, '--network', net, '--user', '999:999',
    '-e', `POSTGRES_PASSWORD=${superPw}`, '-e', 'POSTGRES_DB=polycarpic',
    '--tmpfs', '/var/lib/postgresql/data:uid=999,gid=999,mode=0700', '--tmpfs', '/var/run/postgresql:uid=999,gid=999,mode=0755',
    '-v', `${conf}:/etc/postgresql/postgresql.conf:ro`, '-v', `${hba}:/etc/postgresql/pg_hba.conf:ro`,
    image, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'archive_command=/bin/true', ...extra]);
  if (r.code !== 0) throw new Error(`pg start ${name}: ${r.err}`);
}
export function waitPg(name: string) {
  for (let i = 0; i < 90; i++) {
    const r = sh('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', 'select 1']);
    if (r.out.trim() === '1') return;
    sh('sleep', ['1']);
  }
  throw new Error(`pg ${name} did not come up: ${sh('docker', ['logs', name]).all.slice(-500)}`);
}

export const NETS_GOOD = [
  ['polycarpic-prod_default', '10.201.1.0/24'], ['polycarpic-staging_default', '10.202.1.0/24'], ['polycarpic-edge-prod', '10.201.30.0/28'],
  ['polycarpic-edge-staging', '10.202.30.0/28'], ['polycarpic-prod_backup-net', '10.201.10.0/29'], ['polycarpic-prod_upload-net', '10.201.20.0/29'],
];
export const nets = (list: string[][]) => `echo '${JSON.stringify(list.map(([Name, Subnet]) => ({ Name, IPAM: { Config: [{ Subnet }] } })))}' > /var/fake-state/networks.json`;
export const point = (prod: string | null, staging: string | null) => [
  prod ? `echo ${prod} > /var/fake-state/pg-prod-host; ln -sf /etc/polycarpic/secrets/postgres/db_superuser_password /var/fake-state/pg-prod-password` : '',
  staging ? `echo ${staging} > /var/fake-state/pg-staging-host; ln -sf /etc/polycarpic/secrets/postgres/db_superuser_password /var/fake-state/pg-staging-password` : '',
].filter(Boolean).join('\n');
export const OPS = 'mkdir -p /tmp/ops; cp /repo/infra/provision.sh /repo/infra/provision-check.sh /repo/packages/db/sql/roles.sql /tmp/ops/;';
export const CHECK_OPS = `bash /tmp/ops/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}`;
export const asSuper = (cmd: string) => `export PGPASSWORD=$(cat /etc/polycarpic/secrets/postgres/db_superuser_password); ${cmd}`;
export const STAGE = (host: string, project = 'prod') => `${OPS} ${point(host, null).replace(/pg-prod/g, `pg-${project}`).trim()}; bash /tmp/ops/provision.sh --stage database --project ${project}`;
export const LOGIN: Record<string, string> = { poly_app: 'web/db_password_app', poly_auth: 'auth/db_password_auth', poly_worker: 'worker/db_password_worker', poly_migrator: 'migrate/db_password_migrator', poly_operator: 'operator/db_password_operator', poly_backup: 'backup/db_password_backup' };
export const superPassword = () => run('cat /etc/polycarpic/secrets/postgres/db_superuser_password', { image: HOST }).out.trim();
export const secretValues = () => run('for f in /etc/polycarpic/secrets/*/*; do cat $f; echo; done', { image: HOST }).out.split('\n').filter(Boolean);
export const checkAll = (n: Names, net: string) => (plant = '', o: { prod?: string | null; staging?: string | null; args?: string } = {}) =>
  run(`${OPS}\n${b2Fixture({})}\n${nets(NETS_GOOD)}\n${point(o.prod === undefined ? n.good : o.prod, o.staging === undefined ? n.stg : o.staging)}\n${plant}\n${CHECK_OPS} ${o.args ?? ''}; echo "rc=$?"`, { image: COMPLETE, network: net });
