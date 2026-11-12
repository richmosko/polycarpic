import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setRolePasswords } from './helpers/api';
import { startServer } from './helpers/pg';

// Disposable server only. Roles are cluster-global but `roles.sql` (ALTER DATABASE current_database() OWNER ...)
// is per database, so helpers/api.ts freshDb() runs it inside every fresh database (it is idempotent, ruling R1).
export default function setup() {
  const { server, stop: stopServer } = startServer();
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  // A per-run directory for the bootstrap lock (helpers/bootstrap-lock.ts); workers inherit the variable like POLY_TEST_SERVER.
  const lockDir = mkdtempSync(join(tmpdir(), 'poly-test-lock-'));
  process.env.POLY_TEST_LOCK_DIR = lockDir;
  const stop = () => { stopServer(); rmSync(lockDir, { recursive: true, force: true }); };
  try { setRolePasswords(); } catch (e) { stop(); throw e; }
  return stop;
}
