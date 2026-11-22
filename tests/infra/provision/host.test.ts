// POLY-97 R4, R5 (host stage), R6 H1–H15, R10: infra/provision.sh --stage host and infra/provision-check.sh in the dry-run box.
// Real: users, ownership, modes, ACLs, file generation, `sshd -T`. Faked: volume, packages, services, Docker, Backblaze (tests/infra/provision/fakes).
// Every planted-fault test names the check id, the found value and the `— fix:` clause (R4's output contract).
// Database checks (D1–D6) and the summary lines that need a running Postgres are in provision-db.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPS, BUCKET, COMPLETE, FX, HOST, HOST_ARGS, ROOT, CHECK, b2Fixture, build, check, failLine, find, last, lines, makeComplete, makeHost, run } from './box.ts';

const ENTER = `ssh-keygen -q -t ed25519 -N '' -f /root/k; sed "s|__SSH_PUBLIC_KEY__|$(cat /root/k.pub)|" /repo/infra/hetzner/cloud-init.yaml > /tmp/ci.yaml; python3 /harness/apply-cloud-init.py /tmp/ci.yaml;`;
const HOSTRUN = `bash /repo/infra/provision.sh ${HOST_ARGS}`;
const rc = '; echo "rc=$?"';

// A failed setup fails every test with its own message (not "skipped"), so the red run counts each test.
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

