// POLY-97 R5 (--stage database), M2, R10 (verifiers never logged). Stays in the `image` job: it needs the Postgres derivative
// (infra/postgres) that job builds. The dry-run tests, the H/D checks and the summaries moved to the `provision` job
// (tests/infra/provision/, architect's CI remedy, pins-review @ 5b2a5e90).
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST, ROOT, build, makeHost, run, sh } from '../provision/box.ts';
import { LOGIN, OPS, STAGE as STAGE_AT, asSuper, namesFor, point, secretValues, startPg, superPassword, waitPg } from '../provision/pg.ts';

const NET = `poly97net${process.pid}`;
const PGIMG = 'poly97-pg:test';
const names = namesFor('s');
const STAGE = (project = 'prod', host = names.good) => STAGE_AT(host, project);

// A failed setup fails every test with its own message (not "skipped"), so the red run counts each test.
let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`host stage failed on the fake box:\n${h.all.slice(-1200)}`);
    const superPw = superPassword();
    const b = sh('docker', ['build', '-q', '-t', PGIMG, join(ROOT, 'infra', 'postgres')]);
    if (b.code !== 0) throw new Error(`docker build infra/postgres: ${b.err.slice(-400)}`);
    sh('docker', ['network', 'create', NET]);
    for (const n of [names.good, names.fail, names.stg]) startPg(n, NET, PGIMG, superPw);
    for (const n of [names.good, names.fail, names.stg]) waitPg(n);
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });
afterAll(() => {
  for (const n of [names.good, names.fail, names.stg]) sh('docker', ['rm', '-f', n]);
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
    const vals = secretValues();
    expect(vals.length).toBeGreaterThan(5);
    for (const v of vals) expect(log).not.toContain(v);
  });

  it('M2: a forced failing ALTER (the fake psql breaks its syntax) exits non-zero and still leaves no plaintext and no verifier in the Postgres log', () => {
    const r = run(`${OPS} ${point(names.fail, null)}; touch /var/fake-state/psql-break-alter; bash /tmp/ops/provision.sh --stage database --project prod > /tmp/o 2>&1; echo "rc=$?"; cat /tmp/o`, { image: HOST, network: NET });
    expect(r.out).not.toMatch(/rc=0\n/);
    const log = sh('docker', ['logs', names.fail]).all;
    expect(log, 'control: the broken ALTER really failed inside Postgres').toMatch(/unrecognized role option|syntax error/);
    expect(log).not.toMatch(/SCRAM-SHA-256\$/);
    const vals = secretValues();
    for (const v of vals) expect(log).not.toContain(v);
    expect(r.all).not.toMatch(/SCRAM-SHA-256\$/); // not on the operator's screen either
  });

  it('no password or verifier in argv (the fakes\' call log) or in the script\'s output', () => {
    const r = run(`${STAGE()} > /tmp/o 2>&1; cat /tmp/o; echo ==; grep -E '^docker' /var/fake-state/calls.log; echo ==; for f in /etc/polycarpic/secrets/*/*; do cat $f; echo; done`, { image: HOST, network: NET });
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

  it('A-M2 mutation: with the two SET lines stripped from the ALTER path the verifier DOES reach the Postgres log (so the sweep above has power)', () => {
    const r = run(`${OPS} ${point(names.fail, null)}; touch /var/fake-state/psql-strip-sets /var/fake-state/psql-break-alter; bash /tmp/ops/provision.sh --stage database --project prod > /tmp/o 2>&1; echo "rc=$?"`, { image: HOST, network: NET });
    expect(r.out).not.toMatch(/rc=0\n/);
    const log = sh('docker', ['logs', names.fail]).all;
    expect(log, 'without SET log_min_error_statement the failing ALTER is logged with its verifier').toMatch(/SCRAM-SHA-256\$/);
    expect(log).toMatch(/STATEMENT:\s+ALTER ROLE/);
  });

  it('staging stage (Addendum 2): sets the five staging roles from staging-secrets (each authenticates) and leaves poly_backup with NO verifier', () => {
    const roles = Object.entries(LOGIN).filter(([r]) => r !== 'poly_backup');
    const r = run(`${STAGE('staging', names.stg)} >/dev/null 2>&1; echo "rc=$?"; ${asSuper(`psql -h ${names.stg} -U postgres -d polycarpic -tAc "select rolpassword is null from pg_authid where rolname='poly_backup'"`)}
${roles.map(([role, f]) => `PGPASSWORD=$(cat /etc/polycarpic/staging-secrets/${f}) psql -h ${names.stg} -U ${role} -d polycarpic -tAc 'select current_user'`).join('\n')}`, { image: HOST, network: NET });
    expect(r.out.trim().split('\n')).toEqual(['rc=0', 't', ...roles.map(([role]) => role)]);
  });
});
