// POLY-100 G15 / S42 (ruling.md 4ba7386b; backend-100, POLY-100g): a public listener that answers health and nothing else. Real sockets, `handleHealth` mocked (its own tests are elsewhere). Written from the
// ruling, red on the build it was written against: apps/web/src/ops/public-health.ts does not exist yet. The module exports only its start function, which takes `{port}` (tests only: 3000 is fixed).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const handleHealth = vi.fn();
vi.mock('./health.ts', () => ({ handleHealth: (...a: unknown[]) => handleHealth(...a) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const SRC = join(HERE, 'public-health.ts');
const ok = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const down = () => new Response('{"ok":false}', { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const NOT_FOUND = '{"error":"not found"}';

type Started = { port: number; server: import('node:http').Server };
let mod: Record<string, (o: { port: number }) => Promise<import('node:http').Server> | import('node:http').Server>;
const started: Started[] = [];

async function start(): Promise<Started> {
  const fn = Object.values(mod)[0]!;
  const server = await fn({ port: 0 });
  if (!server.listening) await new Promise<void>((r) => server.once('listening', () => r()));
  const s = { port: (server.address() as { port: number }).port, server };
  started.push(s);
  return s;
}
afterEach(async () => {
  for (const s of started.splice(0)) await new Promise<void>((r) => { s.server.close(() => r()); s.server.closeAllConnections?.(); });
  handleHealth.mockReset();
});
beforeAll(async () => {
  mod = (await import('./public-health.ts')) as never;
});

/** Send raw bytes, read until the server ends the connection or `ms` pass. -> everything received, and whether it closed. */
function raw(port: number, bytes: string | Buffer, ms = 3000, keepOpen = false): Promise<{ data: string; closed: boolean; sock: Socket }> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let closed = false;
    sock.on('data', (d) => chunks.push(Buffer.from(d)));
    sock.on('close', () => { closed = true; });
    sock.on('error', () => { closed = true; });
    sock.on('connect', () => sock.write(bytes));
    const done = () => resolve({ data: Buffer.concat(chunks).toString('latin1'), closed, sock });
    sock.on('close', () => setTimeout(done, 20));
    setTimeout(() => { if (!closed && !keepOpen) sock.destroy(); done(); }, ms);
  });
}
const get = (path: string, extra = '') => `GET ${path} HTTP/1.1\r\nHost: x\r\n${extra}\r\n`;
const parse = (data: string) => {
  const [head, ...rest] = data.split('\r\n\r\n');
  const lines = head!.split('\r\n');
  const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  return { status: Number(/HTTP\/1\.1 (\d+)/.exec(lines[0]!)?.[1]), headers, body: rest.join('\r\n\r\n') };
};

describe('G15: the public health listener (real sockets)', () => {
  it('the module exports exactly one function, its start function', () => {
    expect(Object.keys(mod).length).toBe(1);
    expect(typeof Object.values(mod)[0]).toBe('function');
  });

  it('GET /api/v1/health: 200 with handleHealth\'s byte-equal body and exactly the ruled headers (content-type, cache-control, connection: close, and what Node itself adds)', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    const r = parse((await raw(port, get('/api/v1/health'))).data);
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"ok":true}');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.connection).toBe('close');
    expect(Object.keys(r.headers).filter((h) => !['content-type', 'cache-control', 'connection', 'content-length', 'date'].includes(h)), 'nothing else').toEqual([]);
  });

  it('a health that is not ok is 503 with its body; a handler that throws is 503 {"ok":false}', async () => {
    handleHealth.mockImplementation(async () => down());
    const { port } = await start();
    const a = parse((await raw(port, get('/api/v1/health'))).data);
    expect([a.status, a.body]).toEqual([503, '{"ok":false}']);
    handleHealth.mockImplementation(async () => { throw new Error('probe exploded'); });
    const b = parse((await raw(port, get('/api/v1/health'))).data);
    expect([b.status, b.body]).toEqual([503, '{"ok":false}']);
  });

  it('every other request is the fixed 404 with the same headers: query, trailing slash, //, %2e, upper case, absolute form, HEAD, POST with a body, OPTIONS, other paths', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    const cases = [get('/api/v1/health?x=1'), get('/api/v1/health/'), get('//api/v1/health'), get('/api/v1/%68ealth'), get('/API/V1/HEALTH'), get('/api/v1/health%2e'), get('http://x/api/v1/health'),
      get('/'), get('/status'), get('/metrics'), `HEAD /api/v1/health HTTP/1.1\r\nHost: x\r\n\r\n`, `OPTIONS /api/v1/health HTTP/1.1\r\nHost: x\r\n\r\n`,
      `POST /api/v1/health HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\n\r\nabcd`];
    for (const c of cases) {
      const res = (await raw(port, c)).data;
      const r = parse(res);
      expect(r.status, JSON.stringify(c.split('\r\n')[0])).toBe(404);
      if (!c.startsWith('HEAD')) expect(r.body).toBe(NOT_FOUND);
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('nothing the client sent comes back or reaches a log: a cookie, x-forwarded-for, host and the path', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    const logs: string[] = [];
    const w1 = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { logs.push(String(c)); return true; });
    const w2 = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { logs.push(String(c)); return true; });
    const res = (await raw(port, `GET /planted-path-MARK HTTP/1.1\r\nHost: planted-host-MARK\r\nCookie: sid=planted-cookie-MARK\r\nX-Forwarded-For: 203.0.113.99\r\n\r\n`)).data;
    const res2 = (await raw(port, `GET /api/v1/health HTTP/1.1\r\nHost: planted-host-MARK\r\nCookie: sid=planted-cookie-MARK\r\nX-Forwarded-For: 203.0.113.99\r\n\r\n`)).data;
    w1.mockRestore(); w2.mockRestore();
    for (const mark of ['planted-path-MARK', 'planted-host-MARK', 'planted-cookie-MARK', '203.0.113.99']) {
      expect(res + res2, `${mark} echoed`).not.toContain(mark);
      expect(logs.join(''), `${mark} logged`).not.toContain(mark);
    }
  });

  it('upgrade and Expect get a fixed answer and then the connection closes (not a silent destroy: Caddy retries a failed upstream GET)', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    for (const extra of ['Connection: Upgrade\r\nUpgrade: websocket\r\n', 'Expect: 100-continue\r\n']) {
      const r = await raw(port, get('/nope', extra), 3000);
      expect(r.data.startsWith('HTTP/1.1 '), `no answer to ${extra.trim()}`).toBe(true);
      expect(r.closed, 'the connection is closed after the answer').toBe(true);
      expect(parse(r.data).body).toBe(NOT_FOUND);
    }
  });

  it('CONNECT and garbage are closed with no bytes', async () => {
    const { port } = await start();
    for (const bytes of ['CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n', '\x00\x01\x02 garbage \r\n\r\n', 'GET / HTP/9.9\r\n\r\n']) {
      const r = await raw(port, bytes, 3000);
      expect(r.data, JSON.stringify(bytes)).toBe('');
      expect(r.closed).toBe(true);
    }
  });

  it('a POST whose body is never read still receives the whole 404, flushed before the close', async () => {
    const { port } = await start();
    const r = await raw(port, `POST /x HTTP/1.1\r\nHost: x\r\nContent-Length: 1000000\r\n\r\n${'A'.repeat(20000)}`, 3000);
    expect(parse(r.data).status).toBe(404);
    expect(parse(r.data).body).toBe(NOT_FOUND);
    expect(r.closed).toBe(true);
  });

  it('slow headers and a body never finished are closed in time (headersTimeout and requestTimeout 5 s)', async () => {
    const { port } = await start();
    const slow = await raw(port, 'GET /api/v1/health HTTP/1.1\r\nHost: x\r\nX-Slow: ', 9000);
    expect(slow.closed, 'a request with unfinished headers was held open').toBe(true);
    const stuck = await raw(port, 'POST /x HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nabc', 9000);
    expect(stuck.closed, 'an unfinished body was held open').toBe(true);
  }, 30_000);

  it('9 KiB of headers is refused', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    const r = await raw(port, get('/api/v1/health', `X-Big: ${'a'.repeat(9 * 1024)}\r\n`));
    expect(parse(r.data).status === 200, 'headers over 8 KiB were served').toBe(false);
  });

  it('the 65th connection is refused while the first 64 stay served', async () => {
    handleHealth.mockImplementation(async () => ok());
    const { port } = await start();
    const held: Socket[] = [];
    for (let i = 0; i < 64; i++) {
      const s = connect(port, '127.0.0.1');
      s.on('error', () => undefined);
      await new Promise<void>((r) => s.once('connect', () => { s.write('GET /api/v1/health HTTP/1.1\r\nHost: x\r\nX-Hold: '); r(); }));
      held.push(s);
    }
    const extra = await raw(port, get('/api/v1/health'), 2500);
    expect(extra.data, 'the 65th connection was served').toBe('');
    const answers: string[] = [];
    held[0]!.on('data', (d) => answers.push(String(d)));
    held[0]!.write('y\r\n\r\n');
    await new Promise((r) => setTimeout(r, 800));
    expect(answers.join('')).toContain('200');
    for (const s of held) s.destroy();
  }, 20_000);

  it('the limits are the ruled ones, and every answer is on a socket that is closed after it (maxRequestsPerSocket 1, connection: close)', async () => {
    const { server } = await start();
    expect([server.headersTimeout, server.requestTimeout, server.keepAliveTimeout, server.maxConnections, server.maxRequestsPerSocket]).toEqual([5000, 5000, 1000, 64, 1]);
    expect((server as unknown as { connectionsCheckingInterval: number }).connectionsCheckingInterval).toBe(1000);
  });

  it('a port in use ends the process with exit 1 (a bind failure is never survived)', () => {
    const r = spawnSync(process.execPath, ['-e', `
      const net=require('net');
      const s=net.createServer().listen(0,'0.0.0.0',()=>{
        const p=s.address().port;
        import(${JSON.stringify(SRC)}).then((m)=>Object.values(m)[0]({port:p})).catch(()=>process.exit(7));
      });
    `], { encoding: 'utf8', timeout: 8000 });
    expect(r.status, r.stderr).toBe(1);
  });
});

