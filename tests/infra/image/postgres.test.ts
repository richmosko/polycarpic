// POLY-95 R5, R6, R8, criteria 2 and 3: the compose-run prod `postgres` (stack.ts) -- SHOW, sourcefile, role settings,
// ALTER SYSTEM, runtime uid, the archive_command fail-closed behaviour, and secret-file modes under a non-root uid.
// Runs in the existing `image` job. Each test names the mutation that turns it red.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMG, sh, up, type Stack } from './stack.ts';

let s: Stack;
beforeAll(() => { s = up(); });
afterAll(() => { s?.down(); });

const SETTINGS: [string, string, string][] = [
  // [name, SHOW value, mutation that turns it red]
  ['max_replication_slots', '2', 'value 10 (Postgres default) or missing from the fragment'],
  ['max_wal_senders', '3', 'value 10 (default)'],
  ['max_slot_wal_keep_size', '2GB', 'left at -1 (unbounded: a slot can fill the disk)'],
  ['log_connections', 'on', 'left at the default off (PG17)'],
  ['log_parameter_max_length', '0', 'default -1 logs bind parameters'],
  ['log_parameter_max_length_on_error', '0', 'default 0 is fine, but -1 or missing from the fragment'],
  ['log_statement', 'ddl', "'all' or 'none'"],
  ['archive_mode', 'on', 'archive_mode off or missing'],
  ['archive_timeout', '5min', 'archive_timeout 0 or 60'],
  ['password_encryption', 'scram-sha-256', 'md5'],
  ['allow_alter_system', 'off', 'left on'],
  ['shared_buffers', '768MB', 'default 128MB'],
  ['hba_file', '', 'not in the fragment'],
  ['listen_addresses', '', 'not in the fragment'],
];

describe('Postgres settings on the compose-run container (criterion 2, R5)', () => {
  it.each(SETTINGS.filter(([, v]) => v))('SHOW %s = %s', (name, want) => {
    expect(s.psql(`SHOW ${name}`)).toBe(want);
  });
  it('every setting comes from the mounted fragment (pg_settings.sourcefile = config_file), none from -c / env / ALTER', () => {
    const cf = s.psql('SHOW config_file');
    // hba_file is excluded: PG17 forces its source to "override" with no sourcefile (SelectConfigFiles); the SHOW hba_file test covers it.
    const listed = SETTINGS.filter(([n]) => n !== 'hba_file');
    const names = listed.map(([n]) => `'${n}'`).join(',');
    const rows = s.psql(`SELECT name||'|'||source||'|'||coalesce(sourcefile,'') FROM pg_settings WHERE name IN (${names})`).split('\n');
    expect(rows).toHaveLength(listed.length);
    for (const r of rows) {
      const [name, source, file] = r.split('|');
      expect({ name, source, file }).toEqual({ name, source: 'configuration file', file: cf }); // red: a -c flag, env var or command-line override
    }
  });
  it('no role or database setting overrides anything (pg_db_role_setting is empty)', () => {
    const n = s.psql(`SELECT count(*) FROM pg_db_role_setting`);
    expect(n).toBe('0');
  });
  it('hba_file is the mounted pg_hba and every rule parses; the first four rows are the C-79 lines', () => {
    const mount = s.cfg.services.postgres.volumes.find((v: any) => /pg_hba\.prod\.conf$/.test(v.source));
    expect(mount, 'prod.yml mounts pg_hba.prod.conf').toBeDefined();
    expect(s.psql('SHOW hba_file')).toBe(mount.target); // red: initdb's $PGDATA/pg_hba.conf (host all all all scram) in force
    expect(s.psql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL')).toBe('0');
    const rows = s.psql("SELECT type||' '||database::text||' '||user_name::text||' '||coalesce(address,'')||' '||coalesce(netmask,'')||' '||auth_method FROM pg_hba_file_rules ORDER BY rule_number LIMIT 4").split('\n');
    expect(rows).toEqual([
      'host {replication} {poly_backup} 10.201.10.0 255.255.255.248 scram-sha-256',
      'host {polycarpic} {poly_backup} 10.201.10.0 255.255.255.248 scram-sha-256',
      'host {all} {poly_backup} all  reject',
      'host {replication} {all} all  reject',
    ]); // red: order changed, a line dropped, or a different file
  });
  it('ALTER SYSTEM is refused (allow_alter_system = off)', () => {
    const r = s.exec('psql', '-U', 'postgres', '-d', 'postgres', '-X', '-c', "ALTER SYSTEM SET log_statement='all'");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/ALTER SYSTEM is not allowed/i);
  });
  it('prod.yml adds no capability back (no cap_add on postgres)', () => {
    expect(s.cfg.services.postgres.cap_add ?? []).toEqual([]);
  });
  it('the server runs as uid 999 with a read-only root filesystem', () => {
    expect(s.exec('id', '-u').out).toBe('999');
    expect(s.exec('sh', '-c', 'touch /usr/x 2>&1; echo $?').out).toMatch(/Read-only|1$/); // red: read_only dropped or user left as root
  });
});

