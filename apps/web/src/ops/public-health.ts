// The public health listener (POLY-100 G15, S42): answers GET /api/v1/health and nothing else, on 0.0.0.0:3000.
// A stand-in for the web server POLY-161 brings; that server replaces this file. One handler, no router, no
// configuration: nothing in the environment moves the bind, and nothing the client sends is read, echoed or logged.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handleHealth } from './health.ts';

const BIND_HOST = '0.0.0.0';
const PORT = 3000;
const HEALTH_PATH = '/api/v1/health';
const OK = '{"ok":true}';
const DOWN = '{"ok":false}';
const NOT_FOUND = '{"error":"not found"}';

async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let status = 404;
  let body = NOT_FOUND;
  if (req.method === 'GET' && req.url === HEALTH_PATH) {
    try {
      const r = await handleHealth();
      const text = await r.text();
      if ((r.status === 200 && text === OK) || (r.status === 503 && text === DOWN)) {
        status = r.status;
        body = text;
      } else {
        status = 503;
        body = DOWN;
      }
    } catch {
      status = 503;
      body = DOWN;
    }
  }
  // The request body is never consumed: the answer is flushed whole, then the socket is destroyed.
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': String(body.length), connection: 'close' });
  res.end(body, () => req.socket.destroy());
}

export function startPublicHealth(opts: { port?: number } = {}): Promise<Server> {
  const server = createServer({ maxHeaderSize: 8 * 1024, connectionsCheckingInterval: 1000, keepAliveTimeout: 1000 }, (req, res) => {
    void answer(req, res);
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  // `Expect` requests get the same fixed answer, never a 100 Continue or a silent destroy (Caddy retries a failed GET).
  server.on('checkContinue', (req, res) => void answer(req, res));
  server.on('checkExpectation', (req, res) => void answer(req, res));
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('clientError', (_e, socket) => socket.destroy());
  return new Promise((resolve) => {
    server.once('error', () => {
      process.stderr.write('{"msg":"public-health.bind_failed","outcome":"error"}\n');
      process.exit(1);
    });
    server.listen(opts.port ?? PORT, BIND_HOST, () => resolve(server));
  });
}
