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
// One stack for the whole suite (architect, ruling Guards @ 2bf5a6ba): the globalSetup brings it up and exports its name; every file attaches.
export const PROJECT = process.env.POLY99_PROJECT ?? `poly99qa${process.pid}`;

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
  dir: string; env: Record<string, string>; cfg: any; canary: string; sys: string; major: string; identity: string; recipient: string; info: StackInfo;
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
  const label = `label=com.docker.compose.project=${PROJECT}`;
  const ids = sh('docker', ['ps', '-aq', '--filter', label]).out.split('\n').filter(Boolean);
  if (ids.length) sh('docker', ['rm', '-f', '-v', ...ids]);
  const nets = sh('docker', ['network', 'ls', '-q', '--filter', label]).out.split('\n').filter(Boolean);
  if (nets.length) sh('docker', ['network', 'rm', ...nets]);
  sh('docker', ['rm', '-f', `${PROJECT}-b2`, `${PROJECT}-up`]);
  for (const d of DIRS) sh('docker', ['volume', 'rm', '-f', `${PROJECT}-${d}`]);
}

/** uploader: true builds infra/backup/tools.Dockerfile; 'stub' uses qa's own tools image (harness self-tests of fake-b2 that need no uploader). */
export type UpOpts = { uploader?: boolean | 'stub' };
export const TOOLS_UP = 'poly99-tools-up:test';
export const INSTANCE = 'poly-test';
export const BUCKET = 'poly-test-bucket';
export const S3_HOST = 's3.eu-fake-001.backblazeb2.com';
export const KEY_ID = '0049fixturekeyid0000000001';
export const APP_KEY = 'K004FIXTUREAPPLICATIONKEY00000000000';

