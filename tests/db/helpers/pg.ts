// POLY-83 harness: a disposable Postgres 17 + pgTAP. One container per vitest run (globalSetup), one fresh
// database per fixture. Admin SQL goes through `docker exec psql`, so the harness needs no npm client of its own.
// POLY_TEST_PG_URL (a superuser URL to a server that already has pgtap, e.g. a CI service container) skips Docker.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DB_PKG = join(ROOT, 'packages', 'db');
// The Postgres base is the ONE FROM line of infra/postgres/Dockerfile (INFRA §6.1a); the cached image is named after
// its digest, so a bump never reuses a stale build.
const PG_BASE = (readFileSync(join(ROOT, 'infra', 'postgres', 'Dockerfile'), 'utf8').split('\n').find((l) => l.startsWith('FROM ')) ?? '').slice(5).trim();
if (!/^postgres:\d+\.\d+@sha256:[0-9a-f]{64}$/.test(PG_BASE)) throw new Error(`infra/postgres/Dockerfile: no pinned FROM line (${PG_BASE})`);
export const IMAGE = `polycarpic-pgtap:${PG_BASE.split('@sha256:')[1]!.slice(0, 12)}`;
const SEP = '\u001f';

export type Server = { host: string; port: number; container: string | null; superUrl: string };
export type Res = { ok: boolean; rows: string[][]; sqlstate: string | null; err: string; out: string };

export function sh(cmd: string, args: string[], input?: string) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, timeout: 300_000 });
  return { code: r.status ?? 127, out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

export function server(): Server {
  const s = process.env.POLY_TEST_SERVER;
  if (!s) throw new Error('POLY_TEST_SERVER unset: globalSetup did not run');
  return JSON.parse(s) as Server;
}

/** Start (or attach to) the disposable server. Returns a teardown. */
export function startServer(): { server: Server; stop: () => void } {
  const ext = process.env.POLY_TEST_PG_URL;
  if (ext) {
    const u = new URL(ext);
    return { server: { host: u.hostname, port: Number(u.port || 5432), container: null, superUrl: ext }, stop() {} };
  }
  const have = sh('docker', ['image', 'inspect', IMAGE]);
  if (have.code !== 0) {
    const b = sh('docker', ['build', '--build-arg', `PG_BASE=${PG_BASE}`, '-t', IMAGE, join(ROOT, 'tests', 'db', 'docker')]);
    if (b.code !== 0) throw new Error(`docker build failed: ${b.err.slice(-600)}`);
  }
  const name = `poly83-qa-${randomBytes(4).toString('hex')}`;
  const run = sh('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=qa', '-p', '127.0.0.1::5432', IMAGE]);
  if (run.code !== 0) throw new Error(`docker run failed: ${run.err.trim()}`);
  for (let i = 0, ok = 0; ; i++) {
    if (i > 90) throw new Error('postgres did not become ready');
    const r = sh('docker', ['exec', name, 'psql', '-X', '-At', '-h', '127.0.0.1', '-U', 'postgres', '-c', 'select 1']);
    ok = r.code === 0 ? ok + 1 : 0;
    if (ok >= 2) break; // initdb restarts the server once
    sh('sleep', ['1']);
  }
  const port = Number(/:(\d+)\s*$/m.exec(sh('docker', ['port', name, '5432/tcp']).out)?.[1]);
  return { server: { host: '127.0.0.1', port, container: name, superUrl: `postgres://postgres:qa@127.0.0.1:${port}/postgres` }, stop: () => void sh('docker', ['stop', '-t', '1', name]) };
}

/** Run SQL as superuser against `db`. Never throws; the caller asserts ok / sqlstate / err. */
export function psql(sql: string, db = 'postgres', as?: { role: string; password?: string }): Res {
  const s = server();
  const base = ['-X', '-q', '-At', '-F', SEP, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  const target = as ? `postgres://${as.role}:${as.password ?? `qa-${as.role}`}@127.0.0.1:5432/${db}` : null;
  const r = s.container
    ? sh('docker', ['exec', '-i', s.container, 'psql', ...base, ...(target ? [target] : ['-U', 'postgres', '-d', db]), '-f', '-'], sql)
    : sh('psql', [...base, as ? `postgres://${as.role}:${as.password ?? `qa-${as.role}`}@${s.host}:${s.port}/${db}` : s.superUrl.replace(/\/[^/]*$/, `/${db}`), '-f', '-'], sql);
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err);
  return { ok: r.code === 0, rows: r.out.split('\n').filter(Boolean).map((l) => l.split(SEP)), sqlstate: m?.[1] ?? null, err: r.err.trim(), out: r.out };
}

export function must(sql: string, db = 'postgres', as?: { role: string; password?: string }): Res {
  const r = psql(sql, db, as);
  if (!r.ok) throw new Error(`psql failed: ${r.err}\n--sql--\n${sql.slice(0, 400)}`);
  return r;
}

export function url(role: string, db: string): string {
  const s = server();
  return `postgres://${role}:qa-${role}@${s.host}:${s.port}/${db}`;
}

export function freshName(): string {
  return `t_${randomBytes(5).toString('hex')}`;
}

/** A long-lived superuser psql session (stdin fed once); kill() ends it and releases its locks. */
export function psqlSession(sql: string, db: string) {
  const s = server();
  const args = s.container
    ? ['docker', ['exec', '-i', s.container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', db, '-f', '-']] as const
    : ['psql', ['-X', '-q', '-At', s.superUrl.replace(/\/[^/]*$/, `/${db}`), '-f', '-']] as const;
  const c = spawn(args[0], [...args[1]], { stdio: ['pipe', 'ignore', 'ignore'] });
  c.stdin.write(sql + '\n');
  return c;
}
