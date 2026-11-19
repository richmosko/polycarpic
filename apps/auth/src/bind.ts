// Where the service's one listener binds (POLY-153 R9 removed the internal /session listener and its bind).

const DEFAULT_PUBLIC_PORT = 3000;

export function publicPort(env: Record<string, string | undefined>): number {
  const raw = env.AUTH_PUBLIC_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PUBLIC_PORT;
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= 65535)) throw new Error('AUTH_PUBLIC_PORT must be an integer from 1 to 65535');
  return n;
}
