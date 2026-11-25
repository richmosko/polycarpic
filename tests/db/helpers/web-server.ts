// POLY-161c: the real artefact under test: `apps/web/src/main.ts` spawned against Postgres, serving the built app (`apps/web/build`) on 3000.
// A missing build FAILS here, with its own message; it never skips (verdict B31). Port 3000 is fixed in the product, so a suite that
// starts this server runs where 3000 is free (one file, one server).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { request } from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { ROOT } from './pg';
import { cloneMigrated, dbEnv } from './api';

export const BUILD = join(ROOT, 'apps/web/build');
export const ORIGIN_HOST = 'localhost:5173';
export const ORIGIN = `http://${ORIGIN_HOST}`;

export function requireBuild(): void {
  if (!existsSync(join(BUILD, 'handler.js'))) throw new Error('apps/web/build/handler.js is missing: run `pnpm --filter @poly/web build` first (this suite never skips for a missing build)');
}

export interface Web {
  proc: ChildProcess;
  out: () => string;
  /** The JSON log lines so far. */
  lines: () => Array<Record<string, any>>;
  exited: Promise<number | null>;
  db: string;
  proxy: DbProxy | undefined;
  statusPort: number;
  stop: () => Promise<void>;
}

export const port3000Free = () => new Promise<boolean>((res) => { const s = net.createServer().once('error', () => res(false)).listen(3000, '0.0.0.0', () => s.close(() => res(true))); });
export const freePort = () => new Promise<number>((res, rej) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); s.on('error', rej); });

/** A TCP forwarder in front of Postgres: `kill()` makes the database unreachable for good; `down()` does the same until `up()` listens again on the SAME port (a restart that the running web must ride out). */
export interface DbProxy { port: number; kill: () => Promise<void>; down: () => Promise<void>; up: () => Promise<void> }
export async function startProxy(host: string, port: number): Promise<DbProxy> {
  const socks = new Set<net.Socket>();
  const make = () => net.createServer((c) => {
    const up = net.connect(port, host);
    for (const s of [c, up]) { socks.add(s); s.on('close', () => socks.delete(s)); s.on('error', () => s.destroy()); }
    c.pipe(up); up.pipe(c);
  });
  let server = make();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const own = (server.address() as net.AddressInfo).port;
  const down = async () => { for (const s of socks) s.destroy(); if (server.listening) await new Promise<void>((r) => server.close(() => r())); };
  return {
    port: own,
    kill: down,
    down,
    up: async () => { if (server.listening) return; server = make(); await new Promise<void>((r, j) => server.once('error', j).listen(own, '127.0.0.1', () => r())); },
  };
}

/** The TCP LISTEN sockets of one process as `addr:port`, from /proc where it exists, else lsof. Throws when neither works. */
export function listeners(pid: number): string[] {
  const proc = `/proc/${pid}/net/tcp`;
  if (existsSync(proc)) {
    const inodes = new Set<string>();
    for (const f of readdirSync(`/proc/${pid}/fd`)) { try { const l = readlinkSync(`/proc/${pid}/fd/${f}`); const m = /^socket:\[(\d+)\]$/.exec(l); if (m) inodes.add(m[1]!); } catch { /* gone */ } }
    const out: string[] = [];
    for (const file of [proc, `/proc/${pid}/net/tcp6`]) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
        const c = line.trim().split(/\s+/);
        if (c.length < 10 || c[3] !== '0A' || !inodes.has(c[9]!)) continue;
        const [a, p] = c[1]!.split(':');
        const ip = a!.length === 8 ? a!.match(/../g)!.reverse().map((h) => parseInt(h, 16)).join('.') : `v6:${a}`;
        out.push(`${ip}:${parseInt(p!, 16)}`);
      }
    }
    return out.sort();
  }
  const r = spawnSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' });
  if (r.status !== 0 && r.stdout === '') throw new Error(`no /proc and lsof failed: ${r.stderr}`);
  return r.stdout.split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1).replace(/^\*:/, '0.0.0.0:')).sort();
}

export interface StartOpts {
  /** Put a killable forwarder between web and Postgres; `web.proxy` is it. */
  proxy?: boolean;
  /** Extra or overriding environment. */
  env?: Record<string, string>;
  /** `--import` preloads. */
  preload?: string[];
  /** A database other than a fresh clone. */
  db?: string;
  /** Resolve when this event is logged (default `web.started`); `null` resolves on exit. */
  until?: string | null;
  timeoutMs?: number;
}

export async function startWeb(o: StartOpts = {}): Promise<Web> {
  requireBuild();
  if (!(await port3000Free())) throw new Error('port 3000 is not free: another process holds it (the suite needs the fixed port)');
  const db = o.db ?? cloneMigrated();
  const statusPort = await freePort();
  const dbe = dbEnv('poly_app', db);
  const proxy = o.proxy ? await startProxy(dbe.DATABASE_HOST!, Number(dbe.DATABASE_PORT)) : undefined;
  if (proxy) { dbe.DATABASE_HOST = '127.0.0.1'; dbe.DATABASE_PORT = String(proxy.port); }
  const env = { PATH: process.env.PATH!, ...dbe, APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: ORIGIN, STATUS_PORT: String(statusPort), ...o.env };
  const args = ['--experimental-strip-types', ...(o.preload ?? []).flatMap((p) => ['--import', p]), join(ROOT, 'apps/web/src/main.ts')];
  const proc = spawn('node', args, { env, cwd: ROOT });
  let out = '';
  proc.stdout!.on('data', (c) => (out += c));
  proc.stderr!.on('data', (c) => (out += c));
  const lines = () => out.split('\n').filter((l) => l.startsWith('{')).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const exited = new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));
  const web: Web = {
    proc, out: () => out, lines, exited, db, proxy, statusPort,
    stop: async () => { if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await exited; } await proxy?.kill().catch(() => {}); },
  };
  const until = o.until === undefined ? 'web.started' : o.until;
  const limit = o.timeoutMs ?? 60_000;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${until}\n${out}`)), limit);
    const poll = setInterval(() => { if (until !== null && lines().some((l) => l.event === until)) { clearTimeout(t); clearInterval(poll); resolve(); } }, 50);
    void exited.then(() => { clearTimeout(t); clearInterval(poll); if (until === null || lines().some((l) => l.event === until)) resolve(); else reject(new Error(`exited before ${until}\n${out}`)); });
  }).catch(async (e) => { await web.stop(); throw e; });
  return web;
}

export interface Reply { status: number; headers: Record<string, string | string[] | undefined>; rawHeaders: string[]; body: string; raw: Buffer }
/** One request to 127.0.0.1:3000 through node:http, so Host can be set. */
export function ask(path: string, o: { method?: string; host?: string | null; headers?: Record<string, string>; body?: string | Buffer; port?: number } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(o.host === null ? {} : { host: o.host ?? ORIGIN_HOST }), ...o.headers };
    const r = request({ host: '127.0.0.1', port: o.port ?? 3000, path, method: o.method ?? 'GET', headers, setHost: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d) => chunks.push(Buffer.from(d)));
      res.on('end', () => { const raw = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, body: raw.toString('utf8'), raw }); });
    });
    r.on('error', reject);
    if (o.body !== undefined) r.write(o.body);
    r.end();
  });
}
