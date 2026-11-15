import { setRolePasswords } from './helpers/api';
import { ensureBootstrapLockDir, releaseBootstrapLockDir } from './helpers/bootstrap-lock';
import { sh, startServer } from './helpers/pg';

// Disposable server only. Roles are cluster-global but `roles.sql` (ALTER DATABASE current_database() OWNER ...)
// is per database, so helpers/api.ts freshDb() runs it inside every fresh database (it is idempotent, ruling R1).
// POLY-147 ruling R6: identity in a psql script is a bound call (\bind, psql >= 16). Check the psql the harness will actually use.
function requirePsql16(container: string | null): void {
  const r = container ? sh('docker', ['exec', container, 'psql', '--version']) : sh('psql', ['--version']);
  const major = Number(/(\d+)(?:\.\d+)*\s*(?:\(|$)/m.exec(r.out.trim())?.[1] ?? /(\d+)/.exec(r.out)?.[1] ?? 0);
  if (r.code !== 0 || major < 16) throw new Error(`psql >= 16 is required for \\bind (found: ${r.out.trim() || r.err.trim() || 'none'})`);
}

export default function setup() {
  const { server, stop: stopServer } = startServer();
  try { requirePsql16(server.container); } catch (e) { stopServer(); throw e; }
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  // A per-run directory for the bootstrap lock (helpers/bootstrap-lock.ts); workers inherit the variable like POLY_TEST_SERVER.
  ensureBootstrapLockDir();
  const stop = () => { stopServer(); releaseBootstrapLockDir(); };
  try { setRolePasswords(); } catch (e) { stop(); throw e; }
  return stop;
}
