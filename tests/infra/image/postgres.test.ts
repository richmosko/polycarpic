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
];

describe('Postgres settings on the compose-run container (criterion 2, R5)', () => {
  it.each(SETTINGS)('SHOW %s = %s', (name, want) => {
    expect(s.psql(`SHOW ${name}`)).toBe(want);
  });
  it('every setting comes from the mounted fragment (pg_settings.sourcefile = config_file), none from -c / env / ALTER', () => {
    const cf = s.psql('SHOW config_file');
    const names = SETTINGS.map(([n]) => `'${n}'`).join(',');
    const rows = s.psql(`SELECT name||'|'||source||'|'||coalesce(sourcefile,'') FROM pg_settings WHERE name IN (${names})`).split('\n');
    expect(rows).toHaveLength(SETTINGS.length);
    for (const r of rows) {
      const [name, source, file] = r.split('|');
      expect({ name, source, file }).toEqual({ name, source: 'configuration file', file: cf }); // red: a -c flag, env var or command-line override
    }
  });
  it('no role or database setting overrides them (pg_db_role_setting is empty of these names)', () => {
    const n = s.psql(`SELECT count(*) FROM pg_db_role_setting, unnest(setconfig) c WHERE split_part(c,'=',1) IN (${SETTINGS.map(([n]) => `'${n}'`).join(',')})`);
    expect(n).toBe('0');
  });
  it('ALTER SYSTEM is refused (allow_alter_system = off)', () => {
    const r = s.exec('psql', '-U', 'postgres', '-d', 'postgres', '-X', '-c', "ALTER SYSTEM SET log_statement='all'");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/ALTER SYSTEM is not allowed/i);
  });
  it('the server runs as uid 999 with a read-only root filesystem', () => {
    expect(s.exec('id', '-u').out).toBe('999');
    expect(s.exec('sh', '-c', 'touch /usr/x 2>&1; echo $?').out).toMatch(/Read-only|1$/); // red: read_only dropped or user left as root
  });
});

describe('secret files under a non-root uid (R8)', () => {
  it('the host fixture is root:999 mode 0440', () => {
    const r = s.root('stat -c "%u:%g %a" /w/etc/polycarpic/secrets/db_superuser_password');
    expect(r.out).toBe('0:999 440'); // red: harness precondition (provisioning rule) not met
  });
  it('uid 999 reads db_superuser_password at /run/secrets', () => {
    const r = s.exec('cat', '/run/secrets/db_superuser_password');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^qa-db_superuser_password-fixture$/); // red: secret not mounted there, or mode/owner rule broken
  });
  it('another uid cannot read it', () => {
    const r = s.compose('exec', '-T', '-u', '4242:4242', 'postgres', 'cat', '/run/secrets/db_superuser_password');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/Permission denied/i); // red: the file is world-readable (0444 / 0644)
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
  it('the IDENTICAL segment already archived (target + sum present) -> 0, nothing rewritten', () => {
    const f = '000000010000000000000044';
    expect(mkSeg('/tmp/seg3', 4096, 'C').code).toBe(0);
    expect(runArchive('/tmp/seg3', f).code).toBe(0);
    const before = s.root(`sha256sum ${walDir()}/${f}.age`).out;
    expect(runArchive('/tmp/seg3', f).code).toBe(0); // red: fails closed on the liveness case (crash between link and record)
    expect(s.root(`sha256sum ${walDir()}/${f}.age`).out).toBe(before);
  });
  it('a different segment under an already-archived name -> non-zero, target unchanged', () => {
    const f = '000000010000000000000044';
    expect(mkSeg('/tmp/seg3b', 4096, 'D').code).toBe(0);
    const before = s.root(`sha256sum ${walDir()}/${f}.age`).out;
    expect(runArchive('/tmp/seg3b', f).code).not.toBe(0); // red: sum compare missing, the name alone is trusted
    expect(s.root(`sha256sum ${walDir()}/${f}.age`).out).toBe(before);
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
