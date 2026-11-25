// POLY-161c, seceng S6 and S7 (verdict B37): what 512 held connections cost on the real `main.ts`, and whether a slow reader is bounded.
// Values go to temp/161-measurements.json for the gate record. Serial (port 3000).
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from './helpers/pg';
import { ask, startWeb, type Web } from './helpers/web-server';

const started: Web[] = [];
afterEach(async () => { for (const w of started.splice(0)) await w.stop(); });
const run = async () => { const w = await startWeb(); started.push(w); return w; };

const rssMiB = (pid: number): number => Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) / 1024;
const record = (k: string, v: unknown) => { mkdirSync(join(ROOT, 'temp'), { recursive: true }); appendFileSync(join(ROOT, 'temp/161-measurements.json'), JSON.stringify({ at: new Date().toISOString(), [k]: v }) + '\n'); };
const HOST = 'localhost:5173';
const PAD = 'a'.repeat(7000);

async function hold(n: number, first: (i: number) => string): Promise<Socket[]> {
  const socks: Socket[] = [];
  for (let i = 0; i < n; i++) {
    const s = connect(3000, '127.0.0.1');
    s.on('error', () => {});
    socks.push(s);
    s.on('connect', () => s.write(first(i)));
  }
  await Promise.all(socks.map((s) => new Promise<void>((r) => (s.connecting ? s.once('connect', () => r()) : r()))));
  return socks;
}
/** One more connection: what does it receive before it is closed or 2 s pass? */
const extraAnswer = () => new Promise<string>((res) => {
  const x = connect(3000, '127.0.0.1');
  let d = '';
  x.on('data', (c) => (d += c));
  x.on('error', () => {});
  x.on('close', () => res(d));
  x.on('connect', () => x.write(`GET /api/v1/health HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`));
  setTimeout(() => { x.destroy(); res(d); }, 2000);
});

describe('S7: the 512-connection cap fits staging\'s 384m (B37)', () => {
  it('512 slow bodies, then 512 sockets with 14 KiB of headers and no end: the server holds 512, the 513th gets nothing, peak RSS stays under 300 MiB, health answers after  [red if: the cap is not 512, memory grows with held sockets, or the process falls over]', async () => {
    const w = await run();
    const pid = w.proc.pid!;
    const peaks: Record<string, number> = { idle: rssMiB(pid) };
    const phase = async (name: string, first: () => string) => {
      const socks = await hold(512, first);
      await new Promise((r) => setTimeout(r, 1500));
      expect(await extraAnswer(), `${name}: connection 513 gets no answer`).toBe('');
      peaks[name] = rssMiB(pid);
      for (const s of socks) s.destroy();
      await new Promise((r) => setTimeout(r, 1500));
    };
    await phase('slow_bodies', () => `POST /sign-in HTTP/1.1\r\nHost: ${HOST}\r\nOrigin: https://${HOST}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 100000\r\n\r\n${'x'.repeat(100)}`);
    await phase('open_headers', () => `GET /sign-in HTTP/1.1\r\nHost: ${HOST}\r\nX-Pad: ${PAD}\r\nX-Pad2: ${PAD}\r\n`);
    record('S7', { ...peaks, limit_mib: 384, note: 'host RSS of main.ts with the real bundle; not a cgroup reading' });
    expect(Math.max(peaks.slow_bodies!, peaks.open_headers!)).toBeLessThan(300);
    expect(w.proc.exitCode).toBeNull();
    expect((await ask('/api/v1/health')).status).toBe(200);
  }, 120_000);
});

describe('S6: a slow reader (a measurement; run with POLY_MEASURE_S6=1)', () => {
  it.runIf(process.env.POLY_MEASURE_S6 === '1')('a client that reads one byte every 20 s of a long pipelined answer: is the connection closed, and when?', async () => {
    const w = await run();
    const files = readdirSync(join(ROOT, 'apps/web/build/client/_app/immutable'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.js'));
    const big = files.map((e) => ({ p: join(e.parentPath, e.name), n: statSync(join(e.parentPath, e.name)).size })).sort((x, y) => y.n - x.n)[0]!;
    const asset = big.p.slice(join(ROOT, 'apps/web/build/client').length);
    const first = await ask(asset);
    expect(first.status, asset).toBe(200);
    const req = `GET ${asset} HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`;
    const s = connect(3000, '127.0.0.1');
    let closedAt: number | null = null;
    s.on('error', () => {});
    s.on('close', () => { closedAt = Date.now(); });
    await new Promise<void>((r) => s.once('connect', () => r()));
    s.pause();
    s.write(req.repeat(3000));
    const t0 = Date.now();
    let bytes = 0;
    while (Date.now() - t0 < 150_000 && closedAt === null) {
      await new Promise((r) => setTimeout(r, 20_000));
      s.resume();
      const c = s.read(1);
      if (c) bytes += c.length;
      s.pause();
    }
    record('S6', { closed_after_ms: closedAt === null ? null : closedAt - t0, observed_ms: Date.now() - t0, bytes_read: bytes, server_timeout_ms: 60000, asset_bytes: first.raw.length });
    s.destroy();
    expect(w.proc.exitCode).toBeNull();
  }, 200_000);
});