describe('provision.sh host stage (R5)', () => {
  it('a second run changes nothing and says so per stage; files, modes and mtimes are identical and no volume verb is called', () => {
    const snap = `find /etc/polycarpic /etc/docker /etc/crypttab /etc/fstab /srv /var/lib/polycarpic -printf '%p %m %u:%g %s %T@\\n' | sort | sha256sum`;
    const r = run(`${ENTER} ${HOSTRUN} >/dev/null 2>&1; ${snap}; : > /var/fake-state/calls.log; ${HOSTRUN} > /tmp/second.out 2>&1; echo "rc=$?"; cat /tmp/second.out; ${snap}; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^(cryptsetup luksFormat|mkfs)'`);
    const [pre, , ...rest] = r.out.trim().split('\n');
    const post = rest[rest.length - 2];
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/no changes/i);
    expect(r.out).not.toMatch(/^change: /m);
    expect(post).toBe(pre);
    expect(rest[rest.length - 1]).toBe('0');
  });

  it('installs Docker Engine and the compose plugin from Docker\'s apt repository, only after the key fingerprint matches the pinned one', () => {
    const src = readFileSync(join(ROOT, 'infra', 'provision.sh'), 'utf8');
    expect(src).toContain('9DC858229FC7DD38854AE2D88D81803C0EBFCD88'); // Docker's published release-key fingerprint, pinned in the script
    const r = run(`${ENTER} ${HOSTRUN}; grep -E '^apt-get .*install' /var/fake-state/calls.log`);
    expect(r.out).toMatch(/docker-ce/);
    expect(r.out).toMatch(/docker-compose-plugin/);
  });

  it('refuses a Docker key whose fingerprint differs: exit non-zero, says fingerprint, installs no docker package', () => {
    const r = run(`${ENTER} echo 0000000000000000000000000000000000000000 > /var/fake-state/docker-key-fpr; ${HOSTRUN} 2>&1${rc}; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^apt-get .*install.*docker-ce' || true`);
    expect(r.out).not.toMatch(/rc=0/);
    expect(r.out).toMatch(/fingerprint/i);
    expect(r.out.trim().split('\n').pop()).toBe('0');
  });

  it('writes /etc/docker/daemon.json with the R5 values', () => {
    const r = run('cat /etc/docker/daemon.json', { image: HOST });
    expect(JSON.parse(r.out)).toMatchObject({
      'live-restore': true, 'log-driver': 'json-file', 'log-opts': { 'max-size': '10m', 'max-file': '5' },
      'default-address-pools': [{ base: '10.200.0.0/16', size: 24 }], 'userland-proxy': false,
    });
  });

  it('turns on unattended upgrades with automatic reboot, and swap is off and absent from fstab', () => {
    const r = run(`apt-config dump | grep -E 'Unattended-Upgrade|Periodic'; echo ====; grep -c swap /etc/fstab || true`, { image: HOST });
    expect(r.out).toMatch(/APT::Periodic::Unattended-Upgrade "1"/);
    expect(r.out).toMatch(/Unattended-Upgrade::Automatic-Reboot "true"/);
    expect(r.out.split('====')[1]!.trim()).toBe('0');
  });

  it('formats the data volume LUKS2 with a random root-0400 key file, opens it as polycarpic-data, mounts /srv/polycarpic via crypttab and fstab', () => {
    const r = run(`stat -c '%a %U:%G %s' /etc/polycarpic/luks.key; grep -E 'luksFormat|luksOpen|open' /var/fake-state/calls.log; cat /etc/crypttab; cat /etc/fstab; cat /var/fake-state/mounted-src; cat /var/fake-state/volume`, { image: HOST });
    expect(r.out).toMatch(/^400 root:root \d+/m);
    expect(Number(r.out.match(/^400 root:root (\d+)/m)![1])).toBeGreaterThanOrEqual(32); // a random key, not an empty file
    expect(r.out).toMatch(/cryptsetup luksFormat .*(--type luks2|--type=luks2)/);
    expect(r.out).toMatch(/cryptsetup (luksOpen|open) .*polycarpic-data/);
    expect(r.out).toMatch(/^polycarpic-data\s+\S+\s+\/etc\/polycarpic\/luks\.key/m);
    expect(r.out).toMatch(/\/dev\/mapper\/polycarpic-data\s+\/srv\/polycarpic\s+ext4/);
    expect(r.out).toMatch(/\/dev\/mapper\/polycarpic-data\n/);
  });

  it('an existing LUKS header is opened, never reformatted', () => {
    const r = run(`${ENTER} echo luks > /var/fake-state/volume; ${HOSTRUN}${rc}; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^cryptsetup luksFormat' || true; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^cryptsetup (luksOpen|open)'`);
    expect(r.out).toMatch(/rc=0/);
    const [fmt, open] = r.out.trim().split('\n').slice(-2);
    expect(fmt).toBe('0');
    expect(Number(open)).toBeGreaterThanOrEqual(1);
  });

  it('a non-empty volume without a LUKS header stops the script (exit 1) and writes nothing', () => {
    const r = run(`${ENTER} echo foreign > /var/fake-state/volume; ${HOSTRUN} 2>&1${rc}; ls /etc/polycarpic/luks.key /srv/polycarpic/pg-prod 2>&1 | grep -c 'No such'; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^cryptsetup luksFormat' || true`);
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/LUKS|volume/i);
    const [nosuch, fmt] = r.out.trim().split('\n').slice(-2);
    expect(nosuch).toBe('2');
    expect(fmt).toBe('0');
  });

  it('5a: a second device matching the volume glob stops the stage (exit 1), names both matches, writes nothing', () => {
    const r = run(`${ENTER} : > /dev/disk/by-id/scsi-0HC_Volume_100000002; ${HOSTRUN} 2>&1${rc}; ls /etc/polycarpic/luks.key 2>&1 | grep -c 'No such'`);
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toContain('scsi-0HC_Volume_100000001');
    expect(r.out).toContain('scsi-0HC_Volume_100000002');
    expect(r.out.trim().split('\n').pop()).toBe('1');
  });

  it('5a: no device matching the glob stops the stage too (exit 1, nothing written)', () => {
    const r = run(`${ENTER} rm -f /dev/disk/by-id/scsi-0HC_Volume_*; ${HOSTRUN} 2>&1${rc}; ls /etc/polycarpic/luks.key 2>&1 | grep -c 'No such'`);
    expect(r.out).toMatch(/rc=1/);
    expect(r.out.trim().split('\n').pop()).toBe('1');
  });

  it('5b: wipefs is only ever called with --no-act (the fake refuses any other call), on an empty, a LUKS and a foreign volume', () => {
    for (const vol of ['empty', 'luks', 'foreign']) {
      const r = run(`${ENTER} echo ${vol} > /var/fake-state/volume; ${HOSTRUN} >/dev/null 2>&1; cat /var/fake-state/calls.log | grep '^wipefs' | grep -vcE -- '--no-act| -n( |$)' || true`);
      expect(r.out.trim().split('\n').pop(), vol).toBe('0');
    }
  });

  it('5b: the fake refuses luksFormat on a volume that is already LUKS, so "never reformatted" is tested (stage still exits 0 by opening it)', () => {
    const r = run(`echo luks > /var/fake-state/volume; cryptsetup luksFormat /dev/x; echo "rc=$?"`);
    expect(r.out).toMatch(/rc=5/);
  });

  it('data dirs and the spool have the R5 owners and modes, and the exact ACL entries', () => {
    const r = run(`for d in pg-prod pg-staging spool/wal spool/dump spool/premigration; do stat -c "$d %a %u:%g" /srv/polycarpic/$d; done; for d in spool/wal spool/dump spool/premigration; do echo "== $d"; getfacl -cp /srv/polycarpic/$d | grep -v '^$'; done`, { image: HOST });
    expect(r.out).toMatch(/^pg-prod 700 999:999$/m);
    expect(r.out).toMatch(/^pg-staging 700 999:999$/m);
    // `stat %a` shows the ACL mask in the group position (setfacl -m u:10005:rwx makes it rwx), so the 0700 of R5 is the base entries below.
    expect(r.out).toMatch(/^spool\/wal \d+ 999:999$/m);
    expect(r.out).toMatch(/^spool\/dump \d+ 10004:10004$/m);
    expect(r.out).toMatch(/^spool\/premigration \d+ 10004:10004$/m);
    for (const sec of r.out.split('== ').slice(1)) {
      expect(sec).toMatch(/^user::rwx$/m);
      expect(sec).toMatch(/^group::---$/m);
      expect(sec).toMatch(/^other::---$/m);
      expect(sec).toMatch(/^user:10005:rwx$/m);
      expect(sec).toMatch(/^default:user::rwx$/m);
      expect(sec).toMatch(/^default:group::---$/m);
      expect(sec).toMatch(/^default:other::---$/m);
      expect(sec).toMatch(/^default:user:10005:rwx$/m);
      expect(sec).not.toMatch(/^group:\d+:/m); // never a shared gid
    }
  });

  it('M1: files written by 999 (WAL) and 10004 (dump) under umask 077 stay readable, siblingable and deletable by 10005; a chmod 0600 removes the read', () => {
    const as = (uid: number, cmd: string) => `setpriv --reuid=${uid} --regid=${uid} --clear-groups bash -c '${cmd}'`;
    const r = run([
      as(999, 'umask 077; echo wal > /srv/polycarpic/spool/wal/0001.age'),
      as(10004, 'umask 077; echo dump > /srv/polycarpic/spool/dump/a.age'),
      as(10004, 'umask 077; echo dump > /srv/polycarpic/spool/dump/b.age; chmod 0600 /srv/polycarpic/spool/dump/b.age'),
      as(10005, 'cat /srv/polycarpic/spool/wal/0001.age && echo WALREAD'),
      as(10005, 'cat /srv/polycarpic/spool/dump/a.age && echo DUMPREAD'),
      as(10005, 'echo h > /srv/polycarpic/spool/wal/0001.age.sha256 && echo SIBLING'),
      as(10005, 'rm /srv/polycarpic/spool/wal/0001.age && echo WALRM'),
      as(10005, 'cat /srv/polycarpic/spool/dump/b.age 2>&1 | grep -c "Permission denied" || true'),
    ].join('\n'), { image: HOST });
    for (const t of ['WALREAD', 'DUMPREAD', 'SIBLING', 'WALRM']) expect(r.out, t).toContain(t);
    expect(r.out.trim().split('\n').pop()).toBe('1');
  });

  it('state: /var/lib/polycarpic/state root 0755; last-upload owned 10005, last-dump and jobs.log owned 10004, 0644, created empty', () => {
    const r = run(`stat -c '%n %a %u:%g %s' /var/lib/polycarpic/state /var/lib/polycarpic/state/*`, { image: HOST });
    expect(r.out).toMatch(/^\/var\/lib\/polycarpic\/state 755 0:0/m);
    expect(r.out).toMatch(/last-upload 644 10005:\d+ 0$/m);
    expect(r.out).toMatch(/last-dump 644 10004:\d+ 0$/m);
    expect(r.out).toMatch(/jobs\.log 644 10004:\d+ 0$/m);
  });

  const GIDS: Record<string, number> = { postgres: 999, web: 10001, worker: 10002, migrate: 10003, backup: 10004, uploader: 10005, operator: 10006, auth: 10007, caddy: 10010 };
  const PROD_GEN = ['postgres/db_superuser_password', 'web/db_password_app', 'auth/db_password_auth', 'auth/auth_secret', 'worker/db_password_worker', 'migrate/db_password_migrator', 'operator/db_password_operator', 'backup/db_password_backup'];
  const STAGING_GEN = ['postgres/db_superuser_password', 'web/db_password_app', 'auth/db_password_auth', 'auth/auth_secret', 'worker/db_password_worker', 'migrate/db_password_migrator', 'operator/db_password_operator'];

  it('secrets: both roots 0700; one dir per service root:<gid> 0750; the generated files 0440 root:<gid>; staging has six services and no backup or uploader dir', () => {
    const r = run(`stat -c '%n %a %U:%g' /etc/polycarpic/secrets /etc/polycarpic/staging-secrets /etc/polycarpic/secrets/* /etc/polycarpic/staging-secrets/*`, { image: HOST });
    expect(r.out).toMatch(/^\/etc\/polycarpic\/secrets 700 root:0$/m);
    expect(r.out).toMatch(/^\/etc\/polycarpic\/staging-secrets 700 root:0$/m);
    for (const [svc, gid] of Object.entries(GIDS)) expect(r.out, `prod ${svc}`).toContain(`/etc/polycarpic/secrets/${svc} 750 root:${gid}`);
    const staging = r.out.split('\n').filter((l) => /^\/etc\/polycarpic\/staging-secrets\/\w+ /.test(l));
    expect(staging.map((l) => l.split(' ')[0]!.split('/').pop()).sort()).toEqual(['auth', 'migrate', 'operator', 'postgres', 'web', 'worker']);
    for (const l of staging) expect(l).toMatch(/ 750 root:\d+$/);
    for (const [root, set] of [['secrets', PROD_GEN], ['staging-secrets', STAGING_GEN]] as const) {
      const f = run(`cd /etc/polycarpic/${root}; stat -c '%n %a %U:%g' */*; find . -type f | wc -l`, { image: HOST });
      for (const p of set) expect(f.out, `${root}/${p}`).toContain(`${p} 440 root:${GIDS[p.split('/')[0]!]}`);
      expect(Number(f.out.trim().split('\n').pop())).toBe(set.length);
    }
  });

  it('generated secrets are 32 random bytes in base64, all distinct (prod and staging), never overwritten, and a planted file is kept', () => {
    const r = run(`cd /etc/polycarpic; for f in secrets/*/* staging-secrets/*/*; do printf '%s %s\\n' "$f" "$(tr -d '\\n' < $f | wc -c)"; done; cat secrets/*/* staging-secrets/*/* | sort | uniq -d | wc -l; cat secrets/*/* staging-secrets/*/* | sha256sum`, { image: HOST });
    for (const l of r.out.split('\n').filter((x) => /^(secrets|staging-secrets)\//.test(x))) expect(l, l).toMatch(/ 44$/);
    const tail = r.out.trim().split('\n');
    expect(tail[tail.length - 2]).toBe('0'); // no two files hold equal content
    const again = run(`cd /etc/polycarpic; echo KEEPME > secrets/web/db_password_app; ${HOSTRUN} >/dev/null 2>&1; cat secrets/web/db_password_app; cat secrets/*/* staging-secrets/*/* | sha256sum`, { image: HOST });
    expect(again.out.split('\n')[0]).toBe('KEEPME');
    const same = run(`cd /etc/polycarpic; cat secrets/*/* staging-secrets/*/* | sha256sum; ${HOSTRUN} >/dev/null 2>&1; cat secrets/*/* staging-secrets/*/* | sha256sum`, { image: HOST });
    const [a, b] = same.out.trim().split('\n');
    expect(b).toBe(a);
  });

  it('the generated set equals the compose `file:` paths minus the ones set later (compose stays the single source)', () => {
    const files = (f: string) => Object.values((parse(readFileSync(join(ROOT, 'infra', 'compose', f), 'utf8')) as any).secrets ?? {}).map((s: any) => s.file as string);
    const compose = [...files('prod.yml'), ...files('staging.yml'), ...files('edge.yml')].map((p) => p.replace('/etc/polycarpic/', ''));
    const generated = [...PROD_GEN.map((p) => `secrets/${p}`), ...STAGING_GEN.map((p) => `staging-secrets/${p}`)];
    for (const g of generated) expect(compose, `generated ${g} is not a compose file: path`).toContain(g);
    const later = ['web/plaid_secret', 'auth/resend_api_key', 'worker/resend_api_key', 'worker/credential_keyring', 'uploader/backup_store_credential', 'uploader/heartbeat_url', 'caddy/staging_basic_auth'];
    const rest = compose.filter((p) => !generated.includes(p));
    expect(rest.map((p) => p.replace(/^(staging-)?secrets\//, '')).filter((p) => !later.includes(p))).toEqual([]); // a new compose secret must be generated or named here
    const r = run(`ls /etc/polycarpic/secrets/*/ /etc/polycarpic/staging-secrets/*/ | grep -c .`, { image: HOST });
    expect(Number(r.out.trim())).toBeGreaterThan(0);
  });

  it('host.env and staging-host.env: root 0644, TLS_MODE, PUBLIC_ORIGIN per project, MAIL_FROM default under mail.<domain>, POLY_INSTANCE, nothing else', () => {
    const r = run(`stat -c '%n %a %U' /etc/polycarpic/host.env /etc/polycarpic/staging-host.env; echo ==; cat /etc/polycarpic/host.env; echo ==; cat /etc/polycarpic/staging-host.env`, { image: HOST });
    const [st, prod, stg] = r.out.split('==').map((x) => x.trim());
    expect(st).toMatch(/host\.env 644 root/);
    const kv = (t: string) => Object.fromEntries(t.split('\n').filter(Boolean).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"(.*)"$/, '$1')]));
    const p = kv(prod!), s = kv(stg!);
    expect(Object.keys(p).sort()).toEqual(['MAIL_FROM', 'POLY_INSTANCE', 'PUBLIC_ORIGIN', 'TLS_MODE']);
    expect(Object.keys(s).sort()).toEqual(['MAIL_FROM', 'POLY_INSTANCE', 'PUBLIC_ORIGIN', 'TLS_MODE']);
    expect(p.TLS_MODE).toBe('real-domain');
    expect(p.PUBLIC_ORIGIN).toBe('https://app.polycarpic.com');
    expect(s.PUBLIC_ORIGIN).toBe('https://staging.polycarpic.com');
    expect(p.MAIL_FROM).toBe('Polycarpic <no-reply@mail.polycarpic.com>');
    expect(p.POLY_INSTANCE).toBeTruthy();
    expect(s.POLY_INSTANCE).not.toBe(p.POLY_INSTANCE);
  });

  it('--mail-from under mail.<domain> is accepted; one elsewhere is refused (exit non-zero, names mail.<domain>) and nothing is written', () => {
    const ok = run(`${ENTER} ${HOSTRUN} --mail-from "Polycarpic <hello@mail.polycarpic.com>" >/dev/null 2>&1; grep MAIL_FROM /etc/polycarpic/host.env`);
    expect(ok.out).toContain('hello@mail.polycarpic.com');
    const bad = run(`${ENTER} ${HOSTRUN} --mail-from "evil@polycarpic.com" 2>&1${rc}; ls /etc/polycarpic/host.env 2>&1 | grep -c 'No such'; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^cryptsetup luksFormat' || true`);
    expect(bad.out).not.toMatch(/rc=0/);
    expect(bad.out).toMatch(/mail\.polycarpic\.com/);
    const [nosuch, fmt] = bad.out.trim().split('\n').slice(-2);
    expect(nosuch).toBe('1');
    expect(fmt).toBe('0'); // refused before anything is changed
  });

  it('host.env is rewritten only when a value differs', () => {
    const r = run(`cd /etc/polycarpic; stat -c %Y staging-host.env > /tmp/m1; sed -i 's/^TLS_MODE=.*/TLS_MODE=wrong/' host.env; sleep 1.1; ${HOSTRUN} >/dev/null 2>&1; grep ^TLS_MODE host.env; stat -c %Y staging-host.env | diff - /tmp/m1 && echo UNTOUCHED`, { image: HOST });
    expect(r.out).toMatch(/TLS_MODE=real-domain/);
    expect(r.out).toContain('UNTOUCHED');
  });

  it('no host account other than root has a service gid; polyops is not in the docker group', () => {
    const r = run(`getent passwd | awk -F: '$1!="root"{print $1, $4}' | awk '{ if ($2==999 || $2>=10001 && $2<=10010) print "BAD", $0 }'; id -nG polyops`, { image: HOST });
    expect(r.out).not.toMatch(/BAD/);
    expect(r.out).not.toMatch(/\bdocker\b/);
  });

  it('R10: no generated secret appears in the stage output, the fakes\' argv log, /var/log or any file outside its own path', () => {
    const r = run(`${ENTER} ${HOSTRUN} > /tmp/o 2>&1; cat /etc/polycarpic/secrets/*/* /etc/polycarpic/staging-secrets/*/* > /dev/shm/values; grep -rlF -f /dev/shm/values /etc /var /srv /home /root /tmp /opt --exclude-dir=secrets --exclude-dir=staging-secrets 2>/dev/null; echo done`);
    expect(r.out.trim()).toBe('done');
  });
});

