// The bench's own setup: the server and the role passwords, nothing else. The suite's global-setup checks psql >= 16 for \bind,
// which the bench does not use, and this file works on `main` too (it is copied in for the control run).
import { setRolePasswords } from '../helpers/api';
import { ensureBootstrapLockDir, releaseBootstrapLockDir } from '../helpers/bootstrap-lock';
import { startServer } from '../helpers/pg';

export default function setup() {
  const { server, stop: stopServer } = startServer();
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  ensureBootstrapLockDir();
  const stop = () => { stopServer(); releaseBootstrapLockDir(); };
  try { setRolePasswords(); } catch (e) { stop(); throw e; }
  return stop;
}
