import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PKG, must, startServer } from './helpers/pg';

// Bootstrap SQL = what provisioning (INFRA provision.sh) runs once per cluster as superuser: it creates the roles.
// Default path is the agreed contract with backend-lead; POLY_DB_BOOTSTRAP overrides.
export const BOOTSTRAP = process.env.POLY_DB_BOOTSTRAP ?? join(DB_PKG, 'sql', 'roles.sql');
const LOGIN = ['poly_migrator', 'poly_app', 'poly_worker', 'poly_backup'];

export default function setup() {
  const { server, stop } = startServer();
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  if (existsSync(BOOTSTRAP)) {
    const probe = must(`SELECT count(*) FROM pg_roles WHERE rolname='poly_owner'`);
    if (probe.rows[0][0] === '0') {
      must(readFileSync(BOOTSTRAP, 'utf8'));
      for (const r of LOGIN) must(`ALTER ROLE ${r} PASSWORD 'qa-${r}'`);
    }
  }
  return stop;
}
