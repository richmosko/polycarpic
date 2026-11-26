// POLY-98 R11/R12: polycarpic-ops where it matters: real root, real modes and ownership, sudo's environment reset, the box-side installer, H6 and D3.
// Runs in the `provision` job on the POLY-97 box (Ubuntu 24.04 with sudo, python3, git). The Python unit tests (tests/infra/ops/) cover the logic with fakes;
// this file covers what only a real root can show. Contract pins: process/cairn/reviews/POLY-98/test-plan.md.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETE, HOST, b2Fixture, build, check, failLine, find, last, makeComplete, makeHost, run, sh } from './box.ts';
import { BASE_IMAGE, CHECK_OPS, NETS_GOOD, OPS, STAGE, checkAll, namesFor, nets, point, startPg, superPassword, waitPg } from './pg.ts';

const BUCKET = 'polycarpic-hetzner-backups';
const EXEC = ['infra/ops/polycarpic-ops', 'infra/ops/install_box.py', 'infra/provision.sh', 'infra/provision-check.sh', 'infra/postgres/gate-check.sh', 'infra/backup/backup.sh', 'infra/backup/upload.sh', 'infra/postgres/archive-wal.sh']; // POLY-99: the scripts the runner starts are executable in the bundle too

// A laptop checkout inside the box (bundle paths copied from /repo, committed), a fake ssh that runs the remote command as polyops, and `bump` to make a new commit.
const LAP = `
rm -rf /tmp/lap /tmp/bin; mkdir -p /tmp/lap /tmp/bin
(cd /repo && cp -a --parents infra/ops infra/provision.sh infra/provision-check.sh infra/postgres/gate-check.sh infra/postgres/gate-check.sql infra/operator/b2-capabilities.json infra/compose/prod.yml infra/compose/staging.yml infra/compose/edge.yml packages/db/sql/roles.sql infra/backup infra/postgres/archive-wal.sh infra/postgres/pg_hba.prod.conf infra/postgres/pg_hba.staging.conf infra/deploy /tmp/lap/)
find /tmp/lap -name __pycache__ -prune -exec rm -rf {} +
(cd /tmp/lap && git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm one)
cat > /tmp/bin/ssh <<'SSH'
#!/bin/bash
while [ $# -gt 1 ]; do shift; done
exec runuser -u polyops -- bash -c "$1"
SSH
chmod +x /tmp/bin/ssh
bump() { echo "# $1" >> /tmp/lap/infra/provision.sh; (cd /tmp/lap && git commit -qam "$1"); }
install_ops() { (cd /tmp/lap && PATH=/tmp/bin:$PATH bash infra/ops/install.sh polyops@box); }
`;
const FAKE_DOCKER = 'install -m 0755 /repo/tests/infra/provision/fakes-ops/docker /usr/bin/docker;';
const SUDO = (cmd: string) => `sudo -n -u polyops sudo -n ${cmd}`;
const FACTS = `find /opt/polycarpic -printf '%y %m %u:%g %P\\n' | sort`;

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`host stage failed on the fake box:\n${h.all.slice(-1200)}`);
    const c = makeComplete();
    if (c.code !== 0) throw new Error(`complete box failed: ${c.all.slice(-600)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });

const ops = (script: string, image = HOST) => run(`${LAP}\n${script}`, { image });

describe('polycarpic-ops install: install.sh to install_box.py on a real root', () => {
  it('first install: root-owned 0755/0644 tree with the five executables, the links, and the exact output line', () => {
    const r = ops(`id=git-$(cd /tmp/lap && git rev-parse --short=12 HEAD); install_ops; echo "rc=$?"; echo "ID=$id"; ${FACTS}; readlink /opt/polycarpic/ops/current; readlink /usr/local/sbin/polycarpic-ops`);
    expect(r.out).toMatch(/rc=0/);
    const id = /ID=(git-[0-9a-f]{12})/.exec(r.out)![1]!;
    expect(r.out).toContain(`installed polycarpic-ops ${id} at /opt/polycarpic/ops/current (previous: none)`);
    const rows = r.out.split('\n').filter((l) => /^[df] \d+ \S+ /.test(l)).map((l) => l.split(' '));
    const mine = rows.filter((x) => x[3] === `ops/${id}` || x[3]!.startsWith(`ops/${id}/`));
    expect(mine.length).toBeGreaterThan(10);
    for (const [kind, mode, owner, path] of mine) {
      expect(owner, path).toBe('root:root');
      const rel = path!.slice(`ops/${id}/`.length);
      expect(mode, path).toBe(kind === 'd' ? '755' : EXEC.includes(rel) ? '755' : '644');
    }
    for (const f of EXEC) expect(mine.find((x) => x[3] === `ops/${id}/${f}`), f).toBeDefined();
    expect(rows.find((x) => x[3] === '')).toEqual(['d', '755', 'root:root', '']);
    expect(r.out).toMatch(new RegExp(`^${id}$`, 'm'));
    expect(r.out).toContain('/opt/polycarpic/ops/current/infra/ops/polycarpic-ops');
  });

  it('a second install of the same id changes nothing and says so', () => {
    const r = ops(`install_ops >/dev/null; find /opt/polycarpic /usr/local/sbin -path /opt/polycarpic/.incoming -prune -o -printf '%i %T@ %p\\n' | sort > /tmp/before; out=$(install_ops); echo "rc=$?"; echo "$out"; find /opt/polycarpic /usr/local/sbin -path /opt/polycarpic/.incoming -prune -o -printf '%i %T@ %p\\n' | sort > /tmp/after; diff /tmp/before /tmp/after && echo SAME`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/polycarpic-ops git-[0-9a-f]{12} already installed/);
    expect(r.out).toContain('SAME');
  });

  it('a third id deletes the oldest, keeps the previous, and each output names its previous', () => {
    const r = ops(`for n in a b c; do bump $n; install_ops | sed "s/^/OUT /"; ls /opt/polycarpic/ops | grep -v '^ssh-target$' | tr '\\n' ' ' | sed "s/^/LS /"; echo; done`);
    const outs = r.out.split('\n').filter((l) => l.startsWith('OUT installed'));
    expect(outs[0]).toMatch(/\(previous: none\)$/);
    expect(outs[1]).toMatch(/\(previous: git-[0-9a-f]{12}\)$/);
    const ls = r.out.split('\n').filter((l) => l.startsWith('LS ')).map((l) => l.slice(3).trim().split(/\s+/));
    expect(ls[0]!.length).toBe(2); // id + current
    expect(ls[1]!.length).toBe(3); // two ids + current
    expect(ls[2]!.length).toBe(3); // the oldest was deleted
    expect(ls[2]).not.toContain(ls[0]!.find((x) => x !== 'current')!);
  });

  it('a tar member with .., an absolute path or a link exits 1, current is unchanged, nothing lands outside', () => {
    const MK = `cat > /tmp/mk.py <<'PY'
import io, sys, tarfile
kind = sys.argv[1]
t = tarfile.open(fileobj=sys.stdout.buffer, mode="w|")
def add(name, data=b"x", link=None):
    i = tarfile.TarInfo(name)
    if link:
        i.type = tarfile.SYMTYPE; i.linkname = link; t.addfile(i)
    else:
        i.size = len(data); t.addfile(i, io.BytesIO(data))
add("infra/ops/polycarpic-ops")
if kind == "dotdot": add("../evil")
if kind == "abs": add("/abs-evil")
if kind == "link": add("infra/ops/l", link="/etc/passwd")
t.close()
PY`;
    const r = ops(`${MK}
install_ops >/dev/null; before=$(readlink /opt/polycarpic/ops/current)
install -d -m 0700 /opt/polycarpic/.incoming; install -m 0600 /repo/infra/ops/install_box.py /opt/polycarpic/.incoming/install_box.py
for k in dotdot abs link; do
  python3 /tmp/mk.py $k | python3 -I /opt/polycarpic/.incoming/install_box.py git-bbbbbbbbbbbb > /tmp/$k.out 2>&1; echo "rc-$k=$?"
  [ "$(readlink /opt/polycarpic/ops/current)" = "$before" ] && echo "CURRENT-SAME-$k"
  for leak in /opt/polycarpic/evil /abs-evil /opt/polycarpic/ops/git-bbbbbbbbbbbb; do [ -e $leak ] && echo "LEAK $leak"; done
done
true`);
    for (const k of ['dotdot', 'abs', 'link']) {
      expect(r.out, k).toContain(`rc-${k}=1`);
      expect(r.out, k).toContain(`CURRENT-SAME-${k}`);
    }
    expect(r.out).not.toContain('LEAK');
  });

  it('provision-check runs from the bundle after a simulated reboot that clears /tmp, with the checkout copy`s exit code and summary', () => {
    const direct = `bash /repo/infra/provision-check.sh --b2-capabilities /repo/infra/operator/b2-capabilities.json --b2-bucket ${BUCKET}`;
    const r = run(`${LAP}\n${b2Fixture({})}\nfor f in /fakes/*; do ln -sf $f /usr/local/bin/; done\ninstall_ops >/dev/null; rm -rf /tmp/* /var/tmp/*
${direct} > /dev/shm/direct.out 2>&1; echo "direct=$?"; echo "DIRECT_LAST=$(tail -1 /dev/shm/direct.out)"
${SUDO(`polycarpic-ops provision-check --b2-bucket ${BUCKET}`)} > /dev/shm/ops.out 2>&1; echo "ops=$?"; echo "OPS_LAST=$(tail -1 /dev/shm/ops.out)"; echo "NOSUCH=$(grep -c 'No such file' /dev/shm/ops.out)"`, { image: COMPLETE });
    expect(/direct=(\d+)/.exec(r.out), r.all.slice(-600)).not.toBeNull();
    expect(/ops=(\d+)/.exec(r.out)![1]).toBe(/direct=(\d+)/.exec(r.out)![1]);
    expect(/OPS_LAST=(.*)/.exec(r.out)![1]).toBe(/DIRECT_LAST=(.*)/.exec(r.out)![1]);
    expect(r.out).toContain('NOSUCH=0');
  });
});

