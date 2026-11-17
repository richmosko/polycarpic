// Where the internal listener binds (POLY-152 R6.2, seceng E2): the service's own address on the web–auth network, or a Unix socket on a
// volume only web and auth mount. Never a wildcard, never a name that might resolve to one, and there is no default.
import { isIP } from 'node:net';

export type InternalBind = { host: string; port: number } | { path: string };

const DEFAULT_PUBLIC_PORT = 3000;

/** True for 0.0.0.0, ::, ::0, [::] and any spelling of the all-zero address. */
function unspecified(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h) === 4) return h.split('.').every((o) => Number(o) === 0);
  if (isIP(h) === 6) return h.split(':').every((g) => g === '' || /^0+$/.test(g));
  return false;
}

export function publicPort(env: Record<string, string | undefined>): number {
  const raw = env.AUTH_PUBLIC_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PUBLIC_PORT;
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= 65535)) throw new Error('AUTH_PUBLIC_PORT must be an integer from 1 to 65535');
  return n;
}

export function internalBind(env: Record<string, string | undefined>): InternalBind {
  const socket = env.AUTH_INTERNAL_SOCKET;
  if (socket !== undefined && socket !== '') {
    if (!socket.startsWith('/')) throw new Error('AUTH_INTERNAL_SOCKET must be an absolute path');
    return { path: socket };
  }
  const host = env.AUTH_INTERNAL_HOST;
  if (host === undefined || host === '') throw new Error('AUTH_INTERNAL_HOST or AUTH_INTERNAL_SOCKET is required: the internal listener has no default bind');
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare) === 0) throw new Error('AUTH_INTERNAL_HOST must be an IP address of this service, not a name');
  if (unspecified(host)) throw new Error('AUTH_INTERNAL_HOST must not be a wildcard address');
  const raw = env.AUTH_INTERNAL_PORT;
  const port = raw !== undefined && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error('AUTH_INTERNAL_PORT must be an integer from 1 to 65535');
  if (port === publicPort(env)) throw new Error('AUTH_INTERNAL_PORT must differ from AUTH_PUBLIC_PORT');
  return { host, port };
}
