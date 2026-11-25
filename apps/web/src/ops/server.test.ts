// POLY-161c R3 / R4 (verdict B16 to B21, A7; seceng S6/S7 are measured in tests/db/web-server.test.ts and the gate record): the web server's checks
// and limits, driven over real sockets with `node:http` or raw bytes (fetch cannot set Host). Where a limit is configured, the value is asserted
// AND the limit is driven. The handler is a fake of the bundle; the server and its sockets are the product's. Red today: ops/server.ts does not exist.
import { type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { Writable } from 'node:stream';
import { createLogger } from '@poly/config/log';
import { afterEach, describe, expect, it } from 'vitest';

const CANARY = ['canary', 'zq7', 'srv'].join('-');
const ORIGIN = 'staging.example.com';
type H = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => unknown;

const handlerSeen: Array<{ url: string; host: string | undefined }> = [];
const handler: H = async (req, res, next) => {
  handlerSeen.push({ url: req.url ?? '', host: req.headers.host });
  const path = (req.url ?? '').split('?')[0];
  if (path === '/ok') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (path === '/next') return next();
  if (path === '/throw') throw new Error(CANARY);
  if (path === '/reject') throw Object.assign(new Error(CANARY), { code: 'EZQ' });
  if (path === '/late-reject') { res.writeHead(200); res.write('partial'); await new Promise((r) => setTimeout(r, 30)); throw new Error(CANARY); }
  if (path === '/hang') return new Promise(() => {});
  if (path === '/body') { let n = 0; for await (const c of req) n += (c as Buffer).length; res.writeHead(200); res.end(String(n)); return; }
  if (path === '/api/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  res.writeHead(200); res.end('other');
};

const servers: Server[] = [];
const socks: Socket[] = [];
afterEach(async () => {
  for (const s of socks.splice(0)) s.destroy();
  for (const s of servers.splice(0)) await new Promise<void>((r) => { s.close(() => r()); s.closeAllConnections(); });
  handlerSeen.length = 0;
});

function capture() {
  const raw: string[] = [];
  const log = createLogger({ service: 'web', stream: new Writable({ write(c, _e, cb) { raw.push(String(c)); cb(); } }) });
  return { log, text: () => raw.join(''), lines: () => raw.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) };
}
async function start(opts: { origin?: string; h?: H } = {}) {
  const { startWebServer } = (await import('./server.ts')) as { startWebServer: (o: { publicOrigin: string; handler: H; log: unknown; port: number }) => Promise<Server> };
  const c = capture();
  const server = await startWebServer({ publicOrigin: opts.origin ?? `https://${ORIGIN}`, handler: opts.h ?? handler, log: c.log, port: 0 });
  if (!server.listening) await new Promise<void>((r) => server.once('listening', () => r()));
  servers.push(server);
  return { server, port: (server.address() as { port: number }).port, c };
}

/** Send raw bytes; resolve with everything received once the server closes, or after `ms`. */
function raw(port: number, bytes: string | Buffer, ms = 3000): Promise<{ data: string; closed: boolean; sock: Socket; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = connect(port, '127.0.0.1');
    socks.push(sock);
    const chunks: Buffer[] = [];
    let closed = false;
    let done = false;
    const fin = () => { if (done) return; done = true; resolve({ data: Buffer.concat(chunks).toString('latin1'), closed, sock, ms: Date.now() - t0 }); };
    sock.on('data', (d) => chunks.push(Buffer.from(d)));
    sock.on('close', () => { closed = true; setTimeout(fin, 10); });
    sock.on('error', () => { closed = true; });
    sock.on('connect', () => sock.write(bytes));
    setTimeout(() => { if (!closed) sock.destroy(); fin(); }, ms);
  });
}
const get = (path: string, host: string | null = ORIGIN, extra = '', method = 'GET') => `${method} ${path} HTTP/1.1\r\n${host === null ? '' : `Host: ${host}\r\n`}${extra}Connection: close\r\n\r\n`;
const parse = (data: string) => {
  const [head = '', ...rest] = data.split('\r\n\r\n');
  const lines = head.split('\r\n');
  const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  let body = rest.join('\r\n\r\n');
  if (headers['transfer-encoding'] === 'chunked') {
    let out = '';
    for (let i = 0; i < body.length;) {
      const nl = body.indexOf('\r\n', i);
      const n = parseInt(body.slice(i, nl), 16);
      if (!n) break;
      out += body.slice(nl + 2, nl + 2 + n);
      i = nl + 2 + n + 2;
    }
    body = out;
  }
  return { status: Number(/HTTP\/1\.[01] (\d+)/.exec(lines[0]!)?.[1] ?? 0), headers, body };
};
const fixed = (status: number, body: string) => ({ status, body });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('R4: configured limits (read), each also driven below', () => {
  it('the ruled values  [red if: any limit differs from R4]', async () => {
    const { server } = await start();
    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(125_000);
    expect(server.timeout).toBe(60_000);
    expect(server.maxConnections).toBe(512);
    expect(server.maxRequestsPerSocket ?? 0).toBe(0);
    expect(server.connectionsCheckingInterval).toBe(1000);
  });
});