export function up(opts: UpOpts = {}): Stack {
  for (const [tag, ctx] of [[IMG, join(ROOT, 'infra', 'postgres')], [TOOLS, join(ROOT, 'tests', 'infra', 'backup', 'tools')]] as const) {
    const b = sh('docker', ['build', '-q', '-t', tag, ctx]);
    if (b.code !== 0) throw new Error(`docker build ${ctx} failed: ${b.err.slice(-500)}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'poly99-stack-'));
  chmodSync(dir, 0o755);
  const env: Record<string, string> = { POLY_POSTGRES_IMAGE: IMG, POLY_BIND_ADDR: '127.0.0.1', POLY_APP_IMAGE: 'ghcr.io/richmosko/polycarpic@sha256:' + '1'.repeat(64), POLY_TOOLS_IMAGE: 'ghcr.io/richmosko/polycarpic-tools@sha256:' + '2'.repeat(64), POLY_CADDY_IMAGE: 'ghcr.io/richmosko/polycarpic-caddy@sha256:' + '3'.repeat(64) }; // POLY-100: every image variable is required
  if (opts.uploader === 'stub') env.POLY_TOOLS_IMAGE = TOOLS;
  else if (opts.uploader) {
    // R4: the tools image is built here from infra/backup/tools.Dockerfile (context infra/backup); build.yml publishes it in POLY-100.
    const b = sh('docker', ['build', '-q', '-t', TOOLS_UP, '-f', join(ROOT, 'infra', 'backup', 'tools.Dockerfile'), join(ROOT, 'infra', 'backup')]);
    if (b.code !== 0) throw new Error(`docker build infra/backup/tools.Dockerfile failed: ${b.err.slice(-600)}`);
    env.POLY_TOOLS_IMAGE = TOOLS_UP;
  }
  const base = join(ROOT, 'infra', 'compose', 'prod.yml');
  const rendered = sh('docker', ['compose', '-f', base, '--profile', 'backup', '--profile', 'uploader', 'config', '--no-env-resolution', '--format', 'json'], { env });
  if (rendered.code !== 0) throw new Error(`compose config failed: ${rendered.err.slice(-500)}`);
  const cfg = JSON.parse(rendered.out) as any;
  const vol = (d: Dir) => `${PROJECT}-${d}`;
  for (const d of DIRS) sh('docker', ['volume', 'create', vol(d)]);

  const rootRun = (script: string) => sh('docker', ['run', '--rm', '-v', `${dir}:/w`, '--entrypoint', 'sh', IMG, '-c', script]);
  const keygen = sh('docker', ['run', '--rm', '--entrypoint', 'age-keygen', IMG]);
  if (keygen.code !== 0) throw new Error(`age-keygen not in the image: ${keygen.err}`);
  const identity = keygen.out + '\n';
  const recipient = sh('docker', ['run', '--rm', '-i', '--entrypoint', 'age-keygen', IMG, '-y'], { input: identity }).out.trim() + '\n';

  // the fake's CA and server certificate, made at run time (R11); the uploader's CA bundle is replaced by this CA alone
  mkdirSync(join(dir, 'pki'), { recursive: true });
  const pki = sh('docker', ['run', '--rm', '-v', `${join(dir, 'pki')}:/pki`, '-w', '/pki', '--entrypoint', 'bash', TOOLS, '-c', [
    'set -e',
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj /CN=poly99-test-ca 2>/dev/null',
    `openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj /CN=${S3_HOST} 2>/dev/null`,
    `printf 'subjectAltName=DNS:${S3_HOST}' > ext`,
    'openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out srv.crt -days 2 -extfile ext 2>/dev/null',
    'chmod 0644 *.crt *.key',
  ].join('\n')]);
  if (pki.code !== 0) throw new Error(`pki failed: ${pki.err}`);
  const redirect = (p: string) => join(dir, p.replace(/^\//, ''));
  const SERVICES = ['postgres', 'backup', 'uploader'].filter((s) => cfg.services[s]);
  const ov: any = { services: {}, secrets: {}, volumes: {} };
  for (const d of DIRS) ov.volumes[vol(d)] = { external: true, name: vol(d) };
  for (const s of SERVICES) {
    const vols: any[] = [];
    for (const v of cfg.services[s].volumes ?? []) {
      if (v.type !== 'bind' || !/^\/(srv|etc)\/polycarpic/.test(v.source)) {
        if (s === 'uploader') vols.push(v.type === 'bind' ? { type: 'bind', source: v.source, target: v.target, read_only: !!v.read_only } : v); // its list is replaced whole (!override)
        continue;
      }
      const ro = !!v.read_only;
      const m = /^\/srv\/polycarpic\/spool(?:\/(wal|dump|premigration))?$/.exec(v.source);
      if (m) {
        if (m[1]) vols.push({ type: 'volume', source: vol(m[1] as Dir), target: v.target, read_only: ro });
        else for (const d of DIRS) vols.push({ type: 'volume', source: vol(d), target: `${v.target}/${d}`, read_only: ro });
        continue;
      }
      const src = redirect(v.source);
      if (/age/.test(v.source)) { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, recipient); chmodSync(src, 0o644); }
      else if (/ops\.conf$/.test(v.source)) { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=https://${S3_HOST}\n`); chmodSync(src, 0o644); }
      else if (/host\.env$/.test(v.source)) { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, `POLY_INSTANCE=${INSTANCE}\n`); chmodSync(src, 0o644); }
      else mkdirSync(src, { recursive: true });
      vols.push({ type: 'bind', source: src, target: v.target, read_only: ro });
    }
    if (s === 'uploader') vols.push({ type: 'bind', source: join(dir, 'pki', 'ca.crt'), target: '/etc/ssl/certs/ca-certificates.crt', read_only: true });
    ov.services[s] = { volumes: vols };
  }
  const secretsDir = join(dir, 'etc', 'polycarpic', 'secrets');
  const chowns: string[] = [];
  const seen = new Set<string>();
  for (const [key, def] of Object.entries<any>(cfg.secrets ?? {})) {
    if (!def.file) continue;
    const f = redirect(def.file);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, key.startsWith('backup_store_credential') ? `${KEY_ID}\n${APP_KEY}\n` : `qa-${key}-fixture\n`);
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
  // The uploader's base mount is the whole spool at /spool (one target); three volume mounts at /spool/<dir> would sit beside it and Docker
  // Desktop refuses the host path. `!override` makes the list replace the base list instead of merging by target.
  // POLY-100 R11: the five app services read /etc/polycarpic host and mail env files; a harness has none and starts none of them, so its override drops the lists
  for (const s of ['web', 'auth', 'worker', 'migrate', 'operator']) (ov.services[s] ??= {}).env_file = '__RESET__';
  let ovText = stringify(ov).replace(/'__RESET__'|__RESET__/g, '!reset []');
  if (ov.services.uploader) ovText = ovText.replace(/(\n {2}uploader:\n {4}volumes:)/, '$1 !override');
  writeFileSync(ovFile, ovText);
  rootRun(['chown -R 999:999 /w/srv && chmod -R u+rwX /w/srv', ...chowns].join(' && '));

  const info: StackInfo = { dir, env, cfg, identity, recipient, canary: '', sys: '', major: '' };
  const s = makeStack(info, true);
  const sp = s.tools(SPOOL_SETUP);
  if (sp.code !== 0) throw new Error(`spool setup failed: ${sp.err}`);
  const u = s.compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  if (u.code !== 0) throw new Error(`compose up postgres failed: ${u.err.slice(-800)}`);
  const superSql = s.superSql;
  superSql('CREATE DATABASE polycarpic', 'postgres');
  const rr = sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { env, input: readFileSync(join(ROOT, 'packages', 'db', 'sql', 'roles.sql'), 'utf8') });
  if (rr.code !== 0) throw new Error(`roles.sql failed: ${rr.err.slice(-600)}`);
  // The real migration chain (architect, ruling R11 correction): each file in journal order as poly_owner, one transaction per file, after the drizzle schema and
  // tracking table exist. DR7 (real FORCE-RLS tables), DR8 (public.session and app.session_handle) and INFRA's F4 then run on real tables.
  superSql('CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION poly_owner; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint); ALTER TABLE drizzle.__drizzle_migrations OWNER TO poly_owner');
  const mig = join(ROOT, 'packages', 'db', 'migrations');
  const journal = JSON.parse(readFileSync(join(mig, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const e of journal.entries) {
    const r = sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', '-'],
      { env, input: `SET ROLE poly_owner;\n${readFileSync(join(mig, `${e.tag}.sql`), 'utf8')}\n` });
    if (r.code !== 0) throw new Error(`migration ${e.tag} failed: ${r.err.slice(-500)}`);
  }
  const pw = 'qa-db_password_backup__backup-fixture'; // the fixture value written above (the file is root:10004 0440 by now)
  superSql(`SET password_encryption='scram-sha-256'; ALTER ROLE poly_backup PASSWORD '${pw}'`);
  const canary = `CANARY-${randomBytes(12).toString('hex')}`;
  superSql(`CREATE TABLE public.canary_t (v text); ALTER TABLE public.canary_t ENABLE ROW LEVEL SECURITY; ALTER TABLE public.canary_t FORCE ROW LEVEL SECURITY; CREATE POLICY p ON public.canary_t USING (true); INSERT INTO public.canary_t VALUES ('${canary}'); GRANT SELECT ON public.canary_t TO poly_backup`);
  // C1: the scratch dump must exceed 1 MiB (the backup container's /tmp cap) or a /tmp detour would fit and stay invisible: 6 MiB of random hex
  superSql("CREATE TABLE public.pad_t (g int, v text); INSERT INTO public.pad_t SELECT g, string_agg(md5(random()::text || g || i), '') FROM generate_series(1, 6) g, generate_series(1, 32768) i GROUP BY g; GRANT SELECT ON public.pad_t TO poly_backup");
  // one session with its handle (the deferred constraint wants the handle in the same transaction): DR8 counts it
  superSql("WITH u AS (INSERT INTO public.\"user\" (name, email) VALUES ('qa', 'qa@example.test') RETURNING id), s AS (INSERT INTO public.session (expires_at, token, updated_at, user_id) SELECT now() + interval '1 day', 'qa-token-' || md5(random()::text), now(), id FROM u RETURNING id) INSERT INTO app.session_handle (session_id, handle_hash) SELECT id, sha256('qa-handle'::bytea) FROM s");
  info.canary = canary;
  info.sys = superSql('SELECT system_identifier FROM pg_control_system()');
  info.major = superSql("SELECT current_setting('server_version_num')::int / 10000");
  s.canary = info.canary; s.sys = info.sys; s.major = info.major;
  return s;
}

