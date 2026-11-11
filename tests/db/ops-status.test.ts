// POLY-85 R4 / criterion 2: loopback-only status listener, ok/not-ok public health. Needs Postgres (tests/db harness).
// Surface assumed (reconcile in `load` only), from the ruling's file names:
//   apps/web/src/ops/status.ts  startStatusServer({ port }) -> Promise<http.Server>   (also reads STATUS_PORT; port wins)
//   apps/web/src/ops/health.ts  handleHealth() -> Promise<Response>
// Both read DATABASE_* from process.env as poly_app (the same way packages/db/startup does) and share one probe.
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANARIES, assertNoCanary } from '../log/canary.ts';
import { ROOT, must } from './helpers/pg';
import { REAL_MIGRATIONS, cloneMigrated, dbEnv, freshDb } from './helpers/api';

const TAGS: string[] = JSON.parse(readFileSync(join(REAL_MIGRATIONS, 'meta', '_journal.json'), 'utf8')).entries.map((e: any) => e.tag);
const EXPECTED = TAGS[TAGS.length - 1]!;

const load = async (env: Record<string, string>) => {
  vi.resetModules();
  Object.assign(process.env, env);
  const status: any = await import(join(ROOT, 'apps/web/src/ops/status.ts'));
  const health: any = await import(join(ROOT, 'apps/web/src/ops/health.ts'));
  return { status, health };
};
const freePort = () => new Promise<number>((res, rej) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); s.on('error', rej); });
const migrated = cloneMigrated;
const get = async (port: number, path = '/status', method = 'GET', host = '127.0.0.1') => {
  const r = await fetch(`http://${host}:${port}${path}`, { method });
  return { res: r, text: await r.text() };
};

let servers: Server[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-10T12:00:00Z')); });
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});
const start = async (env: Record<string, string>) => {
  const port = await freePort();
  const m = await load({ ...env, STATUS_PORT: String(port) });
  const s: Server = await m.status.startStatusServer({ port });
  servers.push(s);
  return { ...m, port: (s.address() as net.AddressInfo).port, server: s };
};

