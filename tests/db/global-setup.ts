import { setRolePasswords } from './helpers/api';
import { ensureBootstrapLockDir, releaseBootstrapLockDir } from './helpers/bootstrap-lock';
import { startServer } from './helpers/pg';

// Disposable server only. Roles are cluster-global but `roles.sql` (ALTER DATABASE current_database() OWNER ...)
// is per database, so helpers/api.ts freshDb() runs it inside every fresh database (it is idempotent, ruling R1).
export default function setup() {
  const { server, stop: stopServer } = startServer();
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  // A per-run directory for the bootstrap lock (helpers/bootstrap-lock.ts); workers inherit the variable like POLY_TEST_SERVER.
  ensureBootstrapLockDir();
  const stop = () => { stopServer(); releaseBootstrapLockDir(); };
  try { setRolePasswords(); } catch (e) { stop(); throw e; }
  return stop;
}
