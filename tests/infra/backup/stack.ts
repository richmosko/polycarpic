// POLY-99 R11 scratch stack. The REAL `postgres` and `backup` services of infra/compose/prod.yml (same mounts, same user, same
// networks, same tmpfs, same command), with only image refs and host paths redirected by a generated override file. Nothing
// here fakes the script under test.
//
// CONTRACT pinned here (ruling R1, R10, R11 plus qa's pins P1-P8 in process/cairn/reviews/POLY-99/test-plan.md):
//  - Spool: three named Docker volumes stand for /srv/polycarpic/spool/{wal,dump,premigration} (Docker Desktop's bind mounts
//    do not carry POSIX ACLs; a volume does). The ACLs are the post-POLY-99 target: dump/ and premigration/ owner 10004 0700,
//    access and default `u:10005:r-x`; `.inflight/` in each with default `u:10005:r--` and NO access entry for 10005 (C3).
//  - The backup container is started as `sleep` from the rendered service (same user, mounts, tmpfs, networks) and the script is
//    run in it with `docker exec`; that is what lets the watcher see the container's own /tmp (a tmpfs no other container can
//    mount). The exec runs as the service's user with the service's environment.
//  - The passfile is /tmp/pgpass (P2); it is the only file that may appear in the backup container's /tmp.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stringify } from 'yaml';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const IMG = 'poly99-pg:test';
export const TOOLS = 'poly99-tools:test';
export const PROJECT = `poly99qa${process.pid}`;

