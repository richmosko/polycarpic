// POLY-152 R1.1, R1.2, seceng D2 / E2 / E3: the service's two listeners and its startup checks, in process through
// `startAuthService(env)` (backend-lead-152's contract names, point 3). Red today: apps/auth does not exist. Titles end [red if: ...].
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated, dbEnv, freshDb } from './helpers/api';

const SECRET = 'qa-auth-main-secret-0123456789abcdef0123456789abcdef';
const dir = mkdtempSync(join(tmpdir(), 'poly152-main-'));
const file = (n: string, c: string) => { const p = join(dir, n); writeFileSync(p, c); return p; };
let db: string;
let port = 41000 + (process.pid % 500) * 4;
type Svc = { publicOrigin: string; internalOrigin: string; close(): Promise<void> };
const start = async (env: Record<string, string>): Promise<Svc> => ((await import('../../apps/auth/src/main.ts')) as any).startAuthService(env);
const envFor = (database: string, over: Record<string, string> = {}): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'https://app.qa.test',
  ...dbEnv('poly_auth', database), AUTH_SECRET_FILE: file('secret', `${SECRET}\n`),
  AUTH_INTERNAL_HOST: '127.0.0.1', AUTH_INTERNAL_PORT: String(++port), AUTH_PUBLIC_PORT: String(++port),
  ...over,
});
beforeAll(() => { db = cloneMigrated(); });

describe('R1.1 the two listeners', () => {
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
    expect((await fetch(`${ready().publicOrigin}/api/auth/ok`)).status).toBe(200);
    for (const p of ['/', '/session', '/api/session', '/api/authx', '/sign-in', '/api/auth/../session'])
      expect((await fetch(`${ready().publicOrigin}${p}`, { redirect: 'manual' })).status, p).toBe(404);
  });
  it('the internal listener: GET /session with no cookie is 204; any other path, method or query is 404; /api/auth/ok is not served there [red if: the internal listener is wider]', async () => {
    expect((await fetch(`${ready().internalOrigin}/session`)).status).toBe(204);
    for (const [m, p] of [['POST', '/session'], ['GET', '/'], ['GET', '/session?x=1'], ['GET', '/api/auth/ok']] as const)
      expect((await fetch(`${ready().internalOrigin}${p}`, { method: m })).status, `${m} ${p}`).toBe(404);
  });
  it('the internal origin is not the public one and binds the configured host, never a wildcard [red if: one port or 0.0.0.0]', () => {
    expect(new URL(ready().internalOrigin).port).not.toBe(new URL(ready().publicOrigin).port);
    expect(new URL(ready().internalOrigin).hostname).toBe('127.0.0.1');
  });
  it('D2: the auth secret appears in no log line from startup or from a request [red if: the service logs its secret]', async () => {
    await fetch(`${ready().publicOrigin}/api/auth/ok`);
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