describe('polycarpic-ops under real sudo', () => {
  const INSTALLED = (script: string, image = HOST) => ops(`install_ops >/dev/null; ${FAKE_DOCKER}\n${script}`, image);

  it('refuses without sudo (exit 4), runs with it, and sudo reaches it through /usr/local/sbin', () => {
    const r = INSTALLED(`runuser -u polyops -- /usr/local/sbin/polycarpic-ops help; echo "plain=$?"; ${SUDO('polycarpic-ops help')} > /tmp/help.out; echo "sudo=$?"; cat /tmp/help.out`);
    expect(r.all).toContain('polycarpic-ops: run with sudo');
    expect(r.out).toContain('plain=4');
    expect(r.out).toContain('sudo=0');
    for (const c of ['set-secret', 'list-secrets', 'status', 'gate-check', 'provision', 'provision-check', 'restart', 'cli']) expect(r.out).toMatch(new RegExp(`^\\s*${c}\\s+\\S`, 'm'));
  });

  it('an install file owned by anyone but root exits 4 naming it; a group-writable one the same; restoring it passes again', () => {
    const r = INSTALLED(`f=/opt/polycarpic/ops/current/infra/ops/lib; chown polyops:polyops $f; ${SUDO('polycarpic-ops help')}; echo "owner=$?"; chown root:root $f; touch /opt/polycarpic/ops/current/infra/ops/zz.py; chown polyops /opt/polycarpic/ops/current/infra/ops/zz.py; ${SUDO('polycarpic-ops help')}; echo "file=$?"; rm /opt/polycarpic/ops/current/infra/ops/zz.py; chmod g+w /opt/polycarpic/ops/current/infra/compose/prod.yml; ${SUDO('polycarpic-ops help')}; echo "gw=$?"; chmod g-w /opt/polycarpic/ops/current/infra/compose/prod.yml; ${SUDO('polycarpic-ops help')} >/dev/null; echo "ok=$?"`);
    expect(r.all).toMatch(/install is not root-owned: \/opt\/polycarpic\/ops\/git-[0-9a-f]{12}\/infra\/ops\/lib/);
    expect(r.all).toMatch(/install is not root-owned: \/opt\/polycarpic\/ops\/git-[0-9a-f]{12}\/infra\/compose\/prod\.yml/);
    expect(r.out).toContain('owner=4');
    expect(r.out).toContain('gw=4');
    expect(r.out).toContain('file=4'); // K12(d): a file owned by the sudo user is not root-owned
    expect(r.out).toContain('ok=0');
  });

  it('children get exactly PATH, LC_ALL and HOME, however polluted the operator shell is, and no __pycache__ appears in the install', () => {
    const r = INSTALLED(`echo '{"Service":"web","Name":"polycarpic-prod-web-1","State":"running","Health":"healthy","ID":"i"}' > /var/fake-state/ops-ps-polycarpic-prod.json
runuser -u polyops -- env PYTHONPATH=/tmp/evil LD_PRELOAD=/tmp/evil.so DOCKER_HOST=tcp://evil:1 PYTHONINSPECT=1 sudo -n -E polycarpic-ops restart web; echo "rc=$?"
grep -c ARGV /var/fake-state/ops-docker.log; awk '/^--ENV/{n++} n>0 && !/^--ENV/' /var/fake-state/ops-docker-env.log | sed 's/=.*//' | sort -u | tr '\\n' ' '; echo; grep -h '^PATH=\\|^LC_ALL=\\|^HOME=' /var/fake-state/ops-docker-env.log | sort -u; find /opt/polycarpic -name __pycache__ | wc -l`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toContain('HOME LC_ALL PATH');
    expect(r.out).toContain('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
    expect(r.out).toContain('LC_ALL=C.UTF-8');
    expect(r.out).toContain('HOME=/root');
    expect(r.out.trim().split('\n').pop()).toBe('0');
  });

  it('cli user invite: the link reaches the terminal and no file, argv and env carry the deployed images and the pinned flags', () => {
    const app = 'ghcr.io/x/y@sha256:' + 'a'.repeat(64), pg = 'postgres@sha256:' + 'b'.repeat(64);
    const insp = (img: string) => `[{"Config":{"Image":"${img}"},"Created":"2026-11-22T18:21:00Z","State":{"StartedAt":"2026-11-01T00:00:00Z"}}]`;
    const r = INSTALLED(`printf '%s\\n' '{"Service":"postgres","Name":"pgc","State":"running","Health":"healthy","ID":"1"}' '{"Service":"web","Name":"webc","State":"running","Health":"healthy","ID":"2"}' > /var/fake-state/ops-ps-polycarpic-prod.json
printf '%s' '${insp(pg)}' > /var/fake-state/ops-inspect-pgc.json; printf '%s' '${insp(app)}' > /var/fake-state/ops-inspect-webc.json
${SUDO('polycarpic-ops cli user invite owner@example.com --bootstrap')} > /tmp/o.out 2> /tmp/o.err; echo "rc=$?"
echo "OUT=$(cat /tmp/o.out)"; echo "ERR=$(cat /tmp/o.err)"
echo "LEAKS=$(grep -rl FAKELINK /var /etc /opt /root /home /usr/local 2>/dev/null | grep -v '^/var/fake-state' | wc -l)"
grep -- ' run ' /var/fake-state/ops-docker.log | sed 's/^/RUN /'
awk '/^--ENV/{blk=""} {blk=blk"\\n"$0} /^POLY_POSTGRES_IMAGE=/{print "ENVHAS " $0}' /var/fake-state/ops-docker-env.log; grep -h '^POLY_APP_IMAGE=' /var/fake-state/ops-docker-env.log | sed 's/^/ENVHAS /'`);
    expect(r.out).toContain('rc=0');
    expect(r.out).toContain('OUT=https://app.example.com/accept?t=FAKELINK');
    expect(r.out).toContain('ERR=invitation recorded (bootstrap), expires');
    expect(r.out).toContain('LEAKS=0');
    // G11 (ruling 3b62bbe6): every compose call names --project-directory (a bundle file's own directory here) and --env-file /dev/null
    expect(r.out).toMatch(/RUN ARGV compose --project-directory \S+\/infra\/compose --env-file \/dev\/null -f \S+\/infra\/compose\/prod\.yml -p polycarpic-prod --profile operator run --rm -T --pull never --no-deps operator user invite owner@example\.com --bootstrap/);
    expect(r.out).toContain(`ENVHAS POLY_APP_IMAGE=${app}`);
    expect(r.out).toContain(`ENVHAS POLY_POSTGRES_IMAGE=${pg}`);
  });

  // A real pty driver: each step waits for its prompt (or, for `early`, writes at once, before any prompt exists), so input is never queued ahead by accident.
  const DRIVER = `cat > /tmp/ptydrv.py <<'PY'
import json, os, pty, select, sys, time
cmd, steps = sys.argv[1], json.loads(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-c", cmd])
buf, eof, alltext, sent = b"", False, b"", []
def pump(until=None, limit=20):
    global buf, eof, alltext
    end = time.time() + limit
    while not eof and time.time() < end and (until is None or until not in buf):
        r, _, _ = select.select([fd], [], [], 0.5)
        if r:
            try:
                d = os.read(fd, 4096)
            except OSError:
                d = b""
            if not d:
                eof = True
            buf += d
            alltext += d
def answer_all(answers):
    global buf
    given = set()
    end = time.time() + 30
    while not eof and time.time() < end:
        for k, v in answers.items():
            if k.encode() in buf and k not in given:
                buf = buf.split(k.encode(), 1)[1]
                os.write(fd, v.encode())
                sent.append(v.strip())
                given.add(k)
        pump(None, 0.6)
    return given
for s in steps:
    if "answers" in s:
        print("DRIVER-GIVEN", json.dumps(sorted(answer_all(s["answers"]))))
        continue
    if "early" in s:
        os.write(fd, s["early"].encode())
        time.sleep(0.3)
        continue
    pump(s["expect"].encode())
    if s["expect"].encode() in buf:
        buf = buf.split(s["expect"].encode(), 1)[1]
        os.write(fd, s["send"].encode())
    elif not s.get("optional"):
        print("DRIVER-MISSING", s["expect"])
pump(None, 20)
print("DRIVER-ECHOED", json.dumps([v for v in sent if v and v.encode() in alltext]))
_, status = os.waitpid(pid, 0)
print("DRIVER-RC", os.waitstatus_to_exitcode(status))
PY`;
  const PTY = (cmd: string, steps: object[]) => `python3 /tmp/ptydrv.py "${SUDO(cmd)}" '${JSON.stringify(steps)}'`;
  const PROMPT = 'resend_api_key (input hidden): ';
  const TARGETS = '/etc/polycarpic/secrets/auth/resend_api_key /etc/polycarpic/secrets/worker/resend_api_key';

  it('set-secret on a real root: resend_api_key lands 0440 root:10007 and root:10002, replacing needs yes, a symlinked service directory exits 4 with nothing written', () => {
    const r = INSTALLED(`${DRIVER}
${PTY('polycarpic-ops set-secret resend_api_key', [{ expect: PROMPT, send: 'fxSecretValue123\n' }])}
stat -c '%a %u:%g %s' ${TARGETS}
ls -A /etc/polycarpic/secrets/auth /etc/polycarpic/secrets/worker | grep -c 'tmp-' || true
${PTY('polycarpic-ops set-secret resend_api_key', [{ answers: { [PROMPT]: 'fxOtherValue456\n', 'type yes to replace:': 'no\n' } }])}
echo "AFTERNO=$(cat /etc/polycarpic/secrets/auth/resend_api_key)"
mv /etc/polycarpic/secrets/worker /etc/polycarpic/secrets/worker.real; ln -s /etc/polycarpic/secrets/worker.real /etc/polycarpic/secrets/worker
rm /etc/polycarpic/secrets/auth/resend_api_key
${PTY('polycarpic-ops set-secret resend_api_key', [{ answers: { [PROMPT]: 'fxThirdValue789\n' } }])}
echo "SYMLINK-AUTH=$(ls /etc/polycarpic/secrets/auth | grep -c resend) WORKER=$(cat /etc/polycarpic/secrets/worker.real/resend_api_key)"
grep -rl 'fxSecretValue123\\|fxOtherValue456\\|fxThirdValue789' /tmp /var /root /home /opt /etc 2>/dev/null | grep -v '/etc/polycarpic/secrets/' | grep -v '^/tmp/ptydrv.py$' || true`);
    const rcs = [...r.out.matchAll(/DRIVER-RC (\d+)/g)].map((m) => m[1]);
    expect(rcs, r.out.slice(-800)).toEqual(['0', '1', '4']);
    // R4 order (architect): checks, then the yes question, then the hidden value prompt. A refused replace shows no value prompt; a bad directory shows nothing.
    expect([...r.out.matchAll(/DRIVER-GIVEN (.*)/g)].map((m) => JSON.parse(m[1]!))).toEqual([['type yes to replace:'], []]);
    expect(r.out).toContain('440 0:10007 17');
    expect(r.out).toContain('440 0:10002 17');
    expect(r.out).toContain('AFTERNO=fxSecretValue123');
    expect(r.out).toContain('SYMLINK-AUTH=0 WORKER=fxSecretValue123'); // nothing written for either service: auth stays empty, the worker file keeps the first value
    expect(r.out).not.toMatch(/fx(Secret|Other|Third)Value\d+\n\/(tmp|var|root|home|opt|etc)\//); // no copy of a value outside the secret trees
  });

  it('B4: a secret pasted at the replace question is not echoed, exits 1 `not replaced`, and lands in no file', () => {
    const r = INSTALLED(`${DRIVER}
mkdir -p /etc/polycarpic/secrets/auth; echo old > /etc/polycarpic/secrets/auth/resend_api_key; chown root:10007 /etc/polycarpic/secrets/auth/resend_api_key; chmod 0440 /etc/polycarpic/secrets/auth/resend_api_key
${PTY('polycarpic-ops set-secret resend_api_key', [{ answers: { 'type yes to replace:': 'fxPasted999secret\n' } }])}
echo "AUTH=$(cat /etc/polycarpic/secrets/auth/resend_api_key)"
grep -rl 'fxPasted999secret' /tmp /var /root /home /opt /etc 2>/dev/null | grep -v '^/tmp/ptydrv.py$' || true`);
    expect(r.out, r.all.slice(-800)).toContain('DRIVER-RC 1');
    expect(r.out).toContain('DRIVER-ECHOED []');
    expect(r.out).toContain('AUTH=old');
    expect(r.out).not.toMatch(/fxPasted999secret\n\//);
  });

  it('B1: input sent before the prompt is dropped, not taken as the secret; only what is typed after the prompt is written', () => {
    const r = INSTALLED(`${DRIVER}
${PTY('polycarpic-ops set-secret resend_api_key', [{ early: 'earlyvalue\n' }, { expect: PROMPT, send: 'latevalue\n' }])}
echo "AUTH=$(cat /etc/polycarpic/secrets/auth/resend_api_key)"; echo "WORKER=$(cat /etc/polycarpic/secrets/worker/resend_api_key)"
echo "EARLY-IN-TARGETS=$(cat ${TARGETS} | grep -c earlyvalue || true)"`);
    expect(r.out, r.all.slice(-1200)).toContain('DRIVER-RC 0');
    expect(r.out).not.toContain('DRIVER-MISSING');
    expect(r.out).toContain('AUTH=latevalue\n');
    expect(r.out).toContain('WORKER=latevalue\n');
    expect(r.out).toContain('EARLY-IN-TARGETS=0');
  });
});

describe('provision-check H6 with polycarpic-ops writes', () => {
  const RESEND = 'echo fxresend > /etc/polycarpic/secrets/auth/resend_api_key; cp -p /etc/polycarpic/secrets/auth/resend_api_key /etc/polycarpic/secrets/worker/resend_api_key; chown root:10007 /etc/polycarpic/secrets/auth/resend_api_key; chown root:10002 /etc/polycarpic/secrets/worker/resend_api_key; chmod 0440 /etc/polycarpic/secrets/auth/resend_api_key /etc/polycarpic/secrets/worker/resend_api_key';
  it('one value in the auth and worker resend_api_key files passes H6 (same name, same tree)', () => {
    const r = check(RESEND);
    expect(find(r.out, 'PASS', 'H6'), r.out.slice(-800)).toBeDefined();
  });
  it('the same value under two different names fails H6', () => {
    failLine(check(`${RESEND}; cp -p /etc/polycarpic/secrets/auth/resend_api_key /etc/polycarpic/secrets/auth/auth_secret.copy`), 'H6', ['auth_secret.copy']);
    failLine(check(`${RESEND}; cp -p /etc/polycarpic/secrets/web/db_password_app /etc/polycarpic/secrets/web/plaid_secret`), 'H6', ['same content']);
  });
  it('K6: a generated password planted as a second name, or a generated name copied into a service that does not mount it, fails H6', () => {
    failLine(check('cp -p /etc/polycarpic/secrets/auth/auth_secret /etc/polycarpic/secrets/worker/auth_secret'), 'H6', ['auth_secret']);
    failLine(check('cp -p /etc/polycarpic/secrets/web/db_password_app /etc/polycarpic/secrets/worker/db_password_app'), 'H6', ['db_password_app']);
  });
  it('a staging value equal to prod`s fails H6 even under the same name', () => {
    failLine(check(`${RESEND}; cp -p /etc/polycarpic/secrets/auth/resend_api_key /etc/polycarpic/staging-secrets/auth/resend_api_key`), 'H6', ['same content']);
  });
  it('K6: ops.conf is world-readable by design and passes; an extra line or a bad bucket fails H6 naming it', () => {
    const conf = (body: string) => `printf '${body}' > /etc/polycarpic/ops.conf; chmod 0644 /etc/polycarpic/ops.conf; chown root:root /etc/polycarpic/ops.conf`;
    expect(find(check(conf(`B2_BUCKET=${BUCKET}\\n`)).out, 'PASS', 'H6')).toBeDefined();
    failLine(check(conf(`B2_BUCKET=${BUCKET}\\nEXTRA=1\\n`)), 'H6', ['ops.conf']);
    failLine(check(conf('B2_BUCKET=Bad_Bucket\\n')), 'H6', ['ops.conf']);
  });
});

describe('provision-check D3 records its probe window in jobs.log (R7: without it every provision-check turns backupdb red)', () => {
  const NET = `poly98net${process.pid}`;
  const names = namesFor('o');
  const ALL = checkAll(names, NET);
  let dbError: string | null = null;
  beforeAll(() => {
    try {
      const superPw = superPassword();
      sh('docker', ['network', 'create', NET]);
      startPg(names.good, NET, BASE_IMAGE, superPw);
      startPg(names.stg, NET, BASE_IMAGE, superPw, [], true, 'staging');
      for (const n of [names.good, names.stg]) waitPg(n);
      const prod = run(`${STAGE(names.good)} 2>&1`, { image: HOST, network: NET });
      if (prod.code !== 0) throw new Error(`the prod database stage failed: ${prod.all.slice(-600)}`);
      const stg = run(`${STAGE(names.stg, 'staging')} 2>&1`, { image: HOST, network: NET });
      if (stg.code !== 0) throw new Error(`the staging database stage failed: ${stg.all.slice(-600)}`);
    } catch (e) { dbError = String((e as Error).message); }
  }, 600_000);
  beforeEach(() => { if (dbError) throw new Error(dbError); });
  afterAll(() => { for (const n of [names.good, names.stg]) sh('docker', ['rm', '-f', n]); sh('docker', ['network', 'rm', NET]); });

  const JOBS = '/var/lib/polycarpic/state/jobs.log';
  const LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) provision-check-d3 (ok|failed)$/;
  it('a passing run appends exactly one `<start> <end> provision-check-d3 ok` line, and a second run appends a second', () => {
    const r = ALL(`rm -f ${JOBS}; ${CHECK_OPS} > /dev/null 2>&1; echo FIRST; cat ${JOBS}; echo SECOND`);
    const out = r.out.replace(/rc=\d\s*$/, '');
    expect(find(out, 'PASS', 'D3'), out.slice(-600)).toBeDefined();
    const first = out.split('FIRST\n')[1]!.split('SECOND')[0]!.trim().split('\n');
    expect(first.length).toBe(1);
    const m = LINE.exec(first[0]!);
    expect(m, first[0]).not.toBeNull();
    expect(m![3]).toBe('ok');
    expect(m![1]! <= m![2]!).toBe(true);
    const twice = ALL(`rm -f ${JOBS}; ${CHECK_OPS} > /dev/null 2>&1; ${CHECK_OPS} > /dev/null 2>&1; wc -l < ${JOBS}`);
    expect(twice.out).toMatch(/^\s*2\s*$/m);
  });
  it('a failing probe still appends its window, ending `failed`', () => {
    const r = ALL(`rm -f ${JOBS}; echo ok > /var/fake-state/c79-web; ${CHECK_OPS} > /dev/null 2>&1; cat ${JOBS}`);
    const l = r.out.split('\n').find((x) => LINE.test(x));
    expect(l, r.out.slice(-400)).toBeDefined();
    expect(LINE.exec(l!)![3]).toBe('failed');
  });
});

describe('status revokes and slots SQL against a real Postgres (architect G2; pin 16)', () => {
  // Pin 16: infra/ops/status/<nn>_slots.py has `SQL` (str); infra/ops/status/<nn>_revokes.py has `sql(signatures) -> str`. The test loads both from the tree and runs them as built.
  const NET = `poly98gnet${process.pid}`;
  const names = namesFor('g');
  let dbError: string | null = null;
  beforeAll(() => {
    try {
      const superPw = superPassword();
      sh('docker', ['network', 'create', NET]);
      startPg(names.good, NET, BASE_IMAGE, superPw); // after roles.sql
      startPg(names.bad, NET, BASE_IMAGE, superPw); // fresh: roles.sql never ran
      for (const n of [names.good, names.bad]) waitPg(n);
      const prod = run(`${STAGE(names.good)} 2>&1`, { image: HOST, network: NET });
      if (prod.code !== 0) throw new Error(`the database stage failed: ${prod.all.slice(-600)}`);
    } catch (e) { dbError = String((e as Error).message); }
  }, 600_000);
  beforeEach(() => { if (dbError) throw new Error(dbError); });
  afterAll(() => { for (const n of [names.good, names.bad]) sh('docker', ['rm', '-f', n]); sh('docker', ['network', 'rm', NET]); });

  const LOAD = `cat > /tmp/q.py <<'PY'
import glob, importlib.util, re, sys
sys.path.insert(0, "/repo/infra/ops")
def load(pattern):
    path = glob.glob("/repo/infra/ops/status/" + pattern)[0]
    spec = importlib.util.spec_from_file_location("m_" + pattern[:2], path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
which = sys.argv[1]
if which == "slots":
    sys.stdout.write(load("*_slots.py").SQL)
else:
    sigs = re.findall(r"^REVOKE EXECUTE ON FUNCTION pg_catalog\\.(\\S+) FROM PUBLIC;$", open("/repo/packages/db/sql/roles.sql").read(), re.M)
    assert len(sigs) == 17
    sys.stdout.write(load("*_revokes.py").sql(sigs))
PY
python3 -I /tmp/q.py revokes > /tmp/rev.sql; python3 -I /tmp/q.py slots > /tmp/slots.sql
[ -s /tmp/rev.sql ] && [ -s /tmp/slots.sql ] || echo NOSQL
export PGPASSWORD=$(cat /etc/polycarpic/secrets/postgres/db_superuser_password)
q() { psql -h "$1" -U postgres -d polycarpic -XAtq -v ON_ERROR_STOP=1 < "$2"; }`;
  const QT = 'query_to_xml(text,boolean,boolean,text)';

  it('(a) after roles.sql: revokes prints nothing, slots prints nothing', () => {
    const r = run(`${LOAD}\necho REV; q ${names.good} /tmp/rev.sql; echo SLOTS; q ${names.good} /tmp/slots.sql; echo END`, { image: HOST, network: NET });
    expect(r.out, 'status modules expose the queries (pin 16)').not.toContain('NOSQL');
    expect(r.out.split('REV\n')[1]!.split('SLOTS\n')[0]).toBe('');
    expect(r.out.split('SLOTS\n')[1]!.split('END')[0]).toBe('');
  });
  it('(b) before roles.sql (NULL lanacl): open:plpgsql and all 17 open:<sig>', () => {
    const r = run(`${LOAD}\necho REV; q ${names.bad} /tmp/rev.sql; echo END`, { image: HOST, network: NET });
    const out = r.out.split('REV\n')[1]!.split('END')[0]!.trim().split('\n');
    expect(out).toContain('open:plpgsql');
    expect(out.filter((l) => l.startsWith('open:') && l !== 'open:plpgsql').length).toBe(17);
    expect(out.filter((l) => !l.startsWith('open:'))).toEqual([]);
  });
  it('(c) one built-in granted back to PUBLIC: exactly that signature, then closed again', () => {
    const r = run(`${LOAD}\npsql -h ${names.good} -U postgres -d polycarpic -qc "GRANT EXECUTE ON FUNCTION pg_catalog.${QT} TO PUBLIC"; echo REV; q ${names.good} /tmp/rev.sql; echo END; psql -h ${names.good} -U postgres -d polycarpic -qc "REVOKE EXECUTE ON FUNCTION pg_catalog.${QT} FROM PUBLIC"; echo AFTER; q ${names.good} /tmp/rev.sql; echo DONE`, { image: HOST, network: NET });
    expect(r.out.split('REV\n')[1]!.split('END')[0]!.trim()).toBe(`open:${QT}`);
    expect(r.out.split('AFTER\n')[1]!.split('DONE')[0]).toBe('');
  });
  it('(d) a non-temporary physical slot is printed by name, and dropped afterwards', () => {
    const r = run(`${LOAD}\npsql -h ${names.good} -U postgres -d polycarpic -qc "SELECT pg_create_physical_replication_slot('leftover_slot')" > /dev/null; echo SLOTS; q ${names.good} /tmp/slots.sql; echo END; psql -h ${names.good} -U postgres -d polycarpic -qc "SELECT pg_drop_replication_slot('leftover_slot')" > /dev/null; echo AFTER; q ${names.good} /tmp/slots.sql; echo DONE`, { image: HOST, network: NET });
    expect(r.out.split('SLOTS\n')[1]!.split('END')[0]!.trim()).toBe('leftover_slot');
    expect(r.out.split('AFTER\n')[1]!.split('DONE')[0]).toBe('');
  });
});
