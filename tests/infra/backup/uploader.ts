// POLY-99 R4/R11 harness for the uploader: fake-b2 on upload-net, spool fixtures, and a runner for the rendered `uploader` service.
//
// CONTRACT pinned here (qa pins P9-P14, process/cairn/reviews/POLY-99/test-plan.md):
//  - `infra/backup/tools.Dockerfile` with context `infra/backup/`; no ENTRYPOINT. The script is /usr/local/bin/upload.sh (mounted by
//    prod.yml), run with no arguments as 10005 on upload-net.
//  - ops.conf (`B2_BUCKET=`, `B2_S3_ENDPOINT=`) at /etc/uploader/ops.conf and host.env (`POLY_INSTANCE=`) at /etc/uploader/host.env.
//  - The credential is /run/secrets/backup_store_credential: line 1 the key id, line 2 the application key.
import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INSTANCE, PROJECT, ROOT, S3_HOST, TOOLS, sh, type Res, type Stack } from './stack.ts';

export const UP = '/usr/local/bin/upload.sh';
export type Fake = {
  name: string; nativeUrl: string;
  ctl: (path: string, o?: { post?: boolean; file?: string }) => string;
  mode: (m: 'pass' | 'etag' | 'refuse' | '5xx' | 'permissive' | 'slow', delay?: number) => void;
  log: () => string[];
  store: () => Record<string, Array<{ fileId: string; fileName: string; action: string; uploadTimestamp: number; contentLength: number; sha256: string }>>;
  object: (fileId: string) => Buffer;
  reset: () => void;
  stop: () => void;
};

export function startFake(s: Stack): Fake {
  const name = `${PROJECT}-b2`;
  sh('docker', ['rm', '-f', name]);
  const net = `${PROJECT}_upload-net`;
  const mk = s.compose('create', '--no-recreate', 'uploader');
  if (mk.code !== 0) throw new Error(`compose create uploader failed: ${mk.err.slice(-500)}`);
  const r = sh('docker', ['run', '-d', '--name', name, '--network', net, '--network-alias', S3_HOST, '-p', '127.0.0.1::8080',
    '-v', `${join(s.dir, 'pki')}:/pki:ro`, '-v', `${join(ROOT, 'tests', 'infra', 'backup', 'fake_b2.py')}:/harness/fake_b2.py:ro`,
    '--entrypoint', 'python3', TOOLS, '/harness/fake_b2.py', '/pki/srv.crt', '/pki/srv.key']);
  if (r.code !== 0) throw new Error(`fake-b2 start failed: ${r.err}`);
  const port = sh('docker', ['port', name, '8080/tcp']).out.trim().split('\n')[0]!.split(':').pop()!;
  const f = makeFake(name, `http://127.0.0.1:${port}`);
  for (let i = 0; i < 40; i++) { if (f.ctl('log').startsWith('[')) break; sh('sleep', ['0.5']); if (i === 39) throw new Error(`fake-b2 not ready: ${sh('docker', ['logs', name]).err.slice(-400)}`); }
  return f;
}

function makeFake(name: string, nativeUrl: string): Fake {
  const ctl: Fake['ctl'] = (path, o = {}) => {
    const args = ['exec', name, 'curl', '-s', '--max-time', '20', ...(o.post ? ['-X', 'POST'] : []), ...(o.file ? ['--data-binary', `@${o.file}`] : []), `http://127.0.0.1:8080/_fake/${path}`];
    return sh('docker', args).out;
  };
  return {
    name, nativeUrl, ctl,
    mode: (m, delay = 0) => { ctl(`mode?v=${m}&delay=${delay}`); },
    log: () => JSON.parse(ctl('log')) as string[],
    store: () => JSON.parse(ctl('store')),
    object: (fileId) => {
      const r2 = sh('docker', ['exec', name, 'sh', '-c', `curl -s http://127.0.0.1:8080/_fake/object?fileId=${fileId} | base64`]);
      return Buffer.from(r2.out.replace(/\s/g, ''), 'base64');
    },
    reset: () => { ctl('reset'); },
    stop: () => { sh('docker', ['rm', '-f', name]); },
  };
}