describe('provision-check: positive case and the R4 output contract', () => {
  it('a complete host box: PASS for every H check, INFO H12b (never a pass), WAIT for D1–D6, the HOST CHECKS PASSED summary, exit 3', () => {
    const rr = run(`${b2Fixture({})}\n bash /repo/infra/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}; echo "rc=$?"`, { image: COMPLETE });
    expect(rr.out).toMatch(/rc=3/);
    for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H14', 'H15']) expect(find(rr.out, 'PASS', id), `PASS ${id}`).toBeDefined();
    expect(find(rr.out, 'INFO', 'H12b')?.text).toMatch(/bucket lock: checked off-box by b2-setup\.py/);
    expect(lines(rr.out).some((l) => l.kind === 'PASS' && l.id === 'H12b')).toBe(false);
    const waits = lines(rr.out).filter((l) => l.kind === 'WAIT').map((l) => l.id).sort();
    expect(waits).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    expect(lines(rr.out).some((l) => l.kind === 'FAIL')).toBe(false);
    expect(rr.out.split('\n').filter((l) => /rc=/.test(l) === false && l.trim()).pop()).toBe('HOST CHECKS PASSED; 6 checks wait for the first deploy');
  });

  it('is read-only: no file under /etc, /srv or /var/lib/polycarpic changes, and no mutating fake verb is called', () => {
    const snap = `find /etc /srv /var/lib/polycarpic -printf '%p %m %u:%g %s %T@\\n' | sort | sha256sum`;
    const r = run(`${b2Fixture({})}\n${snap}; : > /var/fake-state/calls.log; ${CHECK} >/dev/null 2>&1; ${snap}; cat /var/fake-state/calls.log 2>/dev/null | grep -cE '^(apt-get|mkfs|swapoff|umount|mount|cryptsetup (luksFormat|open|luksOpen|close))' || true`, { image: COMPLETE });
    const [a, b, n] = r.out.trim().split('\n');
    expect(b).toBe(a);
    expect(n).toBe('0');
  });

  it('every FAIL line is "FAIL <id> <what>: <found> — fix: <step>"; the failing summary counts the FAILs and exits 1', () => {
    const r = run(`${b2Fixture({})}\necho no > /var/fake-state/ntp; touch /var/fake-state/swap-active; ${CHECK}${rc}`, { image: COMPLETE });
    const fails = lines(r.out).filter((l) => l.kind === 'FAIL');
    expect(fails.map((l) => l.id).sort()).toEqual(['H14', 'H5']);
    for (const f of fails) expect(f.text).toMatch(/: .+ — fix: \S/);
    expect(r.out).toMatch(/rc=1/);
    expect(r.out).toMatch(/^2 CHECKS FAILED$/m);
    expect(r.out).not.toMatch(/ALL CHECKS PASSED|HOST CHECKS PASSED/);
  });

  it('the first summary-rule case: a FAIL beats a WAIT (never "HOST CHECKS PASSED" with a FAIL)', () => {
    const r = run(`${b2Fixture({})}\necho no > /var/fake-state/ntp; ${CHECK}`, { image: COMPLETE });
    expect(last(r.out)).toMatch(/^1 CHECKS FAILED$/);
  });
});

