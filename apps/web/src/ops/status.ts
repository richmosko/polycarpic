// The status listener (POLY-85 R4): loopback only, read-only, no tenant data. It has no `ports:` mapping and no Caddy
// route (TB-13); host scripts reach it with `docker compose exec web polycarpic status`. POLY-81 moves it to an admin service.
import { createServer, type Server } from 'node:http';
import { probe } from './probe.ts';

/** A constant, not configuration: nothing in the environment can widen the bind (R4). */
const BIND_HOST = '127.0.0.1';
export const DEFAULT_STATUS_PORT = 8081;

export interface StatusOptions {
  /** Defaults to STATUS_PORT (validated by loadConfig) or 8081. */
  port?: number;
}

async function payload(startedAt: string, commit: string | null): Promise<string> {
  const p = await probe();
  return JSON.stringify({
    v: 1,
    service: 'web',
    commit,
    started_at: startedAt,
    db: { ok: p.db.ok },
    schema: { state: p.schema.state, expected: p.schema.expected, applied: p.schema.applied },
    jobs: {}, // filled by the first worker job feature, from its run record
  });
}

export function startStatusServer(opts: StatusOptions = {}): Promise<Server> {
  const port = opts.port ?? (Number(process.env.STATUS_PORT) || DEFAULT_STATUS_PORT);
  const startedAt = new Date().toISOString();
  const rev = process.env.POLY_IMAGE_REVISION;
  const commit = rev && /^[0-9a-f]{40}$/.test(rev) ? rev : null;
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const send = (status: number, body: string, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    if (path !== '/status') return send(404, '{"error":"not found"}');
    if (req.method !== 'GET') return send(405, '{"error":"method not allowed"}', { allow: 'GET' });
    payload(startedAt, commit).then(
      (body) => send(200, body),
      () => send(500, '{"error":"unavailable"}'),
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, BIND_HOST, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