describe('status listener bind (criterion 2: binds 127.0.0.1 only)', () => {
  it('server.address().address is exactly 127.0.0.1', async () => {
    const s = await start(dbEnv('poly_app', migrated()));
    expect((s.server.address() as net.AddressInfo).address).toBe('127.0.0.1');
  });
  it('it is not reachable on any non-internal IPv4 address of this host (and the host has at least one)', async () => {
    const s = await start(dbEnv('poly_app', migrated()));
    const ext = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
    expect(ext.length, 'no non-internal IPv4 interface: the bind test cannot prove anything here').toBeGreaterThan(0);
    for (const a of ext) {
      const err = await new Promise<string>((res) => { const c = net.connect({ host: a, port: s.port, timeout: 2000 }); c.on('connect', () => { c.destroy(); res('connected'); }); c.on('error', (e: any) => res(e.code)); c.on('timeout', () => { c.destroy(); res('timeout'); }); });
      expect(err, a).toBe('ECONNREFUSED');
    }
  });
  it('the bind host is not configurable: STATUS_HOST / STATUS_BIND / HOST in the environment change nothing', async () => {
    const s = await start({ ...dbEnv('poly_app', migrated()), STATUS_HOST: '0.0.0.0', STATUS_BIND: '0.0.0.0', HOST: '0.0.0.0' });
    expect((s.server.address() as net.AddressInfo).address).toBe('127.0.0.1');
  });
  it('the source pins the host as a constant', () => {
    expect(readFileSync(join(ROOT, 'apps/web/src/ops/status.ts'), 'utf8')).toMatch(/['"]127\.0\.0\.1['"]/);
  });
});

describe('GET /status', () => {
  it('200, application/json, no-store, exactly the v1 payload', async () => {
    const s = await start(dbEnv('poly_app', migrated()));
    const { res, text } = await get(s.port);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = JSON.parse(text);
    expect(Object.keys(j).sort()).toEqual(['commit', 'db', 'jobs', 'schema', 'service', 'started_at', 'v']);
    expect(j.v).toBe(1);
    expect(j.service).toBe('web');
    expect(j.db).toEqual({ ok: true });
    expect(j.schema).toEqual({ state: 'current', expected: EXPECTED, applied: EXPECTED });
    expect(j.jobs).toEqual({});
    expect(j.started_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
    expect(j.commit).toBeNull(); // outside an image
  });
  it('commit is POLY_IMAGE_REVISION when set (40 hex), null otherwise', async () => {
    const sha = 'a'.repeat(40);
    const s = await start({ ...dbEnv('poly_app', migrated()), POLY_IMAGE_REVISION: sha });
    expect(JSON.parse((await get(s.port)).text).commit).toBe(sha);
    delete process.env.POLY_IMAGE_REVISION;
  });
  it('the query string is ignored', async () => {
    const s = await start(dbEnv('poly_app', migrated()));
    expect((await get(s.port, '/status?x=1&token=' + CANARIES.token)).res.status).toBe(200);
  });
  for (const p of ['/', '/api/v1/health', '/status/', '/statusx', '/metrics', '/admin']) {
    it(`${p} is 404`, async () => expect((await get((await start(dbEnv('poly_app', migrated()))).port, p)).res.status).toBe(404));
  }
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    it(`${m} /status is 405`, async () => expect((await get((await start(dbEnv('poly_app', migrated()))).port, '/status', m)).res.status).toBe(405));
  }
  describe('schema states', () => {
    it('behind: a tracking row removed', async () => {
      const db = migrated();
      must(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`, db);
      const j = JSON.parse((await get((await start(dbEnv('poly_app', db))).port)).text);
      expect(j.schema).toEqual({ state: 'behind', expected: EXPECTED, applied: TAGS[TAGS.length - 2] ?? null });
      expect(j.db.ok).toBe(true);
    });
    it('ahead: an unknown newer tracking row', async () => {
      const db = migrated();
      must(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('ahead', 99999999999999)`, db);
      const j = JSON.parse((await get((await start(dbEnv('poly_app', db))).port)).text);
      expect(j.schema.state).toBe('ahead');
      expect(j.schema.expected).toBe(EXPECTED);
    });
    it('diverged: a tracking timestamp differs from the journal', async () => {
      const db = migrated();
      must(`UPDATE drizzle.__drizzle_migrations SET created_at = created_at + 1 WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)`, db);
      expect(JSON.parse((await get((await start(dbEnv('poly_app', db))).port)).text).schema.state).toBe('diverged');
    });
    it('behind with no tracking table at all (never migrated): behind, applied null', async () => {
      const j = JSON.parse((await get((await start(dbEnv('poly_app', freshDb()))).port)).text);
      expect(j.schema.state).toBe('behind');
      expect(j.schema.applied).toBeNull();
    });
    it('unreachable: db.ok false, state unreachable, still 200 (the listener is up; the payload says what is wrong)', async () => {
      const e = dbEnv('poly_app', migrated());
      const { res, text } = await get((await start({ ...e, DATABASE_PORT: '1' })).port);
      const j = JSON.parse(text);
      expect(res.status).toBe(200);
      expect(j.db.ok).toBe(false);
      expect(j.schema.state).toBe('unreachable');
      assertNoCanary(text);
    });
  });
  it('is read-only and tenant-free: the payload names no table, role, host, user or password', async () => {
    const e = dbEnv('poly_app', migrated());
    const { text } = await get((await start(e)).port);
    for (const leak of [e.DATABASE_HOST, e.DATABASE_NAME, e.DATABASE_USER, 'poly_app', 'qa-poly_app', 'postgres://']) expect(text, leak).not.toContain(leak);
  });
});

describe('public health (R-6: ok or not only)', () => {
  const body = async (db: string) => {
    const { health } = await load(dbEnv('poly_app', db));
    const r: Response = await health.handleHealth();
    return { r, text: await r.text() };
  };
  it('current: 200 and the body is byte-equal to {"ok":true}', async () => {
    const { r, text } = await body(migrated());
    expect(r.status).toBe(200);
    expect(text).toBe('{"ok":true}');
  });
  it('ahead is ok (the previous release must run on the new schema, ARCH 8.1)', async () => {
    const db = migrated();
    must(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('ahead', 99999999999999)`, db);
    const { r, text } = await body(db);
    expect([r.status, text]).toEqual([200, '{"ok":true}']);
  });
  for (const [name, mut] of [
    ['behind', (db: string) => must(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`, db)],
    ['diverged', (db: string) => must(`UPDATE drizzle.__drizzle_migrations SET created_at = created_at + 1 WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)`, db)],
  ] as const) {
    it(`${name}: 503 and the body is byte-equal to {"ok":false}`, async () => {
      const db = migrated(); mut(db);
      const { r, text } = await body(db);
      expect([r.status, text]).toEqual([503, '{"ok":false}']);
    });
  }
  it('unreachable: 503 and {"ok":false}, with nothing about the failure', async () => {
    const e = dbEnv('poly_app', migrated());
    const { health } = await load({ ...e, DATABASE_PORT: '1' });
    const r: Response = await health.handleHealth();
    const text = await r.text();
    expect([r.status, text]).toEqual([503, '{"ok":false}']);
  });
  it('headers: content-type application/json and cache-control no-store; no other header beyond the platform\'s', async () => {
    const { r } = await body(migrated());
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const extra = [...r.headers.keys()].filter((h) => !['content-type', 'cache-control', 'content-length'].includes(h));
    expect(extra).toEqual([]);
  });
  it('no response carries a canary or any DB detail', async () => {
    const e = dbEnv('poly_app', migrated());
    for (const env of [e, { ...e, DATABASE_PORT: '1', DATABASE_NAME: CANARIES.token }]) {
      const { health } = await load(env);
      const r: Response = await health.handleHealth();
      const t = await r.text();
      assertNoCanary(t);
      expect(t).toMatch(/^\{"ok":(true|false)\}$/);
    }
  });
  it('memoises the probe for 5 s and not longer (a stranger cannot make it a DB load generator)', async () => {
    const db = migrated();
    const { health } = await load(dbEnv('poly_app', db));
    expect(await (await health.handleHealth()).text()).toBe('{"ok":true}');
    must(`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`, db);
    vi.setSystemTime(new Date('2026-11-10T12:00:03Z'));
    expect(await (await health.handleHealth()).text(), 'within 5 s: cached').toBe('{"ok":true}');
    vi.setSystemTime(new Date('2026-11-10T12:00:06Z'));
    expect(await (await health.handleHealth()).text(), 'after 5 s: re-probed').toBe('{"ok":false}');
  });
});