const plantAppend = (file: string, text: string) => `printf '%s\\n' '${text}' >> ${file}`;

describe('provision-check: one planted fault per check, with id, found value and fix (R6)', () => {
  it('H1: the running sshd config allows passwords (a drop-in sorted first wins)', () => {
    const r = check(`${plantAppend('/etc/ssh/sshd_config.d/00-evil.conf', 'PasswordAuthentication yes')}`);
    failLine(r, 'H1', ['passwordauthentication']);
  });
  it('H1: forwarding left on is caught from the running config', () => {
    const r = check(`${plantAppend('/etc/ssh/sshd_config.d/00-evil.conf', 'AllowTcpForwarding yes')}`);
    failLine(r, 'H1', ['allowtcpforwarding']);
  });
  it('H2: unattended upgrades disabled', () => {
    const r = check(`sed -i 's/"1"/"0"/' /etc/apt/apt.conf.d/20auto-upgrades; grep -rl Unattended /etc/apt/apt.conf.d | xargs sed -i 's/Unattended-Upgrade "1"/Unattended-Upgrade "0"/'`);
    failLine(r, 'H2', ['unattended']);
  });
  it('H3: Docker\'s effective live-restore is off', () => {
    const r = check(`echo '{"LiveRestoreEnabled":false,"LoggingDriver":"json-file","DefaultAddressPools":[{"Base":"10.200.0.0/16","Size":24}]}' > /var/fake-state/docker-info.json`);
    failLine(r, 'H3', ['live']);
  });
  it('H3: an address pool overlapping 10.201.0.0/16 is refused', () => {
    const r = check(`echo '{"LiveRestoreEnabled":true,"LoggingDriver":"json-file","DefaultAddressPools":[{"Base":"10.201.0.0/16","Size":24}]}' > /var/fake-state/docker-info.json`);
    failLine(r, 'H3', ['10.201']);
  });
  it('H4: /srv/polycarpic mounted from a plain device', () => {
    const r = check('echo /dev/sdb > /var/fake-state/mounted-src');
    failLine(r, 'H4', ['/dev/sdb']);
  });
  it('H4: a LUKS1 header and a group-readable key file each fail', () => {
    failLine(check('echo 1 > /var/fake-state/luks-version'), 'H4', ['luks']);
    failLine(check('chmod 0440 /etc/polycarpic/luks.key'), 'H4', ['key']);
  });
  it('H5: active swap, and a swap line in fstab', () => {
    failLine(check('touch /var/fake-state/swap-active'), 'H5', ['swap']);
    failLine(check(plantAppend('/etc/fstab', '/swapfile none swap sw 0 0')), 'H5', ['fstab']);
  });
  it('H6: a world-readable secret; a secret in a dir compose does not mount it from; two files with equal content', () => {
    failLine(check('chmod 0444 /etc/polycarpic/secrets/web/db_password_app'), 'H6', ['db_password_app']);
    failLine(check('cp -p /etc/polycarpic/secrets/web/db_password_app /etc/polycarpic/secrets/worker/db_password_app'), 'H6', ['db_password_app']);
    failLine(check('cp -p /etc/polycarpic/secrets/web/db_password_app /etc/polycarpic/staging-secrets/web/db_password_app'), 'H6', ['same']);
    failLine(check('chmod 0644 /etc/polycarpic/luks.key'), 'H6', ['luks.key']);
  });
  it('H7: a spool file whose mask hides 10005 (the M1 chmod 0600) fails, naming the file', () => {
    const r = check(`setpriv --reuid=10004 --regid=10004 --clear-groups bash -c 'umask 077; echo x > /srv/polycarpic/spool/dump/d.age; chmod 0600 /srv/polycarpic/spool/dump/d.age'`);
    failLine(r, 'H7', ['d.age']);
  });
  it('H7: a wrong owner on a data dir, and a stripped default ACL, each fail', () => {
    failLine(check('chown 1234:1234 /srv/polycarpic/pg-prod'), 'H7', ['pg-prod']);
    failLine(check('setfacl -k /srv/polycarpic/spool/wal'), 'H7', ['spool/wal']);
  });
  it('H8: a stray file in the spool, and an inflight file older than 10 minutes', () => {
    failLine(check('echo x > /srv/polycarpic/spool/dump/notes.txt'), 'H8', ['notes.txt']);
    failLine(check('mkdir -p /srv/polycarpic/spool/wal/.inflight; touch -d "30 minutes ago" /srv/polycarpic/spool/wal/.inflight/seg1'), 'H8', ['inflight']);
  });
  it('H8 positive: a fresh inflight file is allowed', () => {
    const r = check('mkdir -p /srv/polycarpic/spool/wal/.inflight; touch /srv/polycarpic/spool/wal/.inflight/seg1');
    expect(find(r.out, 'PASS', 'H8')).toBeDefined();
  });
  it('H9: a host account gaining a service gid, and polyops in the docker group', () => {
    failLine(check('groupadd -g 10001 websvc; usermod -aG websvc polyops'), 'H9', ['polyops', '10001']);
    failLine(check('groupadd docker; usermod -aG docker polyops'), 'H9', ['docker']);
  });
  it('H10: MAIL_FROM outside mail.<domain>, and a secret-named key in host.env', () => {
    failLine(check(`sed -i 's/^MAIL_FROM=.*/MAIL_FROM=x@polycarpic.com/' /etc/polycarpic/host.env`), 'H10', ['mail_from']);
    failLine(check(plantAppend('/etc/polycarpic/host.env', 'RESEND_API_KEY=abc')), 'H10', ['resend_api_key']);
    failLine(check(plantAppend('/etc/polycarpic/staging-host.env', 'DB_PASSWORD=abc')), 'H10', ['db_password']);
  });
  it('H11: zero recipient lines, and two', () => {
    failLine(check(': > /etc/polycarpic/age-recipients.txt'), 'H11', ['age-recipients']);
    failLine(check('age-keygen 2>/dev/null | age-keygen -y >> /etc/polycarpic/age-recipients.txt'), 'H11', ['2']);
  });
  it('H14: NTP not synchronised', () => {
    failLine(check('echo no > /var/fake-state/ntp'), 'H14', ['ntp']);
  });
});