describe('R4: the Host pin and the path shape (B19, B20)', () => {
  it('the right Host in any case reaches the handler  [red if: the positive case is refused, or case matters]', async () => {
    const { port } = await start();
    for (const h of [ORIGIN, ORIGIN.toUpperCase(), 'Staging.Example.COM']) {
      const r = parse((await raw(port, get('/ok', h))).data);
      expect(r.status, h).toBe(200);
      expect(r.body).toBe('ok');
    }
  });

  it.each([
    ['another host', 'evil.example'],
    ['a port the origin does not have', `${ORIGIN}:8443`],
    ['the host as a suffix', `x${ORIGIN}`],
    ['the host as a prefix', `${ORIGIN}.evil.example`],
    ['a path inside Host (M5)', `${ORIGIN}/sign-in?`],
    ['userinfo', `a@${ORIGIN}`],
    ['empty', ''],
  ])('Host %s is the fixed 421 and never reaches the handler  [red if: it is answered, or the body or headers differ]', async (_n, host) => {
    const { port } = await start();
    const r = parse((await raw(port, get('/ok', host))).data);
    expect(fixed(r.status, r.body)).toEqual(fixed(421, '{"error":"misdirected"}'));
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.connection).toBe('close');
    expect(handlerSeen).toEqual([]);
  });

  it('no Host header at all (HTTP/1.0) is 421  [red if: undefined is treated as a match]', async () => {
    const { port } = await start();
    const r = parse((await raw(port, 'GET /ok HTTP/1.0\r\n\r\n')).data);
    expect(r.status).toBe(421);
    expect(handlerSeen).toEqual([]);
  });

  it('an origin with a port pins the port too  [red if: the port is ignored]', async () => {
    const { port } = await start({ origin: 'https://staging.example.com:8443' });
    expect(parse((await raw(port, get('/ok', 'staging.example.com:8443'))).data).status).toBe(200);
    expect(parse((await raw(port, get('/ok', 'staging.example.com'))).data).status).toBe(421);
    expect(parse((await raw(port, get('/ok', 'staging.example.com:9'))).data).status).toBe(421);
  });

  it('the one exception: GET exactly /api/v1/health with Host exactly 127.0.0.1:3000 reaches the handler  [red if: the probe is refused]', async () => {
    const { port } = await start();
    const r = parse((await raw(port, get('/api/v1/health', '127.0.0.1:3000'))).data);
    expect([r.status, r.body]).toEqual([200, '{"ok":true}']);
  });

  it.each([
    ['another path', 'GET', '/ok', '127.0.0.1:3000'],
    ['the dashboard', 'GET', '/dashboard', '127.0.0.1:3000'],
    ['health with a query', 'GET', '/api/v1/health?x', '127.0.0.1:3000'],
    ['health with a trailing slash', 'GET', '/api/v1/health/', '127.0.0.1:3000'],
    ['health by POST', 'POST', '/api/v1/health', '127.0.0.1:3000'],
    ['health by HEAD', 'HEAD', '/api/v1/health', '127.0.0.1:3000'],
    ['health on another loopback port', 'GET', '/api/v1/health', '127.0.0.1:3001'],
    ['health on localhost', 'GET', '/api/v1/health', 'localhost:3000'],
    ['health on a wrong host', 'GET', '/api/v1/health', 'evil.example'],
  ])('%s with Host %4$s is 421  [red if: the loopback Host is admitted beyond the one probe]', async (_n, method, path, host) => {
    const { port } = await start();
    const r = parse((await raw(port, get(path, host, '', method))).data);
    expect(r.status).toBe(421);
    expect(handlerSeen).toEqual([]);
  });

  it.each([['//evil.example/x'], ['//'], ['*'], ['http://evil.example/x']])('request target %j is the fixed 400  [red if: it reaches the handler]', async (target) => {
    const { port } = await start();
    const r = parse((await raw(port, `${target === '*' ? 'OPTIONS' : 'GET'} ${target} HTTP/1.1\r\nHost: ${ORIGIN}\r\nConnection: close\r\n\r\n`)).data);
    expect(fixed(r.status, r.body)).toEqual(fixed(400, '{"error":"bad request"}'));
    expect(r.headers.connection).toBe('close');
    expect(handlerSeen).toEqual([]);
  });

  it('a single leading slash is fine: `/x`, `/a//b`, `/?q=//`  [red if: the check over-refuses]', async () => {
    const { port } = await start();
    for (const p of ['/x', '/a//b', '/?q=//']) expect(parse((await raw(port, get(p))).data).status, p).toBe(200);
  });
});

