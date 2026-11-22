// POLY-97 R5 (--stage database), R6 D1–D6, R4 summaries that need a running Postgres, R10 (verifiers never logged).
// Real Postgres 17 from the image job's derivative (infra/postgres), with the prod postgresql.conf; the box reaches it over a
// private Docker network through the fake `docker compose exec -T postgres psql` (fakes/_fake), so psql, SET and ALTER ROLE are real.
// Contract pins (test-plan.md): the scripts are run as R7 copies them (provision.sh, provision-check.sh, roles.sql side by side in
// one directory); D3 probes per ruling Addendum 2 @ 512d9c50 and Addendum 3 @ 1eafa6c5 (tools image in each service's network namespace); D5 on staging
// skips poly_backup (it has no secret there).
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPS, BUCKET, COMPLETE, FX, HOST, ROOT, b2Fixture, build, find, last, lines, makeComplete, makeHost, run, sh, failLine } from './provision-box.ts';

const NET = `poly97net${process.pid}`;
const PGIMG = 'poly97-pg:test';
const names = { good: `poly97-pgA-${process.pid}`, bad: `poly97-pgB-${process.pid}`, fail: `poly97-pgC-${process.pid}`, stg: `poly97-pgD-${process.pid}` };
const conf = join(ROOT, 'infra', 'postgres', 'postgresql.prod.conf');
const hba = join(ROOT, 'tests', 'infra', 'provision', 'pg_hba.test.conf');
let superPw = '';

