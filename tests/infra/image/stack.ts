// POLY-95 R5/R6/R8 harness: bring up the REAL `postgres` service of infra/compose/prod.yml (same mounts, same command,
// never -c flags), with only host paths redirected into a temp dir by a generated override file.
//
// CONTRACT pinned here (from the ruling; the builder may not rename without a ruling addendum):
//  - docker build context infra/postgres/ (Dockerfile at its root) produces the Postgres+age image; the test passes
//    it to compose as POLY_POSTGRES_IMAGE.
//  - prod.yml's `postgres` service reads secret db_superuser_password at /run/secrets/db_superuser_password, runs as
//    999:999, and bind-mounts host paths under /srv/polycarpic/ (data, spool/wal) and /etc/polycarpic/ (age recipients;
//    a source whose basename contains "age" is the recipients file). Everything else it mounts is repo-relative.
//  - `SHOW archive_command` is `<script> %p %f`; the script is run as the server runs it.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const IMG = 'poly95-pg:test';
export const PROJECT = `poly95qa${process.pid}`;

export function sh(cmd: string, args: string[], o: { input?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: o.input, env: { ...process.env, ...(o.env ?? {}) }, timeout: 240_000 });
  return { code: r.status ?? 127, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

export type Stack = {
  dir: string; spool: string; secretsDir: string; identity: string; recipient: string; cfg: any;
  compose: (...a: string[]) => ReturnType<typeof sh>;
  psql: (sql: string) => string;
  exec: (...a: string[]) => ReturnType<typeof sh>;
  root: (script: string) => ReturnType<typeof sh>;
  down: () => void;
};

export function up(): Stack {
  const b = sh('docker', ['build', '-t', IMG, join(ROOT, 'infra', 'postgres')]);
  if (b.code !== 0) throw new Error(`docker build infra/postgres failed: ${b.err.slice(-500)}`);
  const dir = mkdtempSync(join(tmpdir(), 'poly95-stack-'));
  chmodSync(dir, 0o755);
  const env = { POLY_POSTGRES_IMAGE: IMG, POLY_BIND_ADDR: '127.0.0.1' };
  const base = join(ROOT, 'infra', 'compose', 'prod.yml');
  const cfg = JSON.parse(sh('docker', ['compose', '-f', base, 'config', '--format', 'json'], { env }).out) as any;
  const pg = cfg.services.postgres;
  // root-owned fixtures are made through a throwaway container (no sudo; works on Linux CI and Docker Desktop)
  const rootRun = (script: string) => sh('docker', ['run', '--rm', '-v', `${dir}:/w`, '--entrypoint', 'sh', IMG, '-c', script]);
  const keygen = sh('docker', ['run', '--rm', '--entrypoint', 'age-keygen', IMG]);
  if (keygen.code !== 0) throw new Error(`age-keygen not in the image: ${keygen.err}`);
  const identity = keygen.out + '\n';
  const recipient = sh('docker', ['run', '--rm', '-i', '--entrypoint', 'age-keygen', IMG, '-y'], { input: identity }).out + '\n';

  const redirect = (p: string) => join(dir, p.replace(/^\//, ''));
  const ov: any = { services: { postgres: { volumes: [] as any[] } }, secrets: {} };
  for (const v of pg.volumes ?? []) {
    if (v.type !== 'bind' || !/^\/(srv|etc)\/polycarpic\//.test(v.source)) continue;
    const src = redirect(v.source);
    if (/age/.test(v.source)) { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, recipient); chmodSync(src, 0o644); }
    else mkdirSync(src, { recursive: true });
    ov.services.postgres.volumes.push({ type: 'bind', source: src, target: v.target, read_only: !!v.read_only });
  }
  const secretsDir = join(dir, 'etc', 'polycarpic', 'secrets');
  // Ruling A1: /etc/polycarpic/secrets/<service>/<name>, dir root:<service gid> 0750, files 0440.
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
  const compose = (...a: string[]) => sh('docker', ['compose', '-p', PROJECT, '-f', base, '-f', ovFile, ...a], { env });
  const u = compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  if (u.code !== 0) throw new Error(`compose up postgres failed: ${u.err.slice(-800)}`);
  const exec = (...a: string[]) => compose('exec', '-T', 'postgres', ...a);
  const psql = (sql: string) => {
    const r = exec('psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql);
    if (r.code !== 0) throw new Error(r.err || r.out);
    return r.out;
  };
  return {
    dir, spool: join(dir, 'srv', 'polycarpic', 'spool'), secretsDir, identity, recipient, cfg, compose, psql, exec, root: rootRun,
    down: () => { compose('down', '-v', '--remove-orphans'); rootRun('rm -rf /w/* 2>/dev/null; true'); },
  };
}
