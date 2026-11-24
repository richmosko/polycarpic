// POLY-97 R3 harness: the dry-run box. Builds tests/infra/provision/Dockerfile, runs scripts in throwaway containers with the
// fakes first on PATH, and snapshots a provisioned box with `docker commit` so every planted-fault test starts from the same
// state in a fraction of a second. No network, no credential: the fakes answer for hcloud, Docker, curl (Backblaze) and the volume.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const BOX = 'poly97-box:test';
// Snapshots are tar files (with ACLs and xattrs) extracted over a fresh box, not `docker commit` images: a commit drops POSIX ACLs.
export const HOST = 'host';
export const COMPLETE = 'complete';
export const SNAPDIR = mkdtempSync(join(tmpdir(), 'poly97-snap-'));
export const DOMAIN = 'polycarpic.com';
export const BUCKET = 'polycarpic-hetzner-backups';
export const CAPS = '/repo/tests/infra/provision/fixtures/b2-capabilities.json';
// Fixture secrets that must never appear in any output (R10).
export const FX = {
  b2KeyId: '0049fixturekeyid0000000001',
  b2AppKey: 'K004FIXTUREAPPLICATIONKEY00000000000',
  b2Token: 'authtoken-b2-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

export type R = { code: number; out: string; err: string; all: string };
export function sh(cmd: string, args: string[], input?: string): R {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout ?? '', err = (r.stderr ?? '') + (r.error ? String(r.error) : '');
  return { code: r.status ?? 127, out, err, all: out + err };
}

let built = false;
export function build() {
  if (built) return;
  const b = sh('docker', ['build', '-q', '-t', BOX, join(ROOT, 'tests', 'infra', 'provision')]);
  if (b.code !== 0) throw new Error(`docker build tests/infra/provision failed: ${b.err.slice(-600)}`);
  built = true;
}

const PRE = 'source /harness/prelude.sh; cd /repo;';
function mounts(): string[] {
  return ['-v', `${ROOT}:/repo:ro`, '-v', `${join(ROOT, 'tests', 'infra', 'provision', 'fakes')}:/fakes:ro`];
}

const SNAPS = new Set<string>();
const SAVE = 'tar --acls --xattrs --numeric-owner -cpf /snap/%TAG%.tar -C / --exclude=etc/hosts --exclude=etc/hostname --exclude=etc/resolv.conf etc srv opt/polycarpic var/lib/polycarpic var/fake-state home root 2>/dev/null; true';
const LOAD = (tag: string) => `tar --acls --xattrs --numeric-owner -xpf /snap/${tag}.tar -C / --exclude=etc/hosts --exclude=etc/hostname --exclude=etc/resolv.conf;`;

/** Run `script` as root in a fresh container of the box, first restoring snapshot `o.image` (HOST or COMPLETE) when given. */
export function run(script: string, o: { image?: string; network?: string; env?: Record<string, string> } = {}): R {
  build();
  const a = ['run', '--rm', '--cap-add=SYS_PTRACE', ...mounts(), '-v', `${SNAPDIR}:/snap`]; // root on a real box can read /proc/<pid>/exe of another user (H23, G8)
  if (o.network) a.push('--network', o.network);
  for (const [k, v] of Object.entries(o.env ?? {})) a.push('-e', `${k}=${v}`);
  const load = o.image && SNAPS.has(o.image) ? LOAD(o.image) : '';
  a.push(BOX, 'bash', '-c', `${load}${PRE}\n${script}`);
  return sh('docker', a);
}

/** Run `script` (after restoring snapshot `from`, if any) and save the box's state as snapshot `tag`. Returns the script's result. */
export function snapshot(tag: string, from: string | null, script: string) {
  build();
  const load = from && SNAPS.has(from) ? LOAD(from) : '';
  const r = sh('docker', ['run', '--rm', ...mounts(), '-v', `${SNAPDIR}:/snap`, BOX, 'bash', '-c', `${load}${PRE}\n(\n${script}\n); rc=$?; if [ $rc = 0 ]; then ${SAVE.replace('%TAG%', tag)}; fi; exit $rc`]);
  if (r.code === 0) SNAPS.add(tag);
  return r;
}

export const HOST_ARGS = `--stage host --target hetzner --domain ${DOMAIN} --bind-addr 192.0.2.10 --staging-allow 192.0.2.0/24 --acme-email ops@polycarpic.com`; // POLY-100 R9: the flags that write edge.env (H19 fails without it)
export const CHECK = `POLY_NTP_WAIT=2 bash /repo/infra/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}`;

/** cloud-init applied (test key substituted for the placeholder), then the host stage, once: the snapshot every H test starts from. */
export function makeHost(): R {
  return snapshot(HOST, null, `
ssh-keygen -q -t ed25519 -N '' -f /root/test_key
sed "s|__SSH_PUBLIC_KEY__|$(cat /root/test_key.pub)|" /repo/infra/hetzner/cloud-init.yaml > /tmp/ci.yaml
python3 /harness/apply-cloud-init.py /tmp/ci.yaml
bash /repo/infra/provision.sh ${HOST_ARGS}`);
}

/** The host box plus what the host stage does not make: recipients, the box B2 key, the heartbeat, a good B2 fixture. */
export function makeComplete(): R {
  return snapshot(COMPLETE, HOST, `
age-keygen 2>/dev/null | age-keygen -y > /etc/polycarpic/age-recipients.txt
chmod 0644 /etc/polycarpic/age-recipients.txt
install -d -m 0750 -o root -g 10005 /etc/polycarpic/secrets/uploader
printf '%s\\n%s\\n' ${FX.b2KeyId} ${FX.b2AppKey} > /etc/polycarpic/secrets/uploader/backup_store_credential
chown root:10005 /etc/polycarpic/secrets/uploader/*; chmod 0440 /etc/polycarpic/secrets/uploader/*
install -d -m 0700 -o root -g root /etc/polycarpic/secrets/host
echo https://hc-ping.example/00000000-0000-0000-0000-000000000000 > /etc/polycarpic/secrets/host/heartbeat_url
chown root:root /etc/polycarpic/secrets/host/heartbeat_url; chmod 0400 /etc/polycarpic/secrets/host/heartbeat_url`); // POLY-99 H-1: host-only, root:root 0400
}

/** Shell lines that write the fake Backblaze authorize reply under /dev/shm (outside every swept path; tmpfs, so every run writes it) and link it into the fake state. */
export function b2Fixture(over: Record<string, unknown>): string {
  const allowed = { capabilities: ['listBuckets', 'writeFiles'], bucketId: '4a48fe8875c6214145260818', bucketName: BUCKET, namePrefix: null, ...over };
  const body = JSON.stringify({ accountId: '49fixture', authorizationToken: FX.b2Token, apiUrl: 'https://api000.backblazeb2.com', allowed });
  return `cat > /dev/shm/b2.json <<'JSON'\n${body}\nJSON\nln -sf /dev/shm/b2.json /var/fake-state/b2-authorize.json`;
}

export type Line = { kind: string; id: string; text: string };
export function lines(out: string): Line[] {
  return out.split('\n').flatMap((l) => {
    const m = /^(PASS|FAIL|WAIT|WARN|INFO) (\S+) ?(.*)$/.exec(l);
    return m ? [{ kind: m[1]!, id: m[2]!, text: m[3]! }] : [];
  });
}
export const find = (out: string, kind: string, id: string) => lines(out).find((l) => l.kind === kind && l.id === id);
export const last = (out: string) => out.trim().split('\n').pop() ?? '';

/** Assert a planted fault: exit 1, a FAIL line for `id` that mentions every `found` term and carries a `— fix:` clause. */
export function failLine(r: R, id: string, found: (string | RegExp)[]): string {
  const l = find(r.out, 'FAIL', id);
  if (!l) throw new Error(`expected FAIL ${id}; got:\n${r.out.slice(-1500)}\n${r.err.slice(-500)}`);
  for (const f of found) if (!(typeof f === 'string' ? l.text.toLowerCase().includes(f.toLowerCase()) : f.test(l.text))) throw new Error(`FAIL ${id} line lacks ${f}: ${l.text}`);
  if (!/ — fix: \S/.test(l.text)) throw new Error(`FAIL ${id} line has no "— fix: <step>" clause: ${l.text}`);
  return l.text;
}

/** Run provision-check from the complete box after `plant` (shell lines); the B2 reply defaults to the good box key. */
export function check(plant = '', o: { b2?: Record<string, unknown>; args?: string; image?: string; network?: string } = {}): R {
  return run(`${b2Fixture(o.b2 ?? {})}\n${plant}\n${CHECK} ${o.args ?? ''}`, { image: o.image ?? COMPLETE, network: o.network });
}