/** a spool file: real age ciphertext of `plain` (default 2 KB of random bytes) to the stack's recipient, or `raw` bytes as given */
export function plantSpool(s: Stack, dir: 'wal' | 'dump' | 'premigration', name: string, o: { raw?: string; plain?: string; owner?: string } = {}) {
  const body = o.raw !== undefined ? `printf '%s' '${o.raw.replace(/'/g, "'\\''")}' > '/s/${dir}/${name}'`
    : o.plain !== undefined ? `printf '%s' '${o.plain}' | age -r $RCPT -o '/s/${dir}/${name}'`
      : `head -c 2048 /dev/urandom | age -r $RCPT -o '/s/${dir}/${name}'`;
  const r = s.tools(`export RCPT=${s.recipient.trim()}; ${body}; chown ${o.owner ?? '10004:10004'} '/s/${dir}/${name}'`);
  if (r.code !== 0) throw new Error(`plant ${dir}/${name} failed: ${r.err}`);
}
export const walName = (s: Stack, seg: string) => `wal-${s.major}-${s.sys}-${seg}.age`;
export const setName = (s: Stack, kind: 'base' | 'dump' | 'globals', ts: string) => `${kind}-${s.major}-${s.sys}-${ts}.age`;
export const sha256Of = (s: Stack, path: string) => s.tools(`sha256sum ${path} | cut -d' ' -f1`, { rw: false }).out.trim();

/** rewrite ops.conf / host.env / the credential on the host side (the uploader mounts them read-only) */
export function writeConf(s: Stack, file: 'ops.conf' | 'host.env', content: string) {
  const p = join(s.dir, 'etc', 'polycarpic', file);
  writeFileSync(p, content); chmodSync(p, 0o644);
}

export type URun = Res;
/** run the rendered uploader service once. `mutant` replaces the script with a mutant copy (run through bash -c, same image, user, mounts). */
export function runUploader(s: Stack, o: { mutant?: string; env?: Record<string, string>; extra?: string[] } = {}): URun {
  const envArgs = Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const base = ['run', '--rm', '--no-deps', '-T', ...envArgs, ...(o.extra ?? [])];
  return o.mutant !== undefined
    ? s.compose(...base, '--entrypoint', 'bash', 'uploader', '-c', o.mutant, 'upload.sh')
    : s.compose(...base, 'uploader', UP);
}
export function verifiedLines(out: string): string[][] {
  return out.split('\n').filter((l) => l.trim()).map((l) => l.split(' '));
}

/** start the uploader detached, hand `during` a handle to exec into it, then wait for the exit code */
export async function uploaderDuring(s: Stack, during: (exec: (...argv: string[]) => Res) => void, o: { env?: Record<string, string> } = {}): Promise<{ code: number; out: string; err: string }> {
  const name = `${PROJECT}-up`;
  sh('docker', ['rm', '-f', name]);
  const envArgs = Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const child = spawn('docker', ['compose', '-p', PROJECT, ...composeFiles(s), 'run', '--rm', '--no-deps', '-T', '--name', name, ...envArgs, 'uploader', UP], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...s.env } });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  const done = new Promise<number>((res) => child.on('close', (c) => res(c ?? 127)));
  for (let i = 0; i < 60; i++) { if (sh('docker', ['ps', '-q', '-f', `name=${name}`]).out.trim()) break; await new Promise((r) => setTimeout(r, 250)); }
  during((...argv) => sh('docker', ['exec', name, ...argv]));
  const code = await done;
  return { code, out, err };
}
const composeFiles = (s: Stack) => ['-f', join(ROOT, 'infra', 'compose', 'prod.yml'), '-f', join(s.dir, 'override.yml')];
export { INSTANCE };

/** Attach to the fake-b2 the globalSetup started (POLY99_FAKE names its container and native URL). */
export function attachFake(): Fake {
  const { name, nativeUrl } = JSON.parse(readFileSync(process.env.POLY99_FAKE!, 'utf8')) as { name: string; nativeUrl: string };
  const f = makeFake(name, nativeUrl);
  // The host must reach the fake's native half through the published loopback port (restore.sh and drill.sh do). Fail setup with the facts, not later with an empty body.
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) { ok = sh('curl', ['-s', '-m', '5', '-o', '/dev/null', '-w', '%{http_code}', `${nativeUrl}/_fake/log`]).out === '200'; if (!ok) sh('sleep', ['1']); }
  if (!ok) {
    const port = sh('docker', ['port', name]).out.trim();
    const nets = sh('docker', ['inspect', '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', name]).out.trim();
    throw new Error(`fake-b2 is not reachable from the host at ${nativeUrl} (docker port: ${port || 'none'}; networks: ${nets || 'none'}). Something detached or re-attached the shared fake (on Linux that moves the published port).`);
  }
  return f;
}