describe('R3: next, errors and rejections (B17)', () => {
  it('next() is the fixed 404 body  [red if: the body differs]', async () => {
    const { port } = await start();
    const r = parse((await raw(port, get('/next'))).data);
    expect(fixed(r.status, r.body)).toEqual(fixed(404, '{"error":"not found"}'));
  });

  it('a synchronous throw is the fixed 500; the server answers the next request; the log has the event and no message  [red if: the throw reaches the crash handler or the message is logged]', async () => {
    const { port, c } = await start();
    const r = parse((await raw(port, get('/throw'))).data);
    expect(fixed(r.status, r.body)).toEqual(fixed(500, '{"error":"internal"}'));
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
    const ev = c.lines().filter((l) => l.event === 'web.request_failed');
    expect(ev).toHaveLength(1);
    expect(c.text()).not.toContain(CANARY);
  });

  it('a rejection before headers is the fixed 500 and the same process answers on  [red if: the rejection is unhandled]', async () => {
    const { port, c } = await start();
    const r = parse((await raw(port, get('/reject'))).data);
    expect(fixed(r.status, r.body)).toEqual(fixed(500, '{"error":"internal"}'));
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
    expect(c.lines().find((l) => l.event === 'web.request_failed')?.err).toMatchObject({ code: 'EZQ' });
  });

  it('a rejection after headers are out destroys the socket (no second status line) and the server lives  [red if: a 500 is appended to a started answer]', async () => {
    const { port, c } = await start();
    const r = await raw(port, get('/late-reject'));
    expect(r.closed).toBe(true);
    expect(r.data).toContain('HTTP/1.1 200');
    expect(r.data).not.toContain('HTTP/1.1 500');
    expect(r.data).not.toContain('internal');
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
    expect(c.lines().filter((l) => l.event === 'web.request_failed')).toHaveLength(1);
    expect(c.text()).not.toContain(CANARY);
  });
});

