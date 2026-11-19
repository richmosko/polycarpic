// POLY-149e (Addendum 4): the membership row of the deploy gate. A role membership is cluster-wide, so this file is SERIAL (tests/db/vitest.config.ts),
// as pgtap-membership is: each plant runs in one transaction with the check and is rolled back. The rest of the gate's plants are in gate-check.test.ts.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { psql, ROOT, server } from './helpers/pg';

const SCRIPT = join(ROOT, 'infra', 'postgres', 'gate-check.sh');
function gate(db: string) {
  const s = server();
  const cmd = s.container
    ? ['docker', 'exec', '-i', s.container, 'psql', '-U', 'postgres', '-d', db]
    : ['psql', s.superUrl.replace(/\/[^/]*$/, `/${db}`)];
  const r = spawnSync('sh', [SCRIPT, ...cmd], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}

const GATE_SQL = readFileSync(join(ROOT, 'infra', 'postgres', 'gate-check.sql'), 'utf8');
const memberPlants: [string, string, string][] = [
  ['poly_auth granted poly_govern WITH INHERIT FALSE, SET TRUE (SET ROLE reach no privilege check sees)', 'GRANT poly_govern TO poly_auth WITH INHERIT FALSE, SET TRUE', 'membership: poly_auth holds poly_govern'],
  ['poly_worker granted pg_write_all_data', 'GRANT pg_write_all_data TO poly_worker', 'membership: poly_worker holds pg_write_all_data'],
  ["poly_migrator's grant of poly_purge re-made WITH ADMIN TRUE", 'GRANT poly_purge TO poly_migrator WITH ADMIN TRUE, INHERIT FALSE, SET TRUE', 'membership: poly_migrator holds poly_purge'],
  ['poly_migrator inherits poly_owner', 'GRANT poly_owner TO poly_migrator WITH INHERIT TRUE, SET TRUE', 'membership: poly_migrator holds poly_owner'],
  ['a login role (poly_app) made a member of poly_owner', 'GRANT poly_owner TO poly_app WITH INHERIT FALSE, SET TRUE', 'membership: poly_app holds poly_owner'],
  ['poly_migrator loses poly_journal', 'REVOKE poly_journal FROM poly_migrator', 'membership: poly_migrator does not hold poly_journal'],
  ['poly_backup loses pg_read_all_data', 'REVOKE pg_read_all_data FROM poly_backup', 'membership: poly_backup does not hold pg_read_all_data'],
];
describe('role membership: the exact pg_auth_members set, each plant run and rolled back in one transaction', () => {
  it.each(memberPlants)('%s', (_n, plant, expected) => {
    const db = cloneMigrated();
    const r = psql(`BEGIN;\n${plant};\n${GATE_SQL}\nROLLBACK;`, db);
    expect(r.ok, r.err).toBe(true);
    expect(r.out).toContain('FAIL ' + expected);
    expect(r.out).not.toContain('gate: pass');
    expect(gate(db).code, 'the rolled-back plant left the gate green').toBe(0);
  });
});