export type StackInfo = { dir: string; env: Record<string, string>; cfg: any; identity: string; recipient: string; canary: string; sys: string; major: string };

/** The spool as POLY-99 provisions it (R10, C3). 10004 owns dump/ and premigration/; 10005 has r-x, never write. */
const SPOOL_SETUP = [
  'set -e',
  'chown 999:999 /s/wal && chmod 0700 /s/wal && setfacl -m u:10005:r-x /s/wal && setfacl -d -m u::rwx,g::---,o::---,u:10005:r-x /s/wal',
  'for d in dump premigration; do',
  '  chown 10004:10004 /s/$d && chmod 0700 /s/$d',
  '  setfacl -m u:10005:r-x /s/$d && setfacl -d -m u::rwx,g::---,o::---,u:10005:r-x /s/$d',
  '  mkdir -p /s/$d/.inflight && chown 10004:10004 /s/$d/.inflight && chmod 0700 /s/$d/.inflight',
  '  setfacl -x u:10005 /s/$d/.inflight && setfacl -d -m u::rwx,g::---,o::---,u:10005:r-- /s/$d/.inflight',
  'done',
].join('\n');

/** Attach to the stack the globalSetup brought up (its facts are in the file named by POLY99_INFO). `down` leaves the stack to the globalSetup. */
export function attach(): Stack {
  const info = JSON.parse(readFileSync(process.env.POLY99_INFO!, 'utf8')) as StackInfo;
  return makeStack(info, false);
}

