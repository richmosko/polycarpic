// POLY-85 seceng S-8 (health hardening) and the dynamic half of S-7(b) (crash handler). Needs Postgres (tests/db harness).
// Same assumed surface as ops-status.test.ts: apps/web/src/ops/{status,health}.ts, apps/web/src/main.ts.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANARIES, assertNoCanary } from '../log/canary.ts';
import { ROOT } from './helpers/pg';
import { cloneMigrated, dbEnv } from './helpers/api';

const migrated = cloneMigrated;
const freePort = () => new Promise<number>((res, rej) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); s.on('error', rej); });
const load = async (env: Record<string, string>) => {
  vi.resetModules();
  Object.assign(process.env, env);
  return { status: (await import(join(ROOT, 'apps/web/src/ops/status.ts'))) as any, health: (await import(join(ROOT, 'apps/web/src/ops/health.ts'))) as any };
};

/** A fake Postgres. 'hang': accepts and never answers. 'error': answers the startup packet with an ErrorResponse whose message is a canary. */
const fakePg = (mode: 'hang' | 'error') => new Promise<{ port: number; connects: () => number; close: () => void }>((res) => {
  let n = 0;
  const socks = new Set<net.Socket>();
  const s = net.createServer((c) => {
    n++; socks.add(c); c.on('error', () => {}); c.on('close', () => socks.delete(c));
    if (mode === 'error') {
      c.once('data', () => {
        const field = (t: string, v: string) => Buffer.concat([Buffer.from(t), Buffer.from(v + '\0')]);
        const body = Buffer.concat([field('S', 'FATAL'), field('C', '28P01'), field('M', CANARIES.memo + ' ' + CANARIES.token), Buffer.from('\0')]);
        const head = Buffer.alloc(5); head.write('E'); head.writeInt32BE(body.length + 4, 1);
        c.write(Buffer.concat([head, body]));
      });
    }
  }).listen(0, '127.0.0.1', () => res({ port: (s.address() as net.AddressInfo).port, connects: () => n, close: () => { socks.forEach((k) => k.destroy()); s.close(); } }));
});

afterEach(() => vi.useRealTimers());

describe('S-8 health hardening', () => {
  it('(a) single-flight: 50 simultaneous calls on a cold memo open at most 2 database connections (one probe)', async () => {
    const e = dbEnv('poly_app', migrated());
    let opened = 0;
    const orig = net.Socket.prototype.connect;
    (net.Socket.prototype as any).connect = function (this: net.Socket, ...a: any[]) {
      const o = a[0];
      const port = typeof o === 'object' && o !== null ? o.port : o;
      if (Number(port) === Number(e.DATABASE_PORT)) opened++;
      return (orig as any).apply(this, a);
    };
    try {
      const { health } = await load(e);
      const rs: Response[] = await Promise.all(Array.from({ length: 50 }, () => health.handleHealth()));
      for (const r of rs) expect(await r.text()).toBe('{"ok":true}');
      expect(opened, 'connections opened by 50 concurrent cold calls').toBeGreaterThan(0);
      expect(opened).toBeLessThanOrEqual(2);
    } finally {
      net.Socket.prototype.connect = orig;
    }
  });
  it('(b) a probe that never resolves gives 503 {"ok":false} within 10 s (hard timeout)', async () => {
    const f = await fakePg('hang');
    try {
      const { health } = await load({ ...dbEnv('poly_app', migrated()), DATABASE_PORT: String(f.port) });
      const t = performance.now();
      const r: Response = await Promise.race([health.handleHealth(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('health hung past 10 s')), 10_000))]);
      expect(performance.now() - t).toBeLessThan(10_000);
      expect([r.status, await r.text()]).toEqual([503, '{"ok":false}']);
      expect(f.connects(), 'it connected and waited: the timeout answered').toBeGreaterThan(0);
    } finally { f.close(); }
  }, 20_000);
  it('(c) a probe failing with a canary-message error gives byte-equal {"ok":false}; canary absent from body, headers and the status payload', async () => {
    const f = await fakePg('error');
    try {
      const env = { ...dbEnv('poly_app', migrated()), DATABASE_PORT: String(f.port) };
      const port = await freePort();
      const { health, status } = await load({ ...env, STATUS_PORT: String(port) });
      const r: Response = await health.handleHealth();
      const text = await r.text();
      expect([r.status, text]).toEqual([503, '{"ok":false}']);
      assertNoCanary(text + JSON.stringify([...r.headers.entries()]), 'health');
      const s = await status.startStatusServer({ port });
      try { assertNoCanary(await (await fetch(`http://127.0.0.1:${port}/status`)).text(), 'status'); } finally { await new Promise((x) => s.close(x)); }
    } finally { f.close(); }
  }, 30_000);
});

describe('S-7(b) web crash handler (dynamic)', () => {
  it('an uncaught error whose message and detail are canaries yields one process.crash line {type, code} and exit 1; no canary on stdout/stderr', async () => {
    const d = mkdtempSync(join(tmpdir(), 'poly85-crash-'));
    const pre = join(d, 'crash.mjs');
    writeFileSync(pre, `setTimeout(() => { const e = new Error(${JSON.stringify(CANARIES.memo)}); e.detail = ${JSON.stringify(CANARIES.token)}; e.code = '23505'; throw e; }, 500);\n`);
    const auth = join(d, 'auth'); writeFileSync(auth, 'auth-secret\n');
    const db = dbEnv('poly_app', migrated());
    const port = await freePort();
    const env = { PATH: process.env.PATH!, ...db, APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', AUTH_SECRET_FILE: auth, STATUS_PORT: String(port) };
    const p = spawn('node', ['--experimental-strip-types', '--import', pre, join(ROOT, 'apps/web/src/main.ts')], { env, cwd: ROOT });
    let out = '';
    p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (out += c));
    const code: number | null = await new Promise((r) => { const t = setTimeout(() => { p.kill('SIGKILL'); r(null); }, 20_000); p.on('exit', (c) => { clearTimeout(t); r(c); }); });
    expect(code, out).toBe(1);
    assertNoCanary(out, 'web crash output');
    const crash = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.event === 'process.crash');
    expect(crash).toHaveLength(1);
    expect(crash[0].err).toEqual({ type: 'Error', code: '23505' });
    expect(crash[0].service).toBe('web');
  }, 40_000);
});
