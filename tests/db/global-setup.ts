import { startServer } from './helpers/pg';

// Disposable server only. Roles are cluster-global but `roles.sql` (ALTER DATABASE current_database() OWNER ...)
// is per database, so helpers/api.ts freshDb() runs it inside every fresh database (it is idempotent, ruling R1).
export default function setup() {
  const { server, stop } = startServer();
  process.env.POLY_TEST_SERVER = JSON.stringify(server);
  return stop;
}