describe('H14 waits a bounded time for synchronisation (real run F2: NTPSynchronized=no for the first seconds after a reboot)', () => {
  // Pin: POLY_NTP_WAIT = seconds to wait (default 60). The fake's timedatectl answers "no" for the first N calls (`ntp-no-calls`).
  const timed = (plant: string, wait: number) => {
    const t0 = Date.now();
    const r = run(`${b2Fixture({})}\n${plant}\nPOLY_NTP_WAIT=${wait} bash /repo/infra/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}; echo "calls=$(grep -c '^timedatectl' /var/fake-state/calls.log)"`, { image: COMPLETE });
    return { r, secs: (Date.now() - t0) / 1000 };
  };
  it('the default wait is 60 s (a bounded wait, named in the script)', () => {
    expect(readFileSync(join(ROOT, 'infra', 'provision-check.sh'), 'utf8')).toMatch(/POLY_NTP_WAIT:-60/);
  });
  it('becomes synchronised within the wait: PASS H14, more than one timedatectl call, no FAIL', () => {
    const { r } = timed('echo 2 > /var/fake-state/ntp-no-calls', 8);
    expect(find(r.out, 'PASS', 'H14')).toBeDefined();
    expect(find(r.out, 'FAIL', 'H14')).toBeUndefined();
    expect(Number(/calls=(\d+)/.exec(r.out)![1])).toBeGreaterThanOrEqual(3);
  });
  it('already synchronised: one look, no waiting (fast)', () => {
    const { r, secs } = timed('', 30);
    expect(find(r.out, 'PASS', 'H14')).toBeDefined();
    expect(secs).toBeLessThan(15);
  });
  it('never synchronises: waits about the bounded time, then FAIL H14 with the fix line', () => {
    const { r, secs } = timed('echo no > /var/fake-state/ntp', 4);
    failLine(r, 'H14', ['ntp']);
    expect(secs).toBeGreaterThanOrEqual(3.5); // it did wait
    expect(secs).toBeLessThan(25); // and the wait is bounded
  });
});

