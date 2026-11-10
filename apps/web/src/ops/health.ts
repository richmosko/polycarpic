// Public health (POLY-85 R4, R-6): ok or not, and nothing else. POLY-88 mounts handleHealth as GET /api/v1/health.
// The body is exactly one of two byte strings. `ahead` is ok: the previous release must run on the newer schema (ARCH 8.1).
// The probe is single-flight and memoised for 5 s, so a stranger cannot turn this endpoint into a database load generator.
import { probe } from './probe.ts';

const MEMO_MS = 5000;
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

let memo: { at: number; ok: boolean } | undefined;
let inflight: Promise<boolean> | undefined;

async function isOk(): Promise<boolean> {
  try {
    const p = await probe();
    return p.db.ok && (p.schema.state === 'current' || p.schema.state === 'ahead');
  } catch {
    return false;
  }
}

export async function handleHealth(): Promise<Response> {
  const now = Date.now();
  let ok: boolean;
  if (memo && now - memo.at >= 0 && now - memo.at < MEMO_MS) ok = memo.ok;
  else {
    inflight ??= isOk().finally(() => { inflight = undefined; });
    ok = await inflight;
    memo = { at: Date.now(), ok };
  }
  return new Response(ok ? '{"ok":true}' : '{"ok":false}', { status: ok ? 200 : 503, headers: HEADERS });
}
