// POLY-97 R6 D1–D6 and the R4 summaries that need a running Postgres. Runs in the `provision` job on the pinned base image
// (the FROM line of infra/postgres/Dockerfile), with the prod postgresql.conf; the box reaches it through the fake docker.
// The database-stage test (verifier, log sweep) stays in the `image` job: tests/infra/image/provision-db.test.ts.
// Contract pins (test-plan.md): D3 probes per ruling Addenda 2/3; D5 on staging asserts poly_backup has no verifier.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETE, FX, HOST, b2Fixture, build, failLine, find, last, lines, makeComplete, makeHost, run, sh } from './box.ts';
import { BASE_IMAGE, CHECK_OPS, NETS_GOOD, OPS, STAGE, asSuper, checkAll, namesFor, nets, point, startPg, superPassword, waitPg } from './pg.ts';

const NET = `poly97net${process.pid}c`;
const names = namesFor('c');
const ALL = checkAll(names, NET);
const CHECK = CHECK_OPS;

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`host stage failed on the fake box:\n${h.all.slice(-1200)}`);
    const c = makeComplete();
    if (c.code !== 0) throw new Error(`complete box failed: ${c.all.slice(-600)}`);
    const superPw = superPassword();
    sh('docker', ['network', 'create', NET]);
    startPg(names.good, NET, BASE_IMAGE, superPw);
    startPg(names.bad, NET, BASE_IMAGE, superPw, ['-c', 'archive_mode=off', '-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'log_min_duration_statement=0']);
    startPg(names.stg, NET, BASE_IMAGE, superPw, [], true, 'staging');
    // a staging instance with one other D1 setting wrong
    startPg(names.fail, NET, BASE_IMAGE, superPw, ['-c', 'log_min_duration_statement=0'], true, 'staging');
    for (const n of [names.good, names.bad, names.stg, names.fail]) waitPg(n);
    // prod roles and passwords on the good instance, staging's five on the staging one (poly_backup gets no verifier there)
    const prod = run(`${STAGE(names.good)} 2>&1`, { image: HOST, network: NET });
    if (prod.code !== 0) throw new Error(`the prod database stage failed: ${prod.all.slice(-600)}`);
    const stg = run(`${STAGE(names.stg, 'staging')} 2>&1`, { image: HOST, network: NET });
    if (stg.code !== 0) throw new Error(`the staging database stage failed: ${stg.all.slice(-600)}`);
    // the faulty instance: roles without passwords, an extra extension, a leftover replication slot
    const seed = run(`${asSuper('')} for q in "CREATE EXTENSION pgcrypto" "SELECT pg_create_physical_replication_slot('leftover')"; do psql -h ${names.bad} -U postgres -d polycarpic -c "$q"; done; psql -h ${names.bad} -U postgres -d polycarpic -f /repo/packages/db/sql/roles.sql`, { image: HOST, network: NET });
    if (seed.code !== 0) throw new Error(`seeding the faulty instance: ${seed.all.slice(-600)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });
afterAll(() => {
  for (const n of [names.good, names.bad, names.stg, names.fail]) sh('docker', ['rm', '-f', n]);
  sh('docker', ['network', 'rm', NET]);
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
    const r = ALL('', { prod: names.bad, staging: names.stg });
    failLine(r, 'D1', ['prod:', 'archive_mode is off (want on)', 'shared_preload_libraries', 'log_min_duration_statement']);
  });
  // POLY-104 F17 (first real box): staging is not backed up (INFRA §6.1), so postgresql.staging.conf turns archiving off, and D1 wanted it on
  it('F17: D1 passes a staging Postgres on postgresql.staging.conf beside a prod one on the prod conf', () => {
    const r = ALL('', { prod: names.good, staging: names.stg });
    expect(find(r.out, 'FAIL', 'D1')?.text).toBeUndefined();
    expect(find(r.out, 'PASS', 'D1'), r.out.slice(-900)).toBeDefined();
  });
  it('F17: D1 FAILs a staging Postgres with archiving on, naming staging and both settings, and says nothing against prod', () => {
    const line = failLine(ALL('', { prod: names.good, staging: names.good }), 'D1', ['staging:', 'archive_mode is on (want off)', 'archive_timeout is 300 (want 0)']);
    expect(line).not.toContain('prod:');
  });
  it('F17: D1 still FAILs staging for another wrong setting, and names only that one', () => {
    const line = failLine(ALL('', { prod: names.good, staging: names.fail }), 'D1', ['staging:', 'log_min_duration_statement is 0 (want -1)']);
    expect(line).not.toContain('archive_');
  });
  it('F17: D1 FAILs a prod Postgres on the staging conf: prod still wants archiving on every 300 s', () => {
    failLine(ALL('', { prod: names.stg, staging: names.stg }), 'D1', ['prod:', 'archive_mode is off (want on)', 'archive_timeout is 0 (want 300)']);
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
    // verdict C1: backup and uploader are one-off runs (named <proj>-backup-run-<id>), so the probe joins their NETWORKS, and web's container by id
    expect(runs.some((l) => /--network container:web-cid-0001\b/.test(l)), 'web: its running container').toBe(true);
    expect(runs.some((l) => /--network polycarpic-prod_backup-net\b/.test(l)), 'backup: its network').toBe(true);
    expect(runs.some((l) => /--network polycarpic-prod_upload-net\b/.test(l)), 'uploader: its network').toBe(true);
    for (const l of runs) {
      expect(l, 'the running postgres container\'s image, no default tag').toContain('fixture-pg-image:17-running');
      expect(l).not.toMatch(/postgres:17(\s|$)|prod-(backup|uploader)-1/);
    }
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
  it('D3 (verdict C1): a missing web container, and a missing backup or upload network, are each a FAIL naming what is missing', () => {
    failLine(ALL('touch /var/fake-state/no-web'), 'D3', ['web']);
    const without = (net: string) => nets(NETS_GOOD.filter(([n]) => n !== net));
    failLine(ALL(without('polycarpic-prod_backup-net')), 'D3', ['polycarpic-prod_backup-net']);
    failLine(ALL(without('polycarpic-prod_upload-net')), 'D3', ['polycarpic-prod_upload-net']);
  });
  it('D3 (verdict C1 fallback): when the running postgres container\'s image cannot be read (no container, or inspect fails) the result is FAIL D3 naming the image, and no probe is ever run on a default image', () => {
    for (const plant of ['touch /var/fake-state/no-pg-cid', 'touch /var/fake-state/inspect-fail']) {
      const r = run(`${OPS}\n${b2Fixture({})}\n${nets(NETS_GOOD)}\n${point(names.good, names.stg)}\n${plant}\n${CHECK} > /tmp/out 2>&1; cat /tmp/out; echo ==CALLS==; grep -c '^docker run' /var/fake-state/calls.log || true`, { image: COMPLETE, network: NET });
      const [out, calls] = r.out.split('==CALLS==');
      failLine({ ...r, out: out! }, 'D3', ['image']);
      expect(calls!.trim().split('\n').pop(), plant).toBe('0');
    }
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
    const r = ALL('rm /etc/polycarpic/secrets/host/heartbeat_url');
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/^PASSED WITH 1 WARNINGS: H13$/m);
    expect(r.out).not.toMatch(/ALL CHECKS PASSED/);
  });
  it('--prod turns the WARN into a FAIL: "1 CHECKS FAILED", exit 1, the FAIL carries the fix', () => {
    const r = ALL('rm /etc/polycarpic/secrets/host/heartbeat_url', { args: '--prod' });
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/^1 CHECKS FAILED$/m);
    failLine(r, 'H13', ['heartbeat']);
  });
  it('a prod cluster on disk (pg-prod/PG_VERSION) makes the check behave as --prod without the flag', () => {
    const r = ALL('rm /etc/polycarpic/secrets/host/heartbeat_url; echo 17 > /srv/polycarpic/pg-prod/PG_VERSION');
    expect(r.out).toMatch(/rc=1/);
    expect(find(r.out, 'FAIL', 'H13')).toBeDefined();
  });
  it('a staging-only box (no prod cluster) reports the warning and passes', () => {
    const r = ALL('rm /etc/polycarpic/secrets/host/heartbeat_url; rm -f /srv/polycarpic/pg-prod/PG_VERSION');
    expect(find(r.out, 'WARN', 'H13')).toBeDefined();
    expect(r.out).toMatch(/rc=0/);
  });
  it('FAIL beats WARN and WAIT: the failing summary counts only FAILs', () => {
    const r = ALL('rm /etc/polycarpic/secrets/host/heartbeat_url; echo no > /var/fake-state/ntp');
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/^1 CHECKS FAILED$/m);
  });
  it('R10: no fixture B2 key, application key or authorizationToken in any output of the full run', () => {
    const r = ALL();
    for (const v of Object.values(FX)) expect(r.all).not.toContain(v);
  });
});
