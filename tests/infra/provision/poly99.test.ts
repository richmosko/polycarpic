// POLY-99 R5, R9, R10 on the dry-run box (real users, ownership, modes, ACLs; faked volume, packages, Docker): provision.sh --stage host and
// provision-check.sh. Seceng C3 (the ACL shapes), H-1 (the host-only heartbeat_url), H6, H7, H8 and the new H16. The infra/provision/ box has
// real `getfacl`, `setfacl` and `setpriv`, so a file created as 10004 shows the effective permission the uploader would get.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETE, HOST, HOST_ARGS, ROOT, build, check, failLine, find, makeComplete, makeHost, run } from './box.ts';

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`the host stage did not complete on the fake box (rc ${h.code}): ${h.all.slice(-900)}`);
    const c = makeComplete();
    if (c.code !== 0) throw new Error(`planting the complete box failed: ${c.all.slice(-600)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 600_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });
const HOSTRUN = `bash /repo/infra/provision.sh ${HOST_ARGS}`;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const UNITS = ['polycarpic-backup.service', 'polycarpic-backup.timer', 'polycarpic-uploader.service', 'polycarpic-uploader.timer'];

describe('R10 the spool ACLs (C3): the uploader reads, root deletes', () => {
  it('wal/, dump/ and premigration/: access and default `u:10005:r-x`, owner 999 (wal) or 10004, mode bits 0700; no `rwx` entry for 10005 anywhere', () => {
    const r = run('for d in wal dump premigration; do echo "== $d"; stat -c "%u:%g %a" /srv/polycarpic/spool/$d; getfacl -cp /srv/polycarpic/spool/$d; done', { image: HOST });
    const blocks = Object.fromEntries(r.out.split('== ').slice(1).map((b) => [b.split('\n')[0]!, b]));
    expect(blocks.wal).toContain('999:999');
    expect(blocks.dump).toContain('10004:10004');
    expect(blocks.premigration).toContain('10004:10004');
    for (const d of ['wal', 'dump', 'premigration']) {
      expect(blocks[d], d).toMatch(/^user:10005:r-x$/m);
      expect(blocks[d], d).toMatch(/^default:user:10005:r-x$/m);
      expect(blocks[d], d).not.toMatch(/10005:rwx|10005:-w/);
    }
  });
  it('each spool dir has a .inflight/ with the parent\'s owner; its DEFAULT ACL is `u:10005:r--` and it has NO access entry for 10005', () => {
    const r = run('for d in wal dump premigration; do echo "== $d"; stat -c "%u:%g" /srv/polycarpic/spool/$d /srv/polycarpic/spool/$d/.inflight; getfacl -cp /srv/polycarpic/spool/$d/.inflight; done', { image: HOST });
    const blocks = Object.fromEntries(r.out.split('== ').slice(1).map((b) => [b.split('\n')[0]!, b]));
    for (const d of ['wal', 'dump', 'premigration']) {
      const [own, inflight] = blocks[d]!.split('\n').slice(1, 3);
      expect(inflight, `${d}/.inflight owner`).toBe(own);
      expect(blocks[d], d).toMatch(/^default:user:10005:r--$/m);
      expect(blocks[d], d).not.toMatch(/^user:10005:/m);
    }
  });
  it('T13/C3 on a real filesystem: a file created by 10004 in dump/ (mode 0666, as age does) gives 10005 an effective r--; one created in .inflight/ and linked out does too', () => {
    const mk = `setpriv --reuid=10004 --regid=10004 --clear-groups python3 -c 'import os,sys; os.close(os.open(sys.argv[1], os.O_CREAT|os.O_WRONLY, 0o666))'`;
    const r = run(`${mk} /srv/polycarpic/spool/dump/a.age; ${mk} /srv/polycarpic/spool/dump/.inflight/b.age; setpriv --reuid=10004 --regid=10004 --clear-groups ln /srv/polycarpic/spool/dump/.inflight/b.age /srv/polycarpic/spool/dump/b.age; getfacl -cp /srv/polycarpic/spool/dump/a.age; echo ==; getfacl -cp /srv/polycarpic/spool/dump/b.age`, { image: HOST });
    for (const blk of r.out.split('==')) {
      const m = /^user:10005:(\S+)(?:\s+#effective:(\S+))?/m.exec(blk);
      expect(m, blk).not.toBeNull();
      expect(m![2] ?? m![1]).toBe('r--');
    }
  });
  it('as 10005 on the real filesystem: opening a published file for write fails EACCES, creating in dump/ fails, listing .inflight/ fails', () => {
    const mk = `setpriv --reuid=10004 --regid=10004 --clear-groups python3 -c 'import os,sys; os.close(os.open(sys.argv[1], os.O_CREAT|os.O_WRONLY, 0o666))'`;
    const as5 = 'setpriv --reuid=10005 --regid=10005 --clear-groups';
    const ops = [['WRITE', 'echo x >> /srv/polycarpic/spool/dump/c.age'], ['CREATE', 'touch /srv/polycarpic/spool/dump/new'], ['DELETE', 'rm /srv/polycarpic/spool/dump/c.age'], ['LISTINFLIGHT', 'ls /srv/polycarpic/spool/dump/.inflight']];
    const r = run(`${mk} /srv/polycarpic/spool/dump/c.age; ${as5} bash -c 'cat /srv/polycarpic/spool/dump/c.age >/dev/null && echo read-ok'; ${ops.map(([k, c]) => `${as5} bash -c '${c}' >/dev/null 2>&1 && echo ALLOWED-${k} || echo DENIED-${k}`).join('; ')}`, { image: HOST });
    expect(r.out).toContain('read-ok');
    for (const [k] of ops) { expect(r.out, k).toContain(`DENIED-${k}`); expect(r.out, k).not.toContain(`ALLOWED-${k}`); }
  });
  it('RED ON THE FAULT: today\'s `rwx` default ACL lets 10005 write a published file (what C3 forbids), shown on the same filesystem', () => {
    const r = run(`setfacl -d -m u:10005:rwx /srv/polycarpic/spool/dump; setpriv --reuid=10004 --regid=10004 --clear-groups python3 -c 'import os,sys; os.close(os.open(sys.argv[1], os.O_CREAT|os.O_WRONLY, 0o666))' /srv/polycarpic/spool/dump/d.age; setfacl -m u:10005:rwx /srv/polycarpic/spool/dump; setpriv --reuid=10005 --regid=10005 --clear-groups bash -c 'echo x >> /srv/polycarpic/spool/dump/d.age && echo write-ok'`, { image: HOST });
    expect(r.out).toContain('write-ok');
  });
});

describe('R10 the host stage: units, records, endpoint, heartbeat_url', () => {
  it('installs exactly the four unit files into /etc/systemd/system/, equal to the bundle\'s, runs daemon-reload, and enables nothing', () => {
    const r = run(`for u in ${UNITS.join(' ')}; do cmp /repo/infra/backup/systemd/$u /etc/systemd/system/$u && echo same-$u; done; grep -E '^systemctl ' /var/fake-state/calls.log`, { image: HOST });
    for (const u of UNITS) expect(r.out, u).toContain(`same-${u}`);
    expect(r.out).toMatch(/^systemctl daemon-reload$/m);
    expect(r.out).not.toMatch(/^systemctl (enable|start|restart|reenable).*polycarpic-(backup|uploader)/m);
  });
  it('the unit files say what R5 says', () => {
    const b = read('infra/backup/systemd/polycarpic-backup.service'), bt = read('infra/backup/systemd/polycarpic-backup.timer');
    const u = read('infra/backup/systemd/polycarpic-uploader.service'), ut = read('infra/backup/systemd/polycarpic-uploader.timer');
    expect(b).toMatch(/^Type=oneshot$/m);
    expect(b).toMatch(/^ExecStart=\/usr\/local\/sbin\/polycarpic-ops backup nightly$/m);
    expect(b).toMatch(/^TimeoutStartSec=4h$/m);
    expect(bt).toMatch(/^OnCalendar=\*-\*-\* 02:15:00 UTC$/m);
    expect(bt).toMatch(/^Persistent=true$/m);
    expect(u).toMatch(/^Type=oneshot$/m);
    expect(u).toMatch(/^ExecStart=\/usr\/local\/sbin\/polycarpic-ops upload$/m);
    expect(ut).toMatch(/^OnCalendar=minutely$/m);
  });
  it('jobs.log and last-upload are root:root 0644 (an existing one owned by 10004 is chowned), spool.sha256 exists root 0644, an empty last-dump is removed with a `change:` line', () => {
    const r = run(`touch /var/lib/polycarpic/state/jobs.log /var/lib/polycarpic/state/last-upload /var/lib/polycarpic/state/last-dump; chown 10004:10004 /var/lib/polycarpic/state/jobs.log /var/lib/polycarpic/state/last-upload; chmod 0664 /var/lib/polycarpic/state/last-upload; rm -f /var/lib/polycarpic/state/spool.sha256; ${HOSTRUN} > /tmp/o 2>&1; echo "rc=$?"; stat -c '%n %u:%g %a' /var/lib/polycarpic/state/jobs.log /var/lib/polycarpic/state/last-upload /var/lib/polycarpic/state/spool.sha256; ls /var/lib/polycarpic/state/last-dump 2>&1; grep '^change:' /tmp/o`, { image: HOST });
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toContain('/var/lib/polycarpic/state/jobs.log 0:0 644');
    expect(r.out).toContain('/var/lib/polycarpic/state/last-upload 0:0 644');
    expect(r.out).toContain('/var/lib/polycarpic/state/spool.sha256 0:0 644');
    expect(r.out).toMatch(/No such file/);
    expect(r.out).toMatch(/^change: .*last-dump/m);
  });
  it('--b2-endpoint <url> writes B2_S3_ENDPOINT=<url> into ops.conf (0644) once; a bad value exits non-zero and writes nothing', () => {
    const EP = 'https://s3.eu-central-003.backblazeb2.com';
    const r = run(`rm -f /etc/polycarpic/ops.conf; ${HOSTRUN} --b2-endpoint ${EP} > /tmp/o1 2>&1; echo "rc=$?"; cat /etc/polycarpic/ops.conf; stat -c '%a %U' /etc/polycarpic/ops.conf; ${HOSTRUN} --b2-endpoint ${EP} > /tmp/o2 2>&1; grep -c '^change: .*ops.conf' /tmp/o2 || true`, { image: HOST });
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toContain(`B2_S3_ENDPOINT=${EP}`);
    expect(r.out).toContain('644 root');
    expect(r.out.trim().split('\n').pop()).toBe('0');
    for (const bad of ['http://s3.eu-central-003.backblazeb2.com', 'https://s3.eu-central-003.backblazeb2.com/x', 'https://evil.example', 'https://s3.EU.backblazeb2.com']) {
      const b = run(`rm -f /etc/polycarpic/ops.conf; ${HOSTRUN} --b2-endpoint '${bad}' > /tmp/o 2>&1; echo "rc=$?"; ls /etc/polycarpic/ops.conf 2>&1`, { image: HOST });
      expect(b.out, bad).not.toMatch(/rc=0/);
      expect(b.out, bad).toMatch(/No such file/);
    }
  });
  it('H-1: a heartbeat_url left under uploader/ is moved to secrets/host/ (root:root 0400, dir root:root 0700), keeps its value, is never printed, and a `change:` line says so', () => {
    const v = 'https://hc-ping.example/' + 'ab12cd34-0000-4000-8000-000000000042';
    const r = run(`rm -rf /etc/polycarpic/secrets/host; install -d -m 0750 -o root -g 10005 /etc/polycarpic/secrets/uploader; echo ${v} > /etc/polycarpic/secrets/uploader/heartbeat_url; chown root:10005 /etc/polycarpic/secrets/uploader/heartbeat_url; chmod 0440 /etc/polycarpic/secrets/uploader/heartbeat_url; ${HOSTRUN} > /tmp/o 2>&1; echo "rc=$?"; stat -c '%n %U:%G %a' /etc/polycarpic/secrets/host /etc/polycarpic/secrets/host/heartbeat_url; cat /etc/polycarpic/secrets/host/heartbeat_url; ls /etc/polycarpic/secrets/uploader/heartbeat_url 2>&1; grep -c '${v}' /tmp/o; grep '^change:' /tmp/o | grep -i heartbeat`, { image: HOST });
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toContain('/etc/polycarpic/secrets/host root:root 700');
    expect(r.out).toContain('/etc/polycarpic/secrets/host/heartbeat_url root:root 400');
    expect(r.out).toContain(v);
    expect(r.out).toMatch(/No such file/);
    expect(r.out).toMatch(/^0$/m); // the value appears in none of provision.sh's output
    expect(r.out).toMatch(/^change: .*heartbeat_url/m);
  });
});

describe('R10 provision-check: H6, H7, H8, H16, and H-1', () => {
  it('the complete box passes every check, H16 included', () => {
    const r = check('');
    for (const id of ['H6', 'H7', 'H8', 'H16']) expect(find(r.out, 'PASS', id), `PASS ${id}\n${r.out.slice(-1200)}`).toBeDefined();
  });
  it('H6: ops.conf may hold B2_BUCKET= and B2_S3_ENDPOINT= and nothing else', () => {
    const two = 'printf "B2_BUCKET=polycarpic-hetzner-backups\\nB2_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com\\n" > /etc/polycarpic/ops.conf; chmod 0644 /etc/polycarpic/ops.conf';
    expect(find(check(two).out, 'PASS', 'H6')).toBeDefined();
    failLine(check(`${two}; echo 'B2_EXTRA=1' >> /etc/polycarpic/ops.conf`), 'H6', ['ops.conf']);
    failLine(check(`${two}; sed -i 's#https://#http://#' /etc/polycarpic/ops.conf`), 'H6', ['ops.conf']);
    failLine(check(`${two}; sed -i 's#backblazeb2.com#backblazeb2.com.evil.example#' /etc/polycarpic/ops.conf`), 'H6', ['ops.conf']);
  });
  it('H6 (H-1): heartbeat_url must be root:root 0400 under host/; root:10005 0440, or a file under uploader/, fails; a missing host/ dir mode is caught', () => {
    expect(find(check('').out, 'PASS', 'H6')).toBeDefined();
    failLine(check('chown root:10005 /etc/polycarpic/secrets/host/heartbeat_url; chmod 0440 /etc/polycarpic/secrets/host/heartbeat_url'), 'H6', ['heartbeat_url']);
    failLine(check('chmod 0440 /etc/polycarpic/secrets/host/heartbeat_url'), 'H6', ['heartbeat_url']);
    failLine(check('mv /etc/polycarpic/secrets/host/heartbeat_url /etc/polycarpic/secrets/uploader/heartbeat_url; chown root:10005 /etc/polycarpic/secrets/uploader/heartbeat_url; chmod 0440 /etc/polycarpic/secrets/uploader/heartbeat_url'), 'H6', ['heartbeat_url']);
    failLine(check('chmod 0755 /etc/polycarpic/secrets/host'), 'H6', ['host']);
  });
  it('H6 (H-1): a host-only constant that differs between infra/ops/lib/secrets.py and provision-check.sh is caught by a unit test, not at run time: the two copies are equal', () => {
    const py = /HOST_ONLY = (\{[^}]*\})/.exec(read('infra/ops/lib/secrets.py'))![1]!;
    const sh = /^HOST_ONLY="([^"]*)"/m.exec(read('infra/provision-check.sh'))![1]!;
    const fromPy = [...py.matchAll(/"([a-z_]+)":\s*"([a-z]+)"/g)].map((m) => `${m[1]}=${m[2]}`).sort();
    expect(fromPy.length).toBeGreaterThan(0);
    expect(sh.split(/\s+/).filter(Boolean).sort()).toEqual(fromPy);
  });
  it('H7 (C3): a 10005 access entry on .inflight/, or an `rwx` default ACL on a spool dir, fails naming the path', () => {
    failLine(check('setfacl -m u:10005:r-- /srv/polycarpic/spool/dump/.inflight'), 'H7', ['.inflight']);
    failLine(check('setfacl -d -m u:10005:rwx /srv/polycarpic/spool/dump'), 'H7', ['spool/dump']);
    failLine(check('setfacl -m u:10005:rwx /srv/polycarpic/spool/premigration'), 'H7', ['premigration']);
    failLine(check('setfacl -d -x u:10005 /srv/polycarpic/spool/premigration/.inflight'), 'H7', ['premigration']);
    failLine(check('rmdir /srv/polycarpic/spool/wal/.inflight'), 'H7', ['.inflight']);
  });
  it('H8: an inflight file older than 10 minutes in dump/.inflight or premigration/.inflight fails; a .sha256 is admitted in premigration/ only; a stray name still fails', () => {
    failLine(check('touch -d "30 minutes ago" /srv/polycarpic/spool/dump/.inflight/x.1'), 'H8', ['inflight']);
    failLine(check('touch -d "30 minutes ago" /srv/polycarpic/spool/premigration/.inflight/x.1'), 'H8', ['inflight']);
    expect(find(check('touch /srv/polycarpic/spool/dump/.inflight/fresh.1').out, 'PASS', 'H8')).toBeDefined();
    expect(find(check('touch /srv/polycarpic/spool/premigration/dump-17-1-20261122T021500Z.age.sha256').out, 'PASS', 'H8')).toBeDefined();
    failLine(check('touch /srv/polycarpic/spool/dump/dump-17-1-20261122T021500Z.age.sha256'), 'H8', ['sha256']);
    failLine(check('touch /srv/polycarpic/spool/dump/notes.txt'), 'H8', ['notes.txt']);
  });
  it('H16: each of the four unit files must equal the bundle copy; a changed, missing or extra-permission one fails naming it; enablement is not checked', () => {
    for (const u of UNITS) failLine(check(`echo '# tampered' >> /etc/systemd/system/${u}`), 'H16', [u]);
    failLine(check(`rm /etc/systemd/system/${UNITS[0]}`), 'H16', [UNITS[0]!]);
    failLine(check(`chmod 0666 /etc/systemd/system/${UNITS[2]}`), 'H16', [UNITS[2]!]);
  });
  it('the COMPLETE snapshot of this suite is the one box.ts makes (host-only heartbeat); H13 passes with it', () => {
    expect(find(check('').out, 'PASS', 'H13')).toBeDefined();
    expect(COMPLETE).toBe('complete');
  });
});
