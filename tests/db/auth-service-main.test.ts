// POLY-152 R1.1, R1.2, seceng D2 and POLY-153 R9: the service's one listener (the internal /session listener is removed) and its startup checks, in process through
// `startAuthService(env)` (backend-lead-152's contract names, point 3). Red today: apps/auth does not exist. Titles end [red if: ...].
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloneMigrated, dbEnv, freshDb } from './helpers/api';
import net from 'node:net';

// the service's JSON log lines, collected (pino writes to the descriptor, not process.stdout.write); the real stream is kept so the output stays visible
const sunk = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('../../packages/config/src/log.ts', async (orig) => {
  const m = (await orig()) as any;
  return { ...m, createLogger: (o: any) => m.createLogger({ ...o, stream: new Writable({ write(c, _e, cb) { sunk.lines.push(String(c)); process.stdout.write(c); cb(); } }) }) };
});

// A TCP forwarder in front of Postgres with down()/up() on the same port (kept here: the auth area's test files may not import another area's helper).
async function startProxy(host: string, port: number) {
  const socks = new Set<net.Socket>();
  const make = () => net.createServer((c) => {
    const up = net.connect(port, host);
    for (const x of [c, up]) { socks.add(x); x.on('close', () => socks.delete(x)); x.on('error', () => x.destroy()); }
    c.pipe(up); up.pipe(c);
  });
  let server = make();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const own = (server.address() as net.AddressInfo).port;
  const down = async () => { for (const x of socks) x.destroy(); if (server.listening) await new Promise<void>((r) => server.close(() => r())); };
  return { port: own, kill: down, down, up: async () => { if (server.listening) return; server = make(); await new Promise<void>((r, j) => server.once('error', j).listen(own, '127.0.0.1', () => r())); } };
}

const SECRET = 'qa-auth-main-secret-0123456789abcdef0123456789abcdef';
const dir = mkdtempSync(join(tmpdir(), 'poly152-main-'));
const file = (n: string, c: string) => { const p = join(dir, n); writeFileSync(p, c); return p; };
let db: string;
let port = 41000 + (process.pid % 500) * 4;
type Svc = { publicOrigin: string; internalOrigin?: string; close(): Promise<void> };
const start = async (env: Record<string, string>): Promise<Svc> => ((await import('../../apps/auth/src/main.ts')) as any).startAuthService(env);
const envFor = (database: string, over: Record<string, string> = {}): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'https://app.qa.test',
  ...dbEnv('poly_auth', database), AUTH_SECRET_FILE: file('secret', `${SECRET}\n`),
  AUTH_PUBLIC_PORT: String(++port), // R9: no AUTH_INTERNAL_HOST / AUTH_INTERNAL_PORT
  ...over,
});
beforeAll(() => { db = cloneMigrated(); });