describe('H12: the box B2 key (R6, S4, S5)', () => {
  it('PASS when the key holds exactly the box-key constant, is restricted to the bucket, and has no name prefix', () => {
    const r = check('');
    expect(find(r.out, 'PASS', 'H12')).toBeDefined();
  });
  it('a key that also holds listFiles fails, naming the capability, with the delete-and-recreate fix', () => {
    const t = failLine(check('', { b2: { capabilities: ['listBuckets', 'writeFiles', 'listFiles'] } }), 'H12', ['listFiles']);
    expect(t).toMatch(/fix: delete key polycarpic-put-only; recreate it with infra\/operator\/b2-setup\.py/);
  });
  it('a key missing a capability fails, naming it', () => {
    failLine(check('', { b2: { capabilities: ['listBuckets'] } }), 'H12', ['writeFiles']);
  });
  it('an unrestricted key (no bucketId / bucketName) fails', () => {
    failLine(check('', { b2: { bucketId: null, bucketName: null } }), 'H12', ['bucket']);
  });
  it('a key restricted to another bucket fails', () => {
    failLine(check('', { b2: { bucketName: 'someone-elses-bucket' } }), 'H12', ['someone-elses-bucket']);
  });
  it('a key with a namePrefix fails', () => {
    failLine(check('', { b2: { namePrefix: 'wal/' } }), 'H12', ['prefix']);
  });
  it('a rejected credential (401) fails with the fix, not a crash', () => {
    const r = run(`rm -f /var/fake-state/b2-authorize.json; ${CHECK}`, { image: COMPLETE });
    failLine(r, 'H12', [/401|unauthor|reject|denied/i]);
  });
  it('3c: a missing --b2-bucket, a missing --b2-capabilities, or an unreadable file is a FAIL with the pass-the-flags fix, never a WAIT or a skip', () => {
    const base = `${b2Fixture({})}\n`;
    const FIXTXT = 'pass --b2-capabilities <file> --b2-bucket <name>';
    for (const args of [`--b2-capabilities ${CAPS}`, `--b2-bucket ${BUCKET}`, `--b2-capabilities /nonexistent.json --b2-bucket ${BUCKET}`, '']) {
      const r = run(`${base}bash /repo/infra/provision-check.sh ${args}`, { image: COMPLETE });
      const t = failLine(r, 'H12', []);
      expect(t).toContain(FIXTXT);
      expect(find(r.out, 'WAIT', 'H12')).toBeUndefined();
    }
  });
  it('3b: the bucket comes from --b2-bucket alone: a different bucketName in the file is ignored, the flag wins', () => {
    const r = run(`${b2Fixture({})}\nsed 's/polycarpic-hetzner-backups/some-other-bucket/' ${CAPS} > /tmp/caps.json; bash /repo/infra/provision-check.sh --b2-capabilities /tmp/caps.json --b2-bucket ${BUCKET}`, { image: COMPLETE });
    expect(find(r.out, 'PASS', 'H12')).toBeDefined();
  });
  it('WAIT while backup_store_credential is absent', () => {
    const r = check('rm -f /etc/polycarpic/secrets/uploader/backup_store_credential');
    const w = find(r.out, 'WAIT', 'H12');
    expect(w).toBeDefined();
    expect(find(r.out, 'FAIL', 'H12')).toBeUndefined();
  });
  it('sends the credential to curl on stdin (--config -), never in argv; prints no credential, token or response header', () => {
    const r = run(`${b2Fixture({})}\n${CHECK} > /tmp/out 2>&1; cat /tmp/out; echo ==CALLS==; grep '^curl' /var/fake-state/calls.log`, { image: COMPLETE });
    const [out, calls] = r.out.split('==CALLS==');
    expect(calls).toMatch(/curl .*(--config|-K) -/);
    for (const v of Object.values(FX)) {
      expect(calls, `argv leaks ${v}`).not.toContain(v);
      expect(out, `output leaks ${v}`).not.toContain(v);
    }
    expect(out).not.toMatch(/authorizationToken|^HTTP\/|^authorization:/im);
  });
  it('the failure path prints no authorizationToken either', () => {
    const r = check('', { b2: { capabilities: ['listFiles', 'writeFiles'] } });
    for (const v of Object.values(FX)) expect(r.all).not.toContain(v);
  });
});

