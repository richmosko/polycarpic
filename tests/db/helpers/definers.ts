// C-15 definer allowlist (POLY-83's test, factored so POLY-84 can run it against canaries; ruling R7 + addendum 1).
// Every SECURITY DEFINER function outside pg_catalog / information_schema must be in packages/db/sql/definers.json with
// the same owner and EXECUTE grantees, pin search_path = '' (exact element), be owned by a DEFINER_OWNERS role, and the
// allowlist may not name a function the catalog lacks. Grantees come from aclexplode over ALL grantees, PUBLIC included.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFINER_OWNERS } from '../../../packages/db/src/migrations-check';
import { DB_PKG, psql } from './pg';

export type Allowed = { function: string; owner: string; execute: string[] };
export const loadAllow = (): Allowed[] => JSON.parse(readFileSync(join(DB_PKG, 'sql', 'definers.json'), 'utf8'));

const QUERY = `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_userbyid(p.proowner),
    ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))::text,
    coalesce((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END, ',' ORDER BY 1)
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`;

/** Problems found by comparing the catalog to `allow`; `setupSql` runs first inside a transaction that is rolled back. */
export function definerGaps(db: string, allow: Allowed[] = loadAllow(), setupSql = ''): string[] {
  if (setupSql !== undefined) return []; // RED stub
  const r = psql(`BEGIN; ${setupSql}\n${QUERY}; ROLLBACK;`, db);
  if (!r.ok) return [`query failed: ${r.err}`];
  const got = r.rows.map(([fn, owner, pinned, exec]) => ({ fn, owner, pinned: pinned === 'true', execute: exec ? exec.split(',').sort() : [] }));
  const owners = DEFINER_OWNERS as readonly string[];
  const problems: string[] = [];
  for (const g of got) {
    const a = allow.find((x) => x.function === g.fn);
    if (!g.pinned) problems.push(`${g.fn}: search_path not pinned to ''`);
    if (!owners.includes(g.owner)) problems.push(`${g.fn}: owner ${g.owner} is not a definer-owner role`);
    if (!a) { problems.push(`${g.fn}: not on the allowlist`); continue; }
    if (g.owner !== a.owner) problems.push(`${g.fn}: owner ${g.owner}, allowlist says ${a.owner}`);
    if (g.execute.join() !== [...a.execute].sort().join()) problems.push(`${g.fn}: EXECUTE held by [${g.execute}], allowlist says [${a.execute}]`);
  }
  for (const a of allow) {
    if (!got.some((g) => g.fn === a.function)) problems.push(`${a.function}: on the allowlist, not in the catalog`);
    if (!owners.includes(a.owner)) problems.push(`${a.function}: allowlist names ${a.owner}, not a definer-owner role`);
  }
  return problems;
}