describe('R1.1 / R9 the one listener', () => {
  let svc: Svc;
  let startErr: unknown = null;
  const ready = (): Svc => { if (startErr) throw startErr; return svc; };
  const logs: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn };
  beforeAll(async () => {
    for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    try { svc = await start(envFor(db)); } catch (x) { startErr = x; } finally { Object.assign(console, saved); }
  });
  afterAll(async () => { await svc?.close(); });

  it('the public listener answers /api/auth/ok 200 and nothing else: /, /session, /api/session, /api/authx, /healthz-less paths are 404 [red if: the public listener serves more than handleAuthRequest]', async () => {
    expect((await fetch(`${ready().publicOrigin}/api/auth/ok`, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status).toBe(200); // R8: the client address is required in every APP_ENV, the proxy sets it
    for (const p of ['/', '/session', '/api/session', '/api/authx', '/sign-in', '/api/auth/../session'])
      expect((await fetch(`${ready().publicOrigin}${p}`, { redirect: 'manual' })).status, p).toBe(404);
  });
  it('R9: GET /session on the public listener is 404 for every spelling, with and without a cookie [red if: handleSessionRequest is still served]', async () => {
    for (const p of ['/session', '/api/session', '/api/auth/session-internal', '/session?x=1', '//session'])
      for (const cookie of [undefined, '__Secure-better-auth.session_token=abc.def'])
        expect((await fetch(`${ready().publicOrigin}${p}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })).status, `${p} ${cookie ?? ''}`).toBe(404);
  });
  it('R9: the service exposes one origin; startAuthService returns no internalOrigin and the env cannot ask for one [red if: a second listener exists]', async () => {
    expect(ready().internalOrigin).toBeUndefined();
    const x = await (async () => { try { const s = await start(envFor(db, { AUTH_INTERNAL_HOST: '127.0.0.1', AUTH_INTERNAL_PORT: String(++port) })); await s.close(); return null; } catch (e) { return e as Error; } })();
    expect(x, 'AUTH_INTERNAL_* is forbidden config for auth (R9)').not.toBeNull();
  });
  it('D2: the auth secret appears in no log line from startup or from a request [red if: the service logs its secret]', async () => {
    await fetch(`${ready().publicOrigin}/api/auth/ok`, { headers: { 'x-forwarded-for': '127.0.0.1' } });
    expect(logs.join('\n')).not.toContain(SECRET);
  });
});

describe('R1.2 startup checks: exit unless current_user is poly_auth, the secret reads, and migrations are at head', () => {
  const rejects = async (env: Record<string, string>) => { const f = (await import('../../apps/auth/src/main.ts')) as any; try { const s = await f.startAuthService(env); await s.close(); return null; } catch (x) { return x as Error; } };
  it('connected as poly_app (not poly_auth): refused [red if: current_user is not checked]', async () => {
    expect(await rejects(envFor(db, dbEnv('poly_app', db)))).not.toBeNull();
  });
  it('AUTH_SECRET_FILE unreadable: refused, and the message does not contain a secret [red if: the secret is not required]', async () => {
    const x = await rejects(envFor(db, { AUTH_SECRET_FILE: join(dir, 'does-not-exist') }));
    expect(x).not.toBeNull();
    expect(String(x?.message)).not.toContain(SECRET);
  });
  it('migrations not at head (a database no migration has run on): refused [red if: the head is not checked]', async () => {
    expect(await rejects(envFor(freshDb()))).not.toBeNull();
  });
  it('control: the same env against the migrated database starts [red if: the controls above are refused for another reason]', async () => {
    const f = (await import('../../apps/auth/src/main.ts')) as any;
    const s = await f.startAuthService(envFor(db));
    await s.close();
  });
});

// POLY-160 R5 (C23, C24): the database lost under a running auth service. A request that needs it answers an error and writes auth.request_failed; the service keeps running and the next
// request, once the database is back, works. [red if: survive() is removed from the auth pool: the process ends with an unhandled client error]
describe('the database lost under the auth service (POLY-160 R5)', () => {
  it('a request that needs the database fails with a logged auth.request_failed, then works again after the database returns', async () => {
    const base = dbEnv('poly_auth', db);
    const proxy = await startProxy(base.DATABASE_HOST!, Number(base.DATABASE_PORT));
    const lines = sunk.lines;
    lines.length = 0;
    let svc: Svc | undefined;
    try {
      svc = await start(envFor(db, { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(proxy.port) }));
      const session = () => fetch(`${svc!.publicOrigin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json', origin: 'https://app.qa.test' }, body: JSON.stringify({ email: 'nobody@qa.test', password: 'qa-wrong-password-1' }) });
      const first = (await session()).status;
      expect(first, 'with the database up, an unknown account is a client error').toBeLessThan(500);
      await proxy.down();
      await new Promise((r) => setTimeout(r, 500));
      const down = await session();
      expect(down.status).toBeGreaterThanOrEqual(500);
      expect(lines.join('\n')).toContain('auth.request_failed');
      await proxy.up();
      let status = 999;
      for (let i = 0; i < 30 && status >= 500; i++) { status = (await session()).status; if (status >= 500) await new Promise((r) => setTimeout(r, 500)); }
      expect(status, 'the same request is a client error again').toBe(first);
      expect(lines.join('\n')).not.toContain('qa-poly_auth');
    } finally {
      await svc?.close();
      await proxy.kill().catch(() => undefined);
    }
  }, 60_000);
});