function makeStack(info: StackInfo, owner: boolean): Stack {
  const { dir, env, cfg, identity, recipient } = info;
  const base = join(ROOT, 'infra', 'compose', 'prod.yml');
  const ovFile = join(dir, 'override.yml');
  const vol = (d: Dir) => `${PROJECT}-${d}`;
  const rootRun = (script: string) => sh('docker', ['run', '--rm', '-v', `${dir}:/w`, '--entrypoint', 'sh', IMG, '-c', script]);
  const tools = (script: string, o: { rw?: boolean; input?: string } = {}) =>
    sh('docker', ['run', '--rm', '-i', ...DIRS.flatMap((d) => ['-v', `${vol(d)}:/s/${d}${o.rw === false ? ':ro' : ''}`]), '--entrypoint', 'bash', TOOLS, '-c', script], { input: o.input });
  const compose = (...a: string[]) => sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, ...a], { env });
  const superSql = (sql: string, db = 'polycarpic') => {
    const r = compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', db, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql);
    if (r.code !== 0) throw new Error(r.err || r.out);
    return r.out.trim();
  };
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
    const r = sh('docker', ['run', '-d', '--name', W, '--pid', `container:${backupName}`, '--cap-add', 'SYS_PTRACE', '--security-opt', 'apparmor=unconfined', '-e', `CANARY=${info.canary}`,
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
    dir, env, cfg, canary: info.canary, sys: info.sys, major: info.major, identity, recipient, info, vol, compose, superSql, tools, ls, clearSpool, runBackup, startBackupContainer, watch,
    down: () => {
      sh('docker', ['rm', '-f', BK, `${PROJECT}-watch`]);
      if (!owner) return; // the globalSetup owns the stack
      compose('--profile', '*', 'down', '-v', '--remove-orphans');
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
  const out = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to); // a string mutates EVERY occurrence (each rclone call)
  if (out === text) throw new Error(`mutant did not change the script: ${String(from)}`);
  return out;
}