describe('secret files under per-service directories (R8, ruling A1)', () => {
  const dirOf = (svc: string) => `/w/etc/polycarpic/secrets/${svc}`;
  const gidOf = (svc: string) => String(s.cfg.services[svc].user).split(':')[1]!;
  it('each service directory is root:<its gid> 0750 and its files 0440; every service has its own uid and gid', () => {
    const svcs = Object.keys(s.cfg.services);
    const ids = svcs.map((n) => String(s.cfg.services[n].user));
    expect(new Set(ids.map((i) => i.split(':')[0])).size).toBe(svcs.length); // red: shared uid
    expect(new Set(ids.map((i) => i.split(':')[1])).size).toBe(svcs.length); // red: shared gid
    for (const n of svcs) {
      const d = s.root(`stat -c "%u:%g %a" ${dirOf(n)}`).out;
      expect(d, n).toBe(`0:${gidOf(n)} 750`);
      expect(s.root(`stat -c "%a" ${dirOf(n)}/* | sort -u`).out, n).toBe('440');
    }
  });
  it('postgres (999) reads db_superuser_password in its own directory, at /run/secrets', () => {
    const r = s.exec('cat', '/run/secrets/db_superuser_password');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^qa-db_superuser_password__postgres-fixture$/); // red: secret not mounted there / wrong source file
  });
  it('web (10001) can read a file in its own directory', () => {
    const r = sh('docker', ['run', '--rm', '-v', `${s.dir}:/w:ro`, '--user', s.cfg.services.web.user, '--entrypoint', 'cat', IMG, `${dirOf('web')}/db_password_app`]);
    expect(r.code, r.err).toBe(0); // red: harness/ownership precondition (own dir 0750 root:gid, file 0440)
  });
  it('web is refused a file in postgres\'s directory, and postgres in web\'s (0440 root:gid is not world-readable)', () => {
    const a = sh('docker', ['run', '--rm', '-v', `${s.dir}:/w:ro`, '--user', s.cfg.services.web.user, '--entrypoint', 'cat', IMG, `${dirOf('postgres')}/db_superuser_password`]);
    expect(a.code).not.toBe(0);
    expect(a.err).toMatch(/Permission denied/i); // red: directory 0755 or file 0444
    const b = sh('docker', ['run', '--rm', '-v', `${s.dir}:/w:ro`, '--user', s.cfg.services.postgres.user, '--entrypoint', 'cat', IMG, `${dirOf('web')}/db_password_app`]);
    expect(b.code).not.toBe(0);
    expect(b.err).toMatch(/Permission denied/i);
  });
  it('a 0440 file in a service directory is refused to an unrelated uid', () => {
    const r = s.compose('exec', '-T', '-u', '4242:4242', 'postgres', 'cat', '/run/secrets/db_superuser_password');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/Permission denied/i); // red: world-readable bit set
  });
});

const SEG = '000000010000000000000042';
const archiveCmd = () => s.psql('SHOW archive_command');
const runArchive = (path: string, name: string) => {
  const cmd = archiveCmd().replaceAll('%p', path).replaceAll('%f', name);
  return s.exec('sh', '-c', cmd);
};
const mkSeg = (path: string, bytes: number, seed: string) =>
  s.exec('sh', '-c', `head -c ${bytes} /dev/zero | tr '\\0' '${seed}' > ${path}`);
const walDir = () => '/w/srv/polycarpic/spool/wal';

