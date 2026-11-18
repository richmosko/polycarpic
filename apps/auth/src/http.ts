// The bridge between node:http and the fetch-style handlers: one listener, one handler, a fixed origin for the Request's URL.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type Handler = (request: Request) => Promise<Response>;

function toRequest(req: IncomingMessage, base: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const method = req.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(new URL(req.url ?? '/', base), init);
}

async function send(res: ServerResponse, out: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  out.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v;
  });
  const cookies = out.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(out.status, headers);
  if (out.body) await pipeline(Readable.fromWeb(out.body as never), res);
  else res.end();
}

export function listener(base: string, handle: Handler, onError: (e: unknown) => void): Server {
  return createServer((req, res) => {
    (async () => {
      try {
        await send(res, await handle(toRequest(req, base)));
      } catch (e) {
        onError(e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        if (!res.writableEnded) res.end(JSON.stringify({ message: 'Internal error' }));
      }
    })();
  });
}

export const listen = (server: Server, where: { host?: string; port?: number; path?: string }): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(where, () => {
      server.off('error', reject);
      resolve();
    });
  });

export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
