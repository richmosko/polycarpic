// The one probe behind /status and /api/v1/health (POLY-85 R4): database reachability and schema state, read-only, as poly_app.
// It never throws and never carries a failure message: the only things that leave it are a boolean and a schema state.
import { EXPECTED_TAG, schemaStatus, type SchemaStatus } from '@poly/db/startup';

export interface Probe {
  db: { ok: boolean };
  schema: SchemaStatus;
}

/** A probe that does not answer within this is `unreachable` (S-8b). Unmeasured; well under any health-check interval. */
export const PROBE_TIMEOUT_MS = 4000;

export async function probe(): Promise<Probe> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
    timer.unref();
  });
  try {
    const s = await Promise.race([schemaStatus('app'), timeout]);
    if (s) return { db: { ok: s.state !== 'unreachable' }, schema: s };
  } catch {
    // schemaStatus does not throw; this is belt and braces for the contract "never throws"
  } finally {
    clearTimeout(timer);
  }
  return { db: { ok: false }, schema: { state: 'unreachable', expected: EXPECTED_TAG, applied: null } };
}