describe('archive_command: age, fail closed (criterion 3, R6)', () => {
  it('archive_command is wired: encrypts with age into spool/wal and takes %p %f', () => {
    expect(archiveCmd()).toMatch(/%p/);
    expect(archiveCmd()).toMatch(/%f/);
    expect(archiveCmd()).not.toMatch(/gzip|cp |cat /); // red: a plaintext copy path
  });
  it('one segment -> <f>.age that the test private key decrypts byte-identical; no plaintext in the spool', () => {
    expect(mkSeg('/tmp/seg1', 1048576, 'A').code).toBe(0);
    expect(runArchive('/tmp/seg1', SEG).code).toBe(0);
    expect(s.root(`ls ${walDir()}/${SEG}.age`).code).toBe(0);
    const plain = s.exec('sh', '-c', 'sha256sum < /tmp/seg1').out;
    const dec = sh('docker', ['run', '--rm', '-i', '-v', `${s.dir}:/w`, '--entrypoint', 'sh', IMG, '-c',
      `cat > /tmp/id; age -d -i /tmp/id ${walDir()}/${SEG}.age | sha256sum`], { input: s.identity });
    expect(dec.out).toBe(plain); // red: encrypted to the wrong recipient, or not encrypted
    expect(s.root(`! grep -q AAAAAAAAAAAAAAAA ${walDir()}/${SEG}.age`).code).toBe(0); // red: a plaintext copy in the spool
  });
  it('a DIFFERENT target already exists -> non-zero, target unchanged', () => {
    const f = '000000010000000000000043';
    expect(mkSeg('/tmp/seg2', 4096, 'B').code).toBe(0);
    s.root(`printf 'pre-existing' > ${walDir()}/${f}.age && chown 999:999 ${walDir()}/${f}.age`);
    const before = s.root(`sha256sum ${walDir()}/${f}.age`).out;
    const r = runArchive('/tmp/seg2', f);
    expect(r.code).not.toBe(0); // red: the script overwrites (cp/mv/redirect instead of ln no-clobber)
    expect(s.root(`sha256sum ${walDir()}/${f}.age`).out).toBe(before);
  });
  it('the IDENTICAL segment re-archived (target exists) -> non-zero too, target unchanged, no .sums directory (A1: no liveness path)', () => {
    const f = '000000010000000000000044';
    expect(mkSeg('/tmp/seg3', 4096, 'C').code).toBe(0);
    expect(runArchive('/tmp/seg3', f).code).toBe(0);
    const before = s.root(`sha256sum ${walDir()}/${f}.age`).out;
    expect(runArchive('/tmp/seg3', f).code).not.toBe(0); // red: a sum-match shortcut returns 0 on an existing target
    expect(s.root(`sha256sum ${walDir()}/${f}.age`).out).toBe(before);
    expect(s.root(`ls -A ${walDir()}`).out).not.toMatch(/\.sums/); // red: plaintext hashes written beside the spool
  });
  it('a stale temp from an earlier failed attempt on the same segment is removed by the next attempt', () => {
    const f = '000000010000000000000046';
    expect(mkSeg('/tmp/seg5', 4096, 'F').code).toBe(0);
    s.root(`mkdir -p ${walDir()}/.inflight && printf stale > ${walDir()}/.inflight/${f}.age.99999 && chown -R 999:999 ${walDir()}/.inflight`);
    expect(runArchive('/tmp/seg5', f).code).toBe(0);
    expect(s.root(`ls -A ${walDir()}/.inflight | wc -l`).out).toBe('0'); // red: stale temp never cleaned
  });
  it('an age failure (unreadable recipients file) -> non-zero, no .age, .inflight empty', () => {
    const f = '000000010000000000000045';
    const rec = s.root('ls /w/etc/polycarpic | grep -i age').out.split('\n')[0]!;
    s.root(`chown 0:0 /w/etc/polycarpic/${rec} && chmod 0600 /w/etc/polycarpic/${rec}`);
    expect(mkSeg('/tmp/seg4', 4096, 'E').code).toBe(0);
    const r = runArchive('/tmp/seg4', f);
    s.root(`chmod 0644 /w/etc/polycarpic/${rec}`);
    expect(r.code).not.toBe(0); // red: set -e / pipefail missing, age error swallowed
    expect(s.root(`ls ${walDir()}/${f}.age 2>&1; ls -A ${walDir()}/.inflight | wc -l`).out).toMatch(/No such file[\s\S]*0$/); // red: temp left or target created
    s.root(`printf stale > ${walDir()}/.inflight/${f}.age.77777 && chown 999:999 ${walDir()}/.inflight/${f}.age.77777`);
    expect(runArchive('/tmp/seg4', f).code).toBe(0); // the recipients file is readable again
    expect(s.root(`ls -A ${walDir()}/.inflight | wc -l`).out).toBe('0'); // red: failed attempt leaves residue the next one keeps
  });
  it('PostgreSQL itself hits the guard: a differing pre-existing target for the next segment raises pg_stat_archiver.failed_count', () => {
    const name = s.psql('SELECT pg_walfile_name(pg_current_wal_lsn())');
    const before = Number(s.psql('SELECT failed_count FROM pg_stat_archiver'));
    s.root(`printf 'squatter' > ${walDir()}/${name}.age && chown 999:999 ${walDir()}/${name}.age`);
    s.psql('SELECT pg_switch_wal()');
    const deadline = Date.now() + 90_000;
    let after = before;
    while (Date.now() < deadline && after <= before) {
      s.exec('sh', '-c', 'sleep 2');
      after = Number(s.psql('SELECT failed_count FROM pg_stat_archiver'));
    }
    expect(after).toBeGreaterThan(before); // red: the server does not run the script, or it overwrites and succeeds
    expect(s.root(`cat ${walDir()}/${name}.age`).out).toBe('squatter');
  });
});
