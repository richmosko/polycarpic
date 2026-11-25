// POLY-161c seam pins: ruling.md R12 (with addenda 1 and 2 @ 075e4e0e). File names, exported names, the fixed bodies and the
// zone skip answer, as small failing tests, so frontend-161 and devops-161 build to one seam. The behavioural suites follow
// the thin slice. The stand-in listener's absence is pinned in tests/ci/one-listener.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const has = (rel: string) => existsSync(join(WEB, rel));

describe('R12 seam: files and exports', () => {
  it('the modules the ruling names exist  [red if: any is missing]', () => {
    for (const f of [
      'src/ops/server.ts',
      'src/ops/zone.ts',
      'src/ops/console.ts',
      'src/lib/public-routes.ts',
      'src/lib/csp.ts',
      'src/routes/api/v1/health/+server.ts',
      'bundle-packages.ts',
      'bundle-packages.txt',
    ]) expect(has(f), f).toBe(true);
  });

  it('server.ts exports startWebServer; zone.ts verifyZone; console.ts guardConsole  [red if: names differ]', async () => {
    expect(typeof (await import('./ops/server.ts')).startWebServer).toBe('function');
    expect(typeof (await import('./ops/zone.ts')).verifyZone).toBe('function');
    expect(typeof (await import('./ops/console.ts')).guardConsole).toBe('function');
  });

  it('PUBLIC_ROUTES is exactly the seven ruled paths  [red if: a prefix, /healthz, or an extra path]', async () => {
    const { PUBLIC_ROUTES } = await import('./lib/public-routes.ts');
    expect([...PUBLIC_ROUTES].sort()).toEqual(
      ['/api/v1/health', '/sign-in', '/sign-in/cancel-method', '/sign-in/forgot', '/sign-in/reset', '/sign-in/second-step', '/sign-up'].sort(),
    );
  });

  it('hooks.server.ts exports handle and handleError  [red if: handleError is missing]', async () => {
    const m = await import('./hooks.server.ts');
    expect(typeof m.handle).toBe('function');
    expect(typeof m.handleError).toBe('function');
  });

  it('the health route file exports GET and nothing else  [red if: another verb or helper is exported]', () => {
    const src = readFileSync(join(WEB, 'src/routes/api/v1/health/+server.ts'), 'utf8');
    const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
    expect(names).toEqual(['GET']);
  });
});

describe('R12 seam: zone skip', () => {
  it('verifyZone(undefined) answers skipped and queries nothing  [red if: undefined is looked up]', async () => {
    const { verifyZone } = await import('./ops/zone.ts');
    const lines: unknown[] = [];
    const log = { debug() {}, info: (...a: unknown[]) => lines.push(a), warn: (...a: unknown[]) => lines.push(a), error: (...a: unknown[]) => lines.push(a), fatal: (...a: unknown[]) => lines.push(a) };
    expect(await verifyZone(undefined, { log: log as never, resolvers: ['127.0.0.1:1'] })).toBe('skipped');
  });
});

describe('R12 seam: fixed bodies of startWebServer', () => {
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
  async function ask(port: number, path: string, host: string): Promise<{ status: number; body: string; type: string | undefined }> {
    return new Promise((resolve, reject) => {
      const r = request({ port, host: '127.0.0.1', path, headers: { host } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), type: res.headers['content-type'] }));
      });
      r.on('error', reject);
      r.end();
    });
  }
  async function withServer<T>(handler: (req: never, res: never, next: () => void) => unknown, fn: (port: number) => Promise<T>): Promise<T> {
    const { startWebServer } = await import('./ops/server.ts');
    const server = await startWebServer({ publicOrigin: 'https://staging.example.com', handler: handler as never, log: quiet as never, port: 0 });
    if (!server.listening) await new Promise<void>((r) => server.once('listening', () => r()));
    try {
      return await fn((server.address() as { port: number }).port);
    } finally {
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
    }
  }

  it('next() is the fixed 404; a wrong Host is the fixed 421; a throwing handler is the fixed 500  [red if: any body differs]', async () => {
    await withServer((_q, _s, next) => next(), async (port) => {
      const a = await ask(port, '/x', 'staging.example.com');
      expect([a.status, a.body, a.type]).toEqual([404, '{"error":"not found"}', 'application/json']);
      const b = await ask(port, '/x', 'evil.example');
      expect([b.status, b.body]).toEqual([421, '{"error":"misdirected"}']);
    });
    await withServer(() => { throw new Error('boom'); }, async (port) => {
      const c = await ask(port, '/x', 'staging.example.com');
      expect([c.status, c.body]).toEqual([500, '{"error":"internal"}']);
    });
  });

  it('a path not starting with a single slash is the fixed 400  [red if: // reaches the handler]', async () => {
    await withServer((_q, _s, next) => next(), async (port) => {
      const r = await ask(port, '//evil.example/x', 'staging.example.com');
      expect([r.status, r.body]).toEqual([400, '{"error":"bad request"}']);
    });
  });
});