describe('H13 and H15 (R4, R6)', () => {
  it('H13 PASS when heartbeat_url exists', () => {
    expect(find(check('').out, 'PASS', 'H13')).toBeDefined();
  });
  it('H13 absent: WARN with the exact consequence text, never a PASS', () => {
    const r = check('rm /etc/polycarpic/secrets/uploader/heartbeat_url');
    const w = find(r.out, 'WARN', 'H13');
    expect(w?.text).toBe('heartbeat not configured: alert path B does not exist; a box going quiet or a full bucket goes unnoticed');
    expect(find(r.out, 'PASS', 'H13')).toBeUndefined();
  });
  it('H13 absent under --prod is a FAIL, not a WARN', () => {
    const r = check('rm /etc/polycarpic/secrets/uploader/heartbeat_url', { args: '--prod' });
    failLine(r, 'H13', ['heartbeat']);
    expect(find(r.out, 'WARN', 'H13')).toBeUndefined();
  });
  it('H15: sshd -T shows allowusers polyops; a drop-in that adds another user fails', () => {
    failLine(check(`${plantAppend('/etc/ssh/sshd_config.d/00-evil.conf', 'AllowUsers polyops mallory')}`), 'H15', ['allowusers']);
  });
  it('H15: the polyops sudoers drop-in is exactly one line and mode 0440', () => {
    failLine(check('chmod 0644 /etc/sudoers.d/*polyops* /etc/sudoers.d/90-* 2>/dev/null; true'), 'H15', ['0440']);
    failLine(check(`f=$(ls /etc/sudoers.d/* | grep -v README | head -1); echo '# x' >> $f; echo 'polyops ALL=(ALL) ALL' >> $f`), 'H15', ['sudoers']);
  });
  it('H15: any other sudoers file granting beyond Ubuntu\'s defaults fails', () => {
    failLine(check(`echo 'mallory ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-mallory; chmod 0440 /etc/sudoers.d/99-mallory`), 'H15', ['mallory']);
  });
  it('H15: a second account with a login shell and an authorized_keys fails', () => {
    failLine(check(`useradd -m -s /bin/bash mallory; mkdir -p /home/mallory/.ssh; echo 'ssh-ed25519 AAAA x' > /home/mallory/.ssh/authorized_keys`), 'H15', ['mallory']);
  });
  it('H15 positive: a service account with no shell and no keys is fine', () => {
    const r = check(`useradd -r -s /usr/sbin/nologin svc1`);
    expect(find(r.out, 'PASS', 'H15')).toBeDefined();
  });
});