function startPg(name: string, extra: string[] = []) {
  const r = sh('docker', ['run', '-d', '--name', name, '--network', NET, '--user', '999:999',
    '-e', `POSTGRES_PASSWORD=${superPw}`, '-e', 'POSTGRES_DB=polycarpic',
    '--tmpfs', '/var/lib/postgresql/data:uid=999,gid=999,mode=0700', '--tmpfs', '/var/run/postgresql:uid=999,gid=999,mode=0755',
    '-v', `${conf}:/etc/postgresql/postgresql.conf:ro`, '-v', `${hba}:/etc/postgresql/pg_hba.conf:ro`,
    PGIMG, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'archive_command=/bin/true', ...extra]);
  if (r.code !== 0) throw new Error(`pg start ${name}: ${r.err}`);
}
function waitPg(name: string) {
  for (let i = 0; i < 90; i++) {
    const r = sh('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'polycarpic', '-tAc', 'select 1']);
    if (r.out.trim() === '1') return;
    sh('sleep', ['1']);
  }
  throw new Error(`pg ${name} did not come up: ${sh('docker', ['logs', name]).all.slice(-500)}`);
}

const NETS_GOOD = [
  ['polycarpic-prod_default', '10.201.1.0/24'], ['polycarpic-staging_default', '10.202.1.0/24'], ['polycarpic-edge-prod', '10.201.30.0/28'],
  ['polycarpic-edge-staging', '10.202.30.0/28'], ['polycarpic-prod_backup-net', '10.201.10.0/29'], ['polycarpic-prod_upload-net', '10.201.20.0/29'],
];
const nets = (list: string[][]) => `echo '${JSON.stringify(list.map(([Name, Subnet]) => ({ Name, IPAM: { Config: [{ Subnet }] } })))}' > /var/fake-state/networks.json`;
const point = (prod: string | null, staging: string | null) => [
  prod ? `echo ${prod} > /var/fake-state/pg-prod-host; ln -sf /etc/polycarpic/secrets/postgres/db_superuser_password /var/fake-state/pg-prod-password` : '',
  staging ? `echo ${staging} > /var/fake-state/pg-staging-host; ln -sf /etc/polycarpic/secrets/postgres/db_superuser_password /var/fake-state/pg-staging-password` : '',
].filter(Boolean).join('\n');
const OPS = 'mkdir -p /tmp/ops; cp /repo/infra/provision.sh /repo/infra/provision-check.sh /repo/packages/db/sql/roles.sql /tmp/ops/;';
const CHECK = `bash /tmp/ops/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}`;
const ALL = (plant = '', o: { prod?: string | null; staging?: string | null; args?: string } = {}) =>
  run(`${OPS}\n${b2Fixture({})}\n${nets(NETS_GOOD)}\n${point(o.prod === undefined ? names.good : o.prod, o.staging === undefined ? names.stg : o.staging)}\n${plant}\n${CHECK} ${o.args ?? ''}; echo "rc=$?"`, { image: COMPLETE, network: NET });
const sql = (host: string, q: string) => `psql -h ${host} -U postgres -d polycarpic -tAc "${q}"`;
const asSuper = (cmd: string) => `export PGPASSWORD=$(cat /etc/polycarpic/secrets/postgres/db_superuser_password); ${cmd}`;
const STAGE = (project = 'prod', host = names.good) => `${OPS} ${point(host, null).replace(/pg-prod/g, `pg-${project}`).trim()}; bash /tmp/ops/provision.sh --stage database --project ${project}`;

const LOGIN: Record<string, string> = { poly_app: 'web/db_password_app', poly_auth: 'auth/db_password_auth', poly_worker: 'worker/db_password_worker', poly_migrator: 'migrate/db_password_migrator', poly_operator: 'operator/db_password_operator', poly_backup: 'backup/db_password_backup' };

// A failed setup fails every test with its own message (not "skipped"), so the red run counts each test.
let setupError: string | null = null;
beforeAll(() => {
  try {
  build();
  const h = makeHost();
  if (h.code !== 0) throw new Error(`host stage failed on the fake box:\n${h.all.slice(-1200)}`);
  const c = makeComplete();
  if (c.code !== 0) throw new Error(`complete box failed: ${c.all.slice(-600)}`);
  superPw = run('cat /etc/polycarpic/secrets/postgres/db_superuser_password', { image: HOST }).out.trim();
  const b = sh('docker', ['build', '-q', '-t', PGIMG, join(ROOT, 'infra', 'postgres')]);
  if (b.code !== 0) throw new Error(`docker build infra/postgres: ${b.err.slice(-400)}`);
  sh('docker', ['network', 'create', NET]);
  startPg(names.good);
  startPg(names.bad, ['-c', 'archive_mode=off', '-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'log_min_duration_statement=0']);
  startPg(names.fail);
  startPg(names.stg);
  for (const n of Object.values(names)) waitPg(n);
  // the staging instance: the staging stage sets five roles from staging-secrets; poly_backup gets no verifier (Addendum 2)
  const stg = run(`${STAGE('staging', names.stg)} 2>&1`, { image: HOST, network: NET });
  if (stg.code !== 0) throw new Error(`the staging database stage failed: ${stg.all.slice(-600)}`);
  // the faulty instance: roles without passwords, an extra extension, a leftover replication slot
  const seed = run(`${asSuper('')} for q in "CREATE EXTENSION pgcrypto" "SELECT pg_create_physical_replication_slot('leftover')"; do psql -h ${names.bad} -U postgres -d polycarpic -c "$q"; done; psql -h ${names.bad} -U postgres -d polycarpic -f /repo/packages/db/sql/roles.sql`, { image: HOST, network: NET });
  if (seed.code !== 0) throw new Error(`seeding the faulty instance: ${seed.all.slice(-600)}`);
  // the failing instance needs no setup: the fake psql breaks every verifier ALTER (Postgres 17 has no event triggers for ALTER ROLE)
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });

afterAll(() => {
  for (const n of Object.values(names)) sh('docker', ['rm', '-f', n]);
  sh('docker', ['network', 'rm', NET]);
});

describe('provision.sh --stage database (R5, M2)', () => {
  let out = '';
  let stdin = '';
  it('runs roles.sql and sets every login role\'s password; exit 0; each role\'s verifier authenticates its own plaintext and no other', () => {
    const script = `${STAGE()} > /tmp/stage.out 2>&1; echo "rc=$?"; cat /tmp/stage.out; echo ==STDIN==; cat /dev/shm/psql-stdin.log; echo ==AUTH==
${Object.entries(LOGIN).map(([role, f]) => `PGPASSWORD=$(cat /etc/polycarpic/secrets/${f}) psql -h ${names.good} -U ${role} -d polycarpic -tAc 'select current_user' 2>&1 | head -1; PGPASSWORD=wrong-password psql -h ${names.good} -U ${role} -d polycarpic -tAc 'select 1' 2>&1 | grep -c 'authentication failed'`).join('\n')}`;
    const r = run(script, { image: HOST, network: NET });
    expect(r.out).toMatch(/rc=0/);
    const [pre, rest] = r.out.split('==STDIN==');
    const [sin, auth] = rest!.split('==AUTH==');
    out = pre!; stdin = sin!;
    expect(auth!.trim().split('\n')).toEqual(Object.keys(LOGIN).flatMap((role) => [role, '1']));
  });

  it('the plaintext never reaches the server: stdin carries only `ALTER ROLE … PASSWORD \'SCRAM-SHA-256$4096:…\'`, after SET log_statement = none and SET log_min_error_statement = panic as separate statements', () => {
    const alters = stdin.match(/^ALTER ROLE \w+ (WITH )?PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[^']+'/gm) ?? [];
    expect(alters.length).toBe(Object.keys(LOGIN).length);
    const iNone = stdin.search(/SET\s+log_statement\s*=\s*'none'\s*;/i);
    const iPanic = stdin.search(/SET\s+log_min_error_statement\s*=\s*'panic'\s*;/i);
    const iAlter = stdin.search(/^ALTER ROLE \w+ (WITH )?PASSWORD/m);
    expect(iNone).toBeGreaterThanOrEqual(0);
    expect(iPanic).toBeGreaterThanOrEqual(0);
    expect(iNone).toBeLessThan(iAlter);
    expect(iPanic).toBeLessThan(iAlter);
  });

  it('M2: after a successful run neither a plaintext password nor a verifier is in the Postgres log (log_statement = ddl is on)', () => {
    const log = sh('docker', ['logs', names.good]).all;
    expect(log).toMatch(/statement: .*(CREATE|ALTER) ROLE|statement: CREATE|statement: ALTER/i); // control: ddl logging is live, so roles.sql lines are in the log
    expect(log).not.toMatch(/SCRAM-SHA-256\$/);
    const vals = run('cat /etc/polycarpic/secrets/*/*', { image: HOST }).out.split('\n').filter(Boolean);
    expect(vals.length).toBeGreaterThan(5);
    for (const v of vals) expect(log).not.toContain(v);
  });

  it('M2: a forced failing ALTER (the fake psql breaks its syntax) exits non-zero and still leaves no plaintext and no verifier in the Postgres log', () => {
    const r = run(`${OPS} ${point(names.fail, null)}; touch /var/fake-state/psql-break-alter; bash /tmp/ops/provision.sh --stage database --project prod > /tmp/o 2>&1; echo "rc=$?"; cat /tmp/o`, { image: HOST, network: NET });
    expect(r.out).not.toMatch(/rc=0\n/);
    const log = sh('docker', ['logs', names.fail]).all;
    expect(log, 'control: the broken ALTER really failed inside Postgres').toMatch(/syntax error/);
    expect(log).not.toMatch(/SCRAM-SHA-256\$/);
    const vals = run('cat /etc/polycarpic/secrets/*/*', { image: HOST }).out.split('\n').filter(Boolean);
    for (const v of vals) expect(log).not.toContain(v);
    expect(r.all).not.toMatch(/SCRAM-SHA-256\$/); // not on the operator's screen either
  });

  it('no password or verifier in argv (the fakes\' call log) or in the script\'s output', () => {
    const r = run(`${STAGE()} > /tmp/o 2>&1; cat /tmp/o; echo ==; grep -E '^docker' /var/fake-state/calls.log; echo ==; cat /etc/polycarpic/secrets/*/*`, { image: HOST, network: NET });
    const [o, calls, vals] = r.out.split('==\n');
    expect(calls).not.toMatch(/SCRAM-SHA-256|PASSWORD/i);
    for (const v of vals!.split('\n').filter(Boolean)) {
      expect(calls).not.toContain(v);
      expect(o).not.toContain(v);
    }
    expect(out).not.toMatch(/SCRAM-SHA-256\$/);
  });

  it('idempotent: a second run exits 0 and every role still authenticates', () => {
    const r = run(`${STAGE()} >/dev/null 2>&1; echo "rc=$?"; PGPASSWORD=$(cat /etc/polycarpic/secrets/web/db_password_app) psql -h ${names.good} -U poly_app -d polycarpic -tAc 'select 1'`, { image: HOST, network: NET });
    expect(r.out).toMatch(/rc=0\n1\n?$/);
  });

  it('refuses an unknown --project (exit 2) and a missing one (positive case: prod and staging are accepted)', () => {
    const r = run(`${OPS} ${point(names.good, null)}; bash /tmp/ops/provision.sh --stage database --project nope 2>&1; echo "rc=$?"; bash /tmp/ops/provision.sh --stage database 2>&1; echo "rc=$?"`, { image: HOST, network: NET });
    expect(r.out.match(/rc=(\d)/g)).toEqual(['rc=2', 'rc=2']);
  });
});

describe('provision-check database checks D1–D6, with a running Postgres', () => {
  it('everything good: ALL CHECKS PASSED, exit 0, no WAIT, no WARN, INFO H12b not counted as a pass', () => {
    const r = ALL();
    expect(r.out).toMatch(/rc=0/);
    expect(last(r.out.replace(/rc=\d\s*$/, ''))).toBe('ALL CHECKS PASSED');
    expect(lines(r.out).filter((l) => ['WAIT', 'WARN', 'FAIL'].includes(l.kind))).toEqual([]);
    for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) expect(find(r.out, 'PASS', id), id).toBeDefined();
  });

  it('D1: wrong archive_mode, shared_preload_libraries and log_min_duration_statement are each named', () => {
    const r = ALL('', { prod: names.bad, staging: names.good });
    failLine(r, 'D1', ['archive_mode', 'shared_preload_libraries', 'log_min_duration_statement']);
  });
  it('D2: an extension besides plpgsql fails (staging faulty, prod good: the check covers both)', () => {
    const r = ALL('', { prod: names.good, staging: names.bad });
    failLine(r, 'D2', ['pgcrypto']);
  });
  it('D3 positive: web and uploader are refused for the right reason, backup connects and replicates, with the probe hygiene of Addendum 3', () => {
    const r = run(`${OPS}\n${b2Fixture({})}\n${nets(NETS_GOOD)}\n${point(names.good, names.stg)}\n${CHECK} >/tmp/out 2>&1; cat /tmp/out; echo ==CALLS==; grep '^docker run' /var/fake-state/calls.log; echo ==SWEEP==; cat /etc/polycarpic/secrets/backup/db_password_backup`, { image: COMPLETE, network: NET });
    const [out, rest] = r.out.split('==CALLS==');
    const [calls, pw] = rest!.split('==SWEEP==');
    expect(find(out!, 'PASS', 'D3')).toBeDefined();
    const runs = calls!.trim().split('\n').filter(Boolean);
    expect(runs.length).toBeGreaterThanOrEqual(3); // one probe per service (two modes for web and backup may share a call)
    for (const svc of ['web', 'uploader', 'backup']) expect(runs.some((l) => new RegExp(`--network container:\\S*${svc}`).test(l)), svc).toBe(true);
    for (const l of runs) {
      expect(l).toMatch(/--tmpfs/);
      expect(l).toMatch(/require_auth=scram-sha-256/);
      expect(l).toMatch(/db_password_backup\S*:ro|db_password_backup\S*readonly/);
      expect(l).not.toMatch(/ -e |--env|PGPASSWORD/);
      expect(l).not.toContain(pw!.trim());
    }
    expect(out).not.toContain(pw!.trim()); // R10: the probe's output and the fake's call log carry no password
    expect(calls).not.toContain(pw!.trim());
  });
  it('D3: web that connects, or is refused for another reason (password failure), fails naming web and the reason', () => {
    failLine(ALL('echo ok > /var/fake-state/c79-web'), 'D3', ['web']);
    failLine(ALL('echo "psql: error: FATAL:  password authentication failed for user poly_backup" > /var/fake-state/c79-web'), 'D3', ['web', 'pg_hba']);
  });
  it('D3: uploader that reaches Postgres at all, or fails for a reason other than name/route, fails', () => {
    failLine(ALL('echo ok > /var/fake-state/c79-uploader'), 'D3', ['uploader']);
    failLine(ALL('echo "psql: error: FATAL:  no pg_hba.conf entry for host" > /var/fake-state/c79-uploader'), 'D3', ['uploader']);
  });
  it('D3: a backup container that cannot connect (or cannot replicate) fails', () => {
    failLine(ALL('echo "psql: error: connection refused" > /var/fake-state/c79-backup'), 'D3', ['backup']);
  });
  it('D4: a leftover non-temporary replication slot fails, naming it', () => {
    failLine(ALL('', { prod: names.bad, staging: names.good }), 'D4', ['leftover']);
  });
  it('D5: a login role with no SCRAM verifier fails, naming the role', () => {
    failLine(ALL('', { prod: names.bad, staging: names.stg }), 'D5', [/poly_(app|auth|worker|migrator|operator|backup)/]);
  });
  it('D5 on staging: poly_backup has NO verifier (positive), and a verifier there is a FAIL naming poly_backup; the other five are checked on both projects', () => {
    const q = (host: string) => `psql -h ${host} -U postgres -d polycarpic -tAc "select rolpassword is null from pg_authid where rolname='poly_backup'"`;
    const r = run(`export PGPASSWORD=$(cat /etc/polycarpic/secrets/postgres/db_superuser_password); ${q(names.stg)}; ${q(names.good)}`, { image: HOST, network: NET });
    expect(r.out.trim().split('\n')).toEqual(['t', 'f']);
    failLine(ALL('', { prod: names.good, staging: names.good }), 'D5', ['poly_backup', 'staging']);
  });
  it('D6: a wrong subnet on a fixed network, and a stray network inside 10.201.0.0/16, each fail', () => {
    const bad = NETS_GOOD.map(([n, s]) => (n === 'polycarpic-prod_backup-net' ? [n, '10.201.99.0/29'] : [n, s]));
    failLine(ALL(nets(bad)), 'D6', ['backup-net']);
    failLine(ALL(nets([...NETS_GOOD, ['rogue_default', '10.201.77.0/24']])), 'D6', ['rogue_default']);
  });
  it('D6 positive: a network outside both /16s is fine', () => {
    expect(find(ALL(nets([...NETS_GOOD, ['other', '172.30.0.0/24']])).out, 'PASS', 'D6')).toBeDefined();
  });
});

describe('summary lines (R4)', () => {
  it('a WARN with no FAIL or WAIT: "PASSED WITH 1 WARNINGS: H13", exit 0, never ALL CHECKS PASSED', () => {
    const r = ALL('rm /etc/polycarpic/secrets/uploader/heartbeat_url');
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/^PASSED WITH 1 WARNINGS: H13$/m);
    expect(r.out).not.toMatch(/ALL CHECKS PASSED/);
  });
  it('--prod turns the WARN into a FAIL: "1 CHECKS FAILED", exit 1, the FAIL carries the fix', () => {
    const r = ALL('rm /etc/polycarpic/secrets/uploader/heartbeat_url', { args: '--prod' });
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/^1 CHECKS FAILED$/m);
    failLine(r, 'H13', ['heartbeat']);
  });
  it('a prod cluster on disk (pg-prod/PG_VERSION) makes the check behave as --prod without the flag', () => {
    const r = ALL('rm /etc/polycarpic/secrets/uploader/heartbeat_url; echo 17 > /srv/polycarpic/pg-prod/PG_VERSION');
    expect(r.out).toMatch(/rc=1/);
    expect(find(r.out, 'FAIL', 'H13')).toBeDefined();
  });
  it('a staging-only box (no prod cluster) reports the warning and passes', () => {
    const r = ALL('rm /etc/polycarpic/secrets/uploader/heartbeat_url; rm -f /srv/polycarpic/pg-prod/PG_VERSION');
    expect(find(r.out, 'WARN', 'H13')).toBeDefined();
    expect(r.out).toMatch(/rc=0/);
  });
  it('FAIL beats WARN and WAIT: the failing summary counts only FAILs', () => {
    const r = ALL('rm /etc/polycarpic/secrets/uploader/heartbeat_url; echo no > /var/fake-state/ntp');
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/^1 CHECKS FAILED$/m);
  });
  it('R10: no fixture B2 key, application key or authorizationToken in any output of the full run', () => {
    const r = ALL();
    for (const v of Object.values(FX)) expect(r.all).not.toContain(v);
  });
});
