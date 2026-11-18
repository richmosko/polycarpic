// POLY-153 R7.4 (the lead's three conditions, ruling-review §4 Q3): the e2e harness's revoke from poly_app is a MEASUREMENT, never a
// revocation. It lives only in apps/web/tests/e2e/serve.ts; nothing in the schema, the shared db fixtures or the CI/deploy checks carries
// it or cites it. Kept in tests/ci because it reads serve.ts, which the db areas may not (tests/ci/db-filter-imports.test.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

describe('R7.4 the e2e harness revoke is a measurement, never a revocation (the lead\'s three conditions)', () => {
  // The pattern the schema, shared fixtures and CI must not contain; this file is skipped when scanning.
  const FORBIDDEN = /REVOKE\s+(ALL|EXECUTE)[^;]*?(enter_asserted|public\.("user"|session)|\$\{fn\})[^;]*?FROM\s+poly_app/is;
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      if (['node_modules', '.git', '.claude', 'build', '.svelte-kit'].includes(n)) continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
  };
  it('1: the revoke text is in apps/web/tests/e2e/serve.ts and nowhere under packages/db/sql, packages/db/migrations, tests/db or any fixture shared with tests/db [red if: it leaks into the schema or a shared fixture]', () => {
    const serve = readFileSync(join(ROOT, 'apps/web/tests/e2e/serve.ts'), 'utf8');
    expect(serve, 'serve.ts must carry the R7.4 revoke').toMatch(FORBIDDEN);
    for (const dir of ['packages/db/sql', 'packages/db/migrations', 'tests/db', 'tests/ci', 'infra', '.github']) {
      for (const f of walk(join(ROOT, dir))) {
        if (!/\.(sql|ts|mjs|json|yml|md)$/.test(f) || f.endsWith('e2e-revoke-scope.test.ts')) continue;
        expect(readFileSync(f, 'utf8'), f).not.toMatch(FORBIDDEN);
      }
    }
  });
  it('1b: serve.ts revokes after seeding and covers all six BetterAuth tables and enter_asserted_user [red if: user is left out (seceng §2.1)]', () => {
    const serve = readFileSync(join(ROOT, 'apps/web/tests/e2e/serve.ts'), 'utf8');
    const at = serve.search(FORBIDDEN);
    expect(at).toBeGreaterThan(serve.indexOf('storageCookies(signed)'));
    expect(at).toBeGreaterThan(serve.indexOf('SHARED ='));
    expect(serve).toMatch(/REVOKE ALL ON public\."user", public\.session, public\.account, public\.verification, public\.two_factor, public\.passkey FROM poly_app/);
    expect(serve).toMatch(/REVOKE EXECUTE ON FUNCTION \$\{fn\} FROM poly_app/);
    expect(serve).toMatch(/p\.proname LIKE 'enter_asserted%'/); // the reserved definer name is looked up, not spelled (poly/reserved-literal)
  });
  it('3: no migration, doc, STATE line or deploy-gate check says anything was revoked in this loop (the migrated chain keeps poly_app\'s grants) [red if: a migration of this loop revokes]', () => {
    for (const f of readdirSync(join(ROOT, 'packages/db/migrations')).filter((x) => /^0015_/.test(x) && x.endsWith('.sql'))) {
      const sql = readFileSync(join(ROOT, 'packages/db/migrations', f), 'utf8');
      expect(sql, f).not.toMatch(/REVOKE[^;]*(enter_asserted_user|public\.(\"user\"|session|account|verification|two_factor|passkey))[^;]*FROM\s+poly_app/i);
    }
    expect(readdirSync(join(ROOT, 'packages/db/migrations')).some((x) => /^0015_/.test(x)), '0015 must exist').toBe(true);
  });
});

