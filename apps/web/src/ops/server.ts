// The web server (POLY-161 R3, R4): the built SvelteKit handler mounted on 0.0.0.0:3000. It binds nothing else and reads no
// configuration beyond the public origin. Before the handler: the path shape and the Host pin. A throw or rejection of the handler
// is a logged event and a fixed 500; it never reaches the crash handler.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@poly/config/log';
import { CSP_HEADER } from '../lib/csp.ts';

export type WebHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

export interface WebServerOptions {
  publicOrigin: string;
  handler: WebHandler;
  log: Logger;
  /** For tests; the bind host and the production port are constants. */
  port?: number;
}

const BIND_HOST = '0.0.0.0';
const PORT = 3000;
const HEALTH_PATH = '/api/v1/health';
/** The Host that compose's healthcheck and the zone probe send over loopback. */
const LOOPBACK_HOST = '127.0.0.1:3000';

const BAD_REQUEST = '{"error":"bad request"}';
const NOT_FOUND = '{"error":"not found"}';
const MISDIRECTED = '{"error":"misdirected"}';
const INTERNAL = '{"error":"internal"}';

function fixed(res: ServerResponse, status: number, body: string, close: boolean): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    ...(close ? { connection: 'close' } : {}),
  });
  res.end(body);
}

export function startWebServer(opts: WebServerOptions): Promise<Server> {
  const { handler, log } = opts;
  const allowedHost = new URL(opts.publicOrigin).host.toLowerCase();

  const answer = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '';
    if (!url.startsWith('/') || url.startsWith('//')) return fixed(res, 400, BAD_REQUEST, true);
    const host = (req.headers.host ?? '').toLowerCase();
    const isProbe = req.method === 'GET' && url === HEALTH_PATH && req.headers.host === LOOPBACK_HOST;
    if (host !== allowedHost && !isProbe) return fixed(res, 421, MISDIRECTED, true);
    res.setHeader('content-security-policy', CSP_HEADER);
    try {
      await handler(req, res, () => fixed(res, 404, NOT_FOUND, false));
    } catch (err) {
      log.error('web.request_failed', { outcome: 'error', err });
      fixed(res, 500, INTERNAL, false);
    }
  };

  const server = createServer({ maxHeaderSize: 16 * 1024, connectionsCheckingInterval: 1000 }, (req, res) => {
    void answer(req, res);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 125_000;
  server.timeout = 60_000;
  server.maxConnections = 512;

  return new Promise((resolve) => {
    server.once('error', (err) => {
      log.fatal('web.bind_failed', { outcome: 'error', err });
      process.exit(1);
    });
    server.listen(opts.port ?? PORT, BIND_HOST, () => resolve(server));
  });
}