export type Res = { code: number; out: string; err: string };
export function sh(cmd: string, args: string[], o: { input?: string; env?: Record<string, string>; timeout?: number } = {}): Res {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: o.input, env: { ...process.env, ...(o.env ?? {}) }, timeout: o.timeout ?? 300_000, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? 127, out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

export const DIRS = ['wal', 'dump', 'premigration'] as const;
export type Dir = (typeof DIRS)[number];
export const R2_DUMP = /^(base|dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age$/;
export const AGE_HEADER = 'age-encryption.org/v1';

export type Stack = {
  dir: string; cfg: any; canary: string; sys: string; major: string; identity: string; recipient: string;
  vol: (d: Dir) => string;
  compose: (...a: string[]) => Res;
  superSql: (sql: string, db?: string) => string;
  tools: (script: string, o?: { rw?: boolean; input?: string }) => Res;
  ls: (d: Dir, hidden?: boolean) => string[];
  clearSpool: () => void;
  /** Start the backup service container (idle), a watcher on the spool and the container's /tmp, run `argv` in it, stop both. */
  runBackup: (argv: string[], o?: { env?: Record<string, string>; script?: string; stopPg?: (name: string) => void }) => { res: Res; events: string[]; verdicts: string[] };
  startBackupContainer: () => string;
  watch: (backupName?: string) => { stop: () => string[] };
  down: () => void;
};

/** Best-effort removal of everything this process's stack made; safe to call when setup failed half-way. */
export function teardown() {
  sh('docker', ['rm', '-f', `${PROJECT}-bk`, `${PROJECT}-watch`]);
  sh('docker', ['compose', '-p', PROJECT, 'down', '-v', '--remove-orphans'], { env: { POLY_POSTGRES_IMAGE: IMG } });
  for (const d of DIRS) sh('docker', ['volume', 'rm', '-f', `${PROJECT}-${d}`]);
}

export function up(): Stack {
  for (const [tag, ctx] of [[IMG, join(ROOT, 'infra', 'postgres')], [TOOLS, join(ROOT, 'tests', 'infra', 'backup', 'tools')]] as const) {
    const b = sh('docker', ['build', '-q', '-t', tag, ctx]);
    if (b.code !== 0) throw new Error(`docker build ${ctx} failed: ${b.err.slice(-500)}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'poly99-stack-'));
  chmodSync(dir, 0o755);
  const env = { POLY_POSTGRES_IMAGE: IMG, POLY_BIND_ADDR: '127.0.0.1' };
  const base = join(ROOT, 'infra', 'compose', 'prod.yml');
  const rendered = sh('docker', ['compose', '-f', base, '--profile', 'backup', '--profile', 'uploader', 'config', '--format', 'json'], { env });
  if (rendered.code !== 0) throw new Error(`compose config failed: ${rendered.err.slice(-500)}`);
  const cfg = JSON.parse(rendered.out) as any;
  const vol = (d: Dir) => `${PROJECT}-${d}`;
  for (const d of DIRS) sh('docker', ['volume', 'create', vol(d)]);

  const rootRun = (script: string) => sh('docker', ['run', '--rm', '-v', `${dir}:/w`, '--entrypoint', 'sh', IMG, '-c', script]);
  const keygen = sh('docker', ['run', '--rm', '--entrypoint', 'age-keygen', IMG]);
  if (keygen.code !== 0) throw new Error(`age-keygen not in the image: ${keygen.err}`);
  const identity = keygen.out + '\n';
  const recipient = sh('docker', ['run', '--rm', '-i', '--entrypoint', 'age-keygen', IMG, '-y'], { input: identity }).out.trim() + '\n';

  const redirect = (p: string) => join(dir, p.replace(/^\//, ''));
  const SERVICES = ['postgres', 'backup', 'uploader'].filter((s) => cfg.services[s]);
  const ov: any = { services: {}, secrets: {}, volumes: {} };
  for (const d of DIRS) ov.volumes[vol(d)] = { external: true, name: vol(d) };
  for (const s of SERVICES) {
    const vols: any[] = [];
    for (const v of cfg.services[s].volumes ?? []) {
      if (v.type !== 'bind' || !/^\/(srv|etc)\/polycarpic/.test(v.source)) continue;
      const ro = !!v.read_only;
      const m = /^\/srv\/polycarpic\/spool(?:\/(wal|dump|premigration))?$/.exec(v.source);
      if (m) {
        if (m[1]) vols.push({ type: 'volume', source: vol(m[1] as Dir), target: v.target, read_only: ro });
        else for (const d of DIRS) vols.push({ type: 'volume', source: vol(d), target: `${v.target}/${d}`, read_only: ro });
        continue;
      }
      const src = redirect(v.source);
      if (/age/.test(v.source)) { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, recipient); chmodSync(src, 0o644); }
      else mkdirSync(src, { recursive: true });
      vols.push({ type: 'bind', source: src, target: v.target, read_only: ro });
    }
    ov.services[s] = { volumes: vols };
  }
  const secretsDir = join(dir, 'etc', 'polycarpic', 'secrets');
  const chowns: string[] = [];
  const seen = new Set<string>();
  for (const [key, def] of Object.entries<any>(cfg.secrets ?? {})) {
    if (!def.file) continue;
    const f = redirect(def.file);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `qa-${key}-fixture\n`);
    ov.secrets[key] = { file: f };
    const svc = def.file.split('/').slice(-2)[0] as string;
    const gid = String(cfg.services[svc]?.user ?? '').split(':')[1];
    if (gid && !seen.has(svc)) {
      seen.add(svc);
      const d = `/w/etc/polycarpic/secrets/${svc}`;
      chowns.push(`chown -R 0:${gid} ${d} && chmod 0750 ${d} && chmod 0440 ${d}/*`);
    }
  }
  const ovFile = join(dir, 'override.yml');
  writeFileSync(ovFile, stringify(ov));
  rootRun(['chown -R 999:999 /w/srv && chmod -R u+rwX /w/srv', ...chowns].join(' && '));

  const tools = (script: string, o: { rw?: boolean; input?: string } = {}) =>
    sh('docker', ['run', '--rm', '-i', ...DIRS.flatMap((d) => ['-v', `${vol(d)}:/s/${d}${o.rw === false ? ':ro' : ''}`]), '--entrypoint', 'bash', TOOLS, '-c', script], { input: o.input });
  // The spool as POLY-99 provisions it (R10, C3). 10004 owns dump/ and premigration/; 10005 has r-x, never write.
  const spoolSetup = [
    'set -e',
    'chown 999:999 /s/wal && chmod 0700 /s/wal',
    'for d in dump premigration; do',
    '  chown 10004:10004 /s/$d && chmod 0700 /s/$d',
    '  setfacl -m u:10005:r-x /s/$d && setfacl -d -m u::rwx,g::---,o::---,u:10005:r-x /s/$d',
    '  mkdir -p /s/$d/.inflight && chown 10004:10004 /s/$d/.inflight && chmod 0700 /s/$d/.inflight',
    '  setfacl -x u:10005 /s/$d/.inflight && setfacl -d -m u::rwx,g::---,o::---,u:10005:r-- /s/$d/.inflight',
    'done',
  ].join('\n');
  const sp = tools(spoolSetup);
  if (sp.code !== 0) throw new Error(`spool setup failed: ${sp.err}`);

  const compose = (...a: string[]) => sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, ...a], { env });
  const u = compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  if (u.code !== 0) throw new Error(`compose up postgres failed: ${u.err.slice(-800)}`);
  const superSql = (sql: string, db = 'polycarpic') => {
    const r = compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', db, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql);
    if (r.code !== 0) throw new Error(r.err || r.out);
    return r.out.trim();
  };
  superSql('CREATE DATABASE polycarpic', 'postgres');
  const rr = sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { env, input: readFileSync(join(ROOT, 'packages', 'db', 'sql', 'roles.sql'), 'utf8') });
  if (rr.code !== 0) throw new Error(`roles.sql failed: ${rr.err.slice(-600)}`);
  const pw = 'qa-db_password_backup__backup-fixture'; // the fixture value written above (the file is root:10004 0440 by now)
  superSql(`SET password_encryption='scram-sha-256'; ALTER ROLE poly_backup PASSWORD '${pw}'`);
  const canary = `CANARY-${randomBytes(12).toString('hex')}`;
  superSql(`CREATE TABLE public.canary_t (v text); ALTER TABLE public.canary_t ENABLE ROW LEVEL SECURITY; ALTER TABLE public.canary_t FORCE ROW LEVEL SECURITY; CREATE POLICY p ON public.canary_t USING (true); INSERT INTO public.canary_t VALUES ('${canary}'); GRANT SELECT ON public.canary_t TO poly_backup`);
  const sys = superSql('SELECT system_identifier FROM pg_control_system()');
  const major = superSql("SELECT current_setting('server_version_num')::int / 10000");

  const ls = (d: Dir, hidden = false) => {
    const r = tools(`ls -A /s/${d}${hidden ? '/.inflight' : ''}`, { rw: false });
    return r.out.split('\n').map((x) => x.trim()).filter((x) => x && (hidden || x !== '.inflight'));
  };
  const clearSpool = () => { tools('for d in dump premigration wal; do find /s/$d -mindepth 1 ! -name .inflight -delete; find /s/$d/.inflight -mindepth 1 -delete 2>/dev/null; done; true'); };

  const BK = `${PROJECT}-bk`;
  const startBackupContainer = () => {
    sh('docker', ['rm', '-f', BK]);
    const r = compose('run', '-d', '--no-deps', '--name', BK, '--entrypoint', 'sleep', 'backup', '3600');
    if (r.code !== 0) throw new Error(`backup container start failed: ${r.err.slice(-600)}`);
    return BK;
  };
  const watch = (backupName = BK) => {
    const W = `${PROJECT}-watch`;
    sh('docker', ['rm', '-f', W]);
    const r = sh('docker', ['run', '-d', '--name', W, '--pid', `container:${backupName}`, '--cap-add', 'SYS_PTRACE', '--security-opt', 'apparmor=unconfined', '-e', `CANARY=${canary}`,
      ...DIRS.flatMap((d) => ['-v', `${vol(d)}:/spool/${d}:ro`]), '--entrypoint', '/harness/watcher.sh', TOOLS, '/spool/wal', '/spool/dump', '/spool/premigration', '/proc/1/root/tmp']);
    if (r.code !== 0) throw new Error(`watcher start failed: ${r.err}`);
    for (let i = 0; i < 60; i++) {
      if (/Watches established/.test(sh('docker', ['logs', W]).out)) break;
      if (i === 59) throw new Error(`watcher not ready: ${sh('docker', ['logs', W]).out.slice(-400)}`);
      sh('sleep', ['0.5']);
    }
    return {
      stop: () => {
        sh('sleep', ['1.5']);
        const l = sh('docker', ['logs', W]);
        sh('docker', ['rm', '-f', W]);
        return (l.out + l.err).split('\n').filter(Boolean);
      },
    };
  };
  const runBackup: Stack['runBackup'] = (argv, o = {}) => {
    const name = startBackupContainer();
    const w = watch(name);
    const envArgs = Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const res = sh('docker', ['exec', ...envArgs, name, ...(o.script ? ['bash', '-c', o.script] : argv)]);
    const lines = w.stop();
    sh('docker', ['rm', '-f', name]);
    return { res, events: lines.filter((l) => l.startsWith('EV ')), verdicts: lines.filter((l) => l.startsWith('CLOSED ')) };
  };

  return {
    dir, cfg, canary, sys, major, identity, recipient, vol, compose, superSql, tools, ls, clearSpool, runBackup, startBackupContainer, watch,
    down: () => {
      sh('docker', ['rm', '-f', BK, `${PROJECT}-watch`]);
      compose('down', '-v', '--remove-orphans');
      rootRun('rm -rf /w/* 2>/dev/null; true');
      for (const d of DIRS) sh('docker', ['volume', 'rm', '-f', vol(d)]);
    },
  };
}

/** argv that runs script `text` inside container `name` as the exec user: `bash -c <text> backup.sh <args>`. No stdin is used (a
 * synchronous helper elsewhere in a test would starve an async stdin write), and `input` stays '' for callers that pass it on. */
export function execText(name: string, text: string, args: string[], env: Record<string, string> = {}) {
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return { argv: ['exec', ...e, name, 'bash', '-c', text, 'backup.sh', ...args], input: '' };
}
/** the host path of the recipients file the backup service mounts (tests rewrite it between runs) */
export const recipientsPath = (dir: string) => join(dir, 'etc', 'polycarpic', 'age-recipients.txt');
export const pgContainer = () => `${PROJECT}-postgres-1`;
export const BACKUP_SH = join(ROOT, 'infra', 'backup', 'backup.sh');
/** a mutant copy of a script under test: `from` must occur, or the mutant would silently equal the original */
export function mutate(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`mutant did not change the script: ${String(from)}`);
  return out;
}