describe('R4: keep-alive and Node\'s own answers (M8)', () => {
  it('two requests on one connection are both answered  [red if: maxRequestsPerSocket 1 or connection: close survives from the stand-in]', async () => {
    const { port } = await start();
    const two = 'GET /ok HTTP/1.1\r\nHost: ' + ORIGIN + '\r\n\r\nGET /ok HTTP/1.1\r\nHost: ' + ORIGIN + '\r\nConnection: close\r\n\r\n';
    const r = await raw(port, two);
    expect(r.data.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
    expect(r.data.split('\r\n\r\n')[0]!.toLowerCase()).not.toContain('connection: close');
  });

  it('a connection idle for 3 s is still open, so the 1 s stand-in value is gone  [red if: keepAliveTimeout is the old 1 s]', async () => {
    const { port } = await start();
    const r = await raw(port, `GET /ok HTTP/1.1\r\nHost: ${ORIGIN}\r\n\r\n`, 3200);
    expect(r.closed).toBe(false);
  }, 10_000);

  it('headers over 16 KiB are 431 with no body; just under are served  [red if: the limit is the old 8 KiB or higher than 16 KiB]', async () => {
    const { port } = await start();
    const mk = (n: number) => get('/ok', ORIGIN, `X-Pad: ${'a'.repeat(n)}\r\n`);
    const big = parse((await raw(port, mk(17 * 1024))).data);
    expect(big.status).toBe(431);
    expect(big.body).toBe('');
    expect(parse((await raw(port, mk(15 * 1024))).data).status).toBe(200);
    expect(parse((await raw(port, mk(9 * 1024))).data).status, '9 KiB served: the old limit is gone').toBe(200);
  });

  it('garbage is Node\'s 400 and CONNECT closes with no bytes; neither echoes the client  [red if: our handler or a destroyed socket replaces Node\'s answer]', async () => {
    const { port } = await start();
    const g = await raw(port, `${CANARY}\r\n\r\n`);
    expect(g.data).toMatch(/^HTTP\/1\.1 400/);
    expect(g.data).not.toContain(CANARY);
    const c = await raw(port, `CONNECT ${CANARY}:443 HTTP/1.1\r\nHost: ${CANARY}\r\n\r\n`);
    expect(c.data).not.toContain(CANARY);
  });
});

describe('R4: timers driven, not read (B16)', () => {
  it('slow headers closed near 10 s; a slow body near 30 s; a hung handler near 60 s; all three in parallel  [red if: a timer is missing, or the old 5 s values remain]', async () => {
    const { port } = await start();
    const slowHeaders = raw(port, `GET /ok HTTP/1.1\r\nHost: ${ORIGIN}\r\nX-A: b`, 70_000);
    const slowBody = raw(port, `POST /body HTTP/1.1\r\nHost: ${ORIGIN}\r\nContent-Length: 100\r\n\r\nabc`, 70_000);
    const hung = raw(port, `GET /hang HTTP/1.1\r\nHost: ${ORIGIN}\r\n\r\n`, 75_000);
    const [h, b, g] = await Promise.all([slowHeaders, slowBody, hung]);
    expect(h.closed, 'slow headers closed').toBe(true);
    expect(h.ms).toBeGreaterThanOrEqual(9_000);
    expect(h.ms).toBeLessThan(14_000);
    expect(b.closed, 'slow body closed').toBe(true);
    expect(b.ms).toBeGreaterThanOrEqual(28_000);
    expect(b.ms).toBeLessThan(36_000);
    expect(g.closed, 'hung handler closed').toBe(true);
    expect(g.ms).toBeGreaterThanOrEqual(58_000);
    expect(g.ms).toBeLessThan(68_000);
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
  }, 100_000);
});

describe('R4: aborts (B18)', () => {
  it('a battery of client resets mid-headers, mid-body and mid-answer leaves the same server answering and logs no crash  [red if: an abort reaches the crash handler]', async () => {
    const { port, c } = await start({
      h: async (req, res, next) => {
        const p = req.url;
        if (p === '/stream') { res.writeHead(200); for (let i = 0; i < 200; i++) { if (!res.write(Buffer.alloc(65536, 97))) await new Promise((r) => res.once('drain', r)); } res.end(); return; }
        return handler(req, res, next);
      },
    });
    const aborts: Array<[string, (s: Socket) => void]> = [
      ['mid-headers', (s) => { s.write(`GET /ok HTTP/1.1\r\nHost: ${ORIGIN}\r\nX`); s.destroy(); }],
      ['mid-body', (s) => { s.write(`POST /body HTTP/1.1\r\nHost: ${ORIGIN}\r\nContent-Length: 1000\r\n\r\nabc`); s.destroy(); }],
      ['mid-answer', (s) => { s.write(`GET /stream HTTP/1.1\r\nHost: ${ORIGIN}\r\n\r\n`); s.once('data', () => s.resetAndDestroy()); }],
      ['at once', (s) => { s.resetAndDestroy(); }],
      ['after the request', (s) => { s.write(`GET /hang HTTP/1.1\r\nHost: ${ORIGIN}\r\n\r\n`); setTimeout(() => s.resetAndDestroy(), 20); }],
    ];
    for (let round = 0; round < 6; round++) {
      for (const [, fn] of aborts) { const s = connect(port, '127.0.0.1'); socks.push(s); s.on('error', () => {}); s.on('connect', () => fn(s)); }
    }
    await sleep(600);
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
    expect(c.lines().filter((l) => l.event === 'process.crash')).toEqual([]);
  });
});

describe('R4: the connection cap (B37, S7)', () => {
  it('512 sockets are held, the 513th gets no answer, and a closed one frees a slot  [red if: the cap is 64, absent, or counts something else]', async () => {
    const { port, server } = await start();
    const open: Socket[] = [];
    for (let i = 0; i < 512; i++) {
      const s = connect(port, '127.0.0.1');
      s.on('error', () => {});
      socks.push(s);
      open.push(s);
    }
    await Promise.all(open.map((s) => new Promise<void>((r) => s.once('connect', () => r()))));
    await sleep(300);
    expect(await new Promise<number>((r) => server.getConnections((_e, n) => r(n))), 'the server counts 512').toBe(512);
    const extra = await raw(port, get('/ok'), 1500);
    expect(extra.data, 'connection 513 is refused').toBe('');
    open[0]!.destroy();
    await sleep(300);
    expect(parse((await raw(port, get('/ok'))).data).status).toBe(200);
  }, 30_000);
});
