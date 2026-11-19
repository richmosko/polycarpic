// POLY-149c, ruling R1 ("What goes with enter_asserted_user"): the asserted-user entry and everything that existed only for it are gone.
// A grep pins withTenant, enter_asserted_user, sessionUserId and loadSession absent from apps/, packages/ and tests/ (migrations 0011, 0014 and
// 0017 excepted, and this file and the db absence tests). Also the layer config, the subpath, the e2e harness revoke and the fixture dirs.
// Titles end [red if: <mutation>]. Red today: all of it still exists.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f === '.svelte-kit' || f === 'dist' || f.startsWith('.') ? [] : statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const NAMES = /\b(withTenant|enter_asserted_user|sessionUserId|SessionUserId|loadSession)\b/;
const EXCEPT = [
  /^packages\/db\/migrations\/(0011|0014|0017)_/, // history; 0017 drops the function
  /^tests\/db\/revocation\.test\.ts$/, /^tests\/db\/pgtap\/(07|1[12])_/,
  // tests that assert the names ABSENT from web and its packages, by name
  /^apps\/web\/src\/hooks\.server\.auth\.test\.ts$/, /^packages\/auth\/src\/web\.test\.ts$/, /^tests\/layers\/web-no-betterauth-sql\.test\.ts$/, /^tests\/layers\/auth-service\.test\.ts$/, /^tests\/db\/sign-in-controls-pins\.test\.ts$/, /^tests\/layers\/revoked-names\.test\.ts$/, /^tests\/db\/gate-check\.test\.ts$/, // the deploy-gate check asserts enter_asserted_user absent, by name
];

describe('the names that existed only for the asserted-user entry are absent', () => {
  it('no file under apps/, packages/ or tests/ names withTenant, enter_asserted_user, sessionUserId or loadSession [red if: any caller, comment or fixture survives]', () => {
    const hits: string[] = [];
    for (const d of ['apps', 'packages', 'tests']) for (const p of walk(join(root, d))) {
      const rel = relative(root, p);
      if (!/\.(ts|svelte|js|mjs|json|sql|md)$/.test(p) || EXCEPT.some((re) => re.test(rel))) continue;
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (NAMES.test(l)) hits.push(`${rel}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });
  it('layers.json has no enter_asserted_user reserved literal and no db/session layer or allowance [red if: the layer map still names them]', () => {
    const t = readFileSync(join(root, 'layers.json'), 'utf8');
    expect(t).not.toMatch(/enter_asserted_user/);
    expect(t).not.toMatch(/db\/session/);
  });
  it('packages/db has no session.ts and no @poly/db/session subpath [red if: the brand module survives]', () => {
    expect(existsSync(join(root, 'packages/db/src/session.ts'))).toBe(false);
    const pkg = readFileSync(join(root, 'packages/db/package.json'), 'utf8');
    expect(pkg).not.toMatch(/\.\/session/);
  });
  it('the eslint fixture dirs for those names are gone: 12-db-session, 13-sessionuserid-cast, 31-reserved-literal [red if: a fixture still exercises a removed rule]', () => {
    for (const d of ['12-db-session', '13-sessionuserid-cast', '31-reserved-literal']) expect(existsSync(join(root, 'tests/layers/fixtures', d)), d).toBe(false);
  });
  it('the tsc probes for the session brand are gone, and db-index.ts still asserts @poly/db exports neither name [red if: db-session-control.ts survives]', () => {
    expect(existsSync(join(root, 'tests/layers/tsc/db-session-control.ts'))).toBe(false);
  });
});

describe('the R7.4 e2e harness revoke goes: the migrated chain carries the revocation', () => {
  it('apps/web/tests/e2e/revoke-target.ts and tests/ci/e2e-revoke-scope.test.ts do not exist, and serve.ts revokes nothing [red if: the e2e suite still runs on a harness-patched schema]', () => {
    expect(existsSync(join(root, 'apps/web/tests/e2e/revoke-target.ts'))).toBe(false);
    expect(existsSync(join(root, 'tests/ci/e2e-revoke-scope.test.ts'))).toBe(false);
    expect(readFileSync(join(root, 'apps/web/tests/e2e/serve.ts'), 'utf8')).not.toMatch(/\bREVOKE\b|revoke-target|revokeTarget/i);
  });
});

describe('the migrations: the revocation is its own file, after the controls', () => {
  it('0016_sign_in_controls and 0017_revocation exist, in that order, and only 0017 revokes from poly_app [red if: the revocation lands in the controls migration, so a cut loop cannot ship the controls alone]', () => {
    const m = readdirSync(join(root, 'packages/db/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const i16 = m.findIndex((f) => f.startsWith('0016_')); const i17 = m.findIndex((f) => f.startsWith('0017_'));
    expect(i16, m.join(',')).toBeGreaterThan(-1);
    expect(i17).toBe(i16 + 1);
    expect(readFileSync(join(root, 'packages/db/migrations', m[i16]!), 'utf8')).not.toMatch(/REVOKE\s+ALL[^;]*FROM\s+poly_app/i);
    expect(readFileSync(join(root, 'packages/db/migrations', m[i17]!), 'utf8')).toMatch(/REVOKE\s+ALL[^;]*FROM\s+poly_app/i);
  });
  it('definers.json lists the four new definers and not enter_asserted_user [red if: the allowlist was not updated]', () => {
    const t = readFileSync(join(root, 'packages/db/sql/definers.json'), 'utf8');
    for (const f of ['record_session_sign_in', 'guard_second_step_lock', 'purge_sign_in_record']) expect(t, f).toMatch(new RegExp(`app\\.${f}\\(`));
    expect(t).not.toMatch(/enter_asserted_user/);
  });
});