describe('G15: source and agreement', () => {
  const src = () => readFileSync(SRC, 'utf8');

  it('one createServer, no other export, no import beyond node:http and ./health.ts; 0.0.0.0 and 3000 are constants and nothing reads the environment', () => {
    const s = src();
    expect((s.match(/createServer\(/g) ?? []).length).toBe(1);
    expect((s.match(/^export /gm) ?? []).length).toBe(1);
    const imports = [...s.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./health.ts', 'node:http']);
    expect(s).toMatch(/['"]0\.0\.0\.0['"]/);
    expect(s).toMatch(/\b3000\b/);
    expect(s, 'the bind must not be configurable').not.toMatch(/process\.env/);
  });

  it('main.ts starts it once, after init() and the status listener', () => {
    const m = readFileSync(join(HERE, '..', 'main.ts'), 'utf8');
    expect((m.match(/startPublicHealth|public-health/g) ?? []).length).toBeGreaterThanOrEqual(2); // the import and the call
    const iInit = m.indexOf('init(');
    const iStatus = m.indexOf('startStatusServer(');
    const iPublic = m.search(/\bawait\s+start\w*Health\w*\(|\bstart\w*Public\w*\(/);
    expect(iPublic, 'main.ts never starts the public listener').toBeGreaterThan(-1);
    expect(iPublic).toBeGreaterThan(iInit);
    expect(iPublic).toBeGreaterThan(iStatus);
  });

  it('the module, compose\'s web healthcheck, R7\'s probe and the Caddyfile agree on port 3000 and /api/v1/health, and the healthcheck requires 200', () => {
    const probe = readFileSync(join(ROOT, 'infra/ops/lib/stack.py'), 'utf8');
    expect(probe).toContain('127.0.0.1:3000/api/v1/health');
    for (const f of ['prod', 'staging']) {
      const y = readFileSync(join(ROOT, `infra/compose/${f}.yml`), 'utf8');
      const web = y.slice(y.indexOf('\n  web:'), y.indexOf('\n  auth:'));
      expect(web, `${f}: web's healthcheck`).toContain('127.0.0.1:3000/api/v1/health');
      expect(web, `${f}: web's healthcheck must require exactly 200 (a 404 must not pass)`).toMatch(/status===200|status === 200/);
      expect(web).not.toMatch(/status<500/);
    }
    const caddy = readFileSync(join(ROOT, 'infra/caddy/Caddyfile'), 'utf8');
    expect(caddy).toContain('prod-web:3000');
    expect(caddy).toContain('staging-web:3000');
  });
});
