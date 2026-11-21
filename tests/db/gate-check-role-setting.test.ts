// POLY-137 R4.2, R5.3 gate line 21: poly_auth's idle_in_transaction_session_timeout is 15 s. A role setting is CLUSTER-wide (pg_db_role_setting
// with setdatabase = 0), so a plant here changes it for every database and every parallel suite. This file therefore runs SERIAL, and each plant
// restores the setting in a finally, whatever the gate answered. Titles end [red if: ...].
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { must, ROOT, server } from './helpers/pg';

const SCRIPT = join(ROOT, 'infra', 'postgres', 'gate-check.sh');
function gate(db: string) {
  const s = server();
  const cmd = s.container ? ['docker', 'exec', '-i', s.container, 'psql', '-U', 'postgres', '-d', db] : ['psql', s.superUrl.replace(/\/[^/]*$/, `/${db}`)];
  const r = spawnSync('sh', [SCRIPT, ...cmd], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
const RESTORE = `ALTER ROLE poly_auth SET idle_in_transaction_session_timeout = '15s'`;

describe('gate line 21: the role setting', () => {
  it('passes on the migrated schema (the setting is 15s) [red if: roles.sql does not set it]', () => {
    const g = gate(cloneMigrated());
    expect(g.out, g.err).toBe('gate: pass');
  });
  for (const [name, sql] of [
    ['reset', 'ALTER ROLE poly_auth RESET idle_in_transaction_session_timeout'],
    ['set to 30s', `ALTER ROLE poly_auth SET idle_in_transaction_session_timeout = '30s'`],
  ] as const) {
    it(`poly_auth's timeout ${name}: exit 1 and FAIL role poly_auth: idle_in_transaction_session_timeout is not 15s; the setting is restored after [red if: the gate does not read the role setting]`, () => {
      const db = cloneMigrated();
      try {
        must(sql, db);
        const g = gate(db);
        expect(g.code, g.out).toBe(1);
        expect(g.out).toContain('FAIL role poly_auth: idle_in_transaction_session_timeout is not 15s');
        expect(g.out).not.toContain('gate: pass');
      } finally {
        must(RESTORE, db);
      }
      expect(must(`SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'poly_auth' AND s.setdatabase = 0 AND 'idle_in_transaction_session_timeout=15s' = ANY (s.setconfig)`, db).rows[0]![0], 'restored').toBe('1');
    });
  }
});
