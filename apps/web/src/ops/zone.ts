// The zone check at start (POLY-161 R7, SECURITY C-76): in real-domain mode the box's registrable domain must exist in the public
// DNS before web listens. Two public resolvers are asked in parallel for the zone's SOA, never the container's own, and the whole
// check is bounded by our own timer. An SOA verifies. NXDOMAIN from every resolver refuses. Anything else starts unverified and
// is retried; a later all-NXDOMAIN is logged and never ends a running server. The zone name is never logged.
import { Resolver } from 'node:dns/promises';
import type { Logger } from '@poly/config/log';

export type ZoneResult = 'verified' | 'unverified' | 'refused' | 'skipped';

export interface ZoneOptions {
  log: Logger;
  resolvers?: string[];
  timeoutMs?: number;
  retryMs?: number;
}

type Answer = { kind: 'soa' } | { kind: 'nx'; code: string } | { kind: 'other'; code?: string };

const DEFAULT_RESOLVERS = ['1.1.1.1', '9.9.9.9'];
const BOUND_MS = 5000;
const RETRY_MS = 600_000;

async function ask(server: string, zone: string): Promise<Answer> {
  const r = new Resolver({ timeout: 1000, tries: 1 });
  r.setServers([server]);
  try {
    await r.resolveSoa(zone);
    return { kind: 'soa' };
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return code === 'ENOTFOUND' ? { kind: 'nx', code } : { kind: 'other', code: typeof code === 'string' ? code : undefined };
  } finally {
    r.cancel();
  }
}

async function check(zone: string, resolvers: string[], timeoutMs: number): Promise<{ result: 'verified' | 'nx' | 'unverified'; code?: string }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Answer>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'other', code: 'ETIMEOUT' }), timeoutMs);
  });
  try {
    const answers = await Promise.all(resolvers.map((s) => Promise.race([ask(s, zone), late])));
    if (answers.some((a) => a.kind === 'soa')) return { result: 'verified' };
    if (answers.every((a) => a.kind === 'nx')) return { result: 'nx', code: 'ENOTFOUND' };
    const other = answers.find((a): a is Extract<Answer, { kind: 'other' }> => a.kind === 'other');
    return { result: 'unverified', code: other?.code };
  } finally {
    clearTimeout(timer);
  }
}

const errOf = (code: string | undefined) => (code && /^[A-Z0-9_]{1,32}$/.test(code) ? { type: 'DnsError', code } : { type: 'DnsError' });

export async function verifyZone(zone: string | undefined, opts: ZoneOptions): Promise<ZoneResult> {
  if (zone === undefined) return 'skipped';
  const { log } = opts;
  const resolvers = opts.resolvers ?? DEFAULT_RESOLVERS;
  const timeoutMs = opts.timeoutMs ?? BOUND_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;

  const first = await check(zone, resolvers, timeoutMs);
  if (first.result === 'verified') {
    log.info('zone.verified', { outcome: 'ok' });
    return 'verified';
  }
  if (first.result === 'nx') {
    log.fatal('zone.refused', { outcome: 'refused', err: errOf(first.code) });
    return 'refused';
  }
  log.warn('zone.unverified', { outcome: 'error', err: errOf(first.code) });

  const retry = (): void => {
    const t = setTimeout(() => {
      void check(zone, resolvers, timeoutMs).then((r) => {
        if (r.result === 'verified') return void log.info('zone.verified', { outcome: 'ok' });
        if (r.result === 'nx') log.error('zone.missing', { outcome: 'error', err: errOf(r.code) });
        retry();
      });
    }, retryMs);
    t.unref();
  };
  retry();
  return 'unverified';
}
