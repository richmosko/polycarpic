// POLY-96 criteria 1, 2, 6, 10 -- the change filter, infra/ci/changes.mjs (ruling §2).
// Contract: changed paths on stdin, one per line; stdout is `key=true|false` for ALL FIVE keys
// (node, layers, db, image, ci) -- and, from POLY-141, the four db_* area keys; exit non-zero on empty/blank stdin (fail closed, never all-false).
// POLY-141 C16 (seceng S1): stdin is NUL-separated (`git diff --no-renames -z --name-only`), so a name with a newline, tab or
// non-ASCII byte arrives literal. The five original keys are checked here; the area keys are in db-areas.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ci, node } from './helpers.ts';

const KEYS = ['node', 'layers', 'db', 'image', 'ci'] as const;
const run = (paths: string[]) => {
  const r = node('changes.mjs', { input: paths.join('\0') + '\0' });
  const out: Record<string, string> = {};
  for (const l of r.stdout.split('\n')) { const m = /^(\w+)=(true|false)$/.exec(l.trim()); if (m) out[m[1]!] = m[2]!; }
  return { r, out, trueKeys: KEYS.filter((k) => out[k] === 'true') };
};

// [paths, expected true keys, mutation that turns it red]
const CASES: [string[], string[], string][] = [
  [['docs/PRD/index.html', 'process/STATE.md', 'README.md', 'prototype/a.html', 'spikes/x/y.ts'], [], 'a docs/process/*.md/prototype/spikes path added to any key'],
  [['layers.json'], ['layers'], 'layers.json dropped from `layers` (criterion 6)'],
  [['docs/ARCH/index.html'], ['layers'], 'docs/ARCH dropped from `layers`, or docs/** made to set `node`'],
  [['docs/ARCH/index.html', 'docs/PRD/index.html'], ['layers'], 'docs-only PR that touches ARCH must still run the layer checks'],
  [['packages/db/src/x.ts'], ['node', 'db'], '`db` dropped, or `layers` keyed to all of packages/**'],
  [['packages/db/package.json'], ['node', 'db', 'layers'], 'package.json files dropped from `layers`'],
  [['apps/web/src/a.ts'], ['node'], 'apps/** dropped from `node`'],
  [['apps/web/package.json'], ['node', 'layers'], 'apps/*/package.json dropped from `layers`'],
  [['tests/db/a.test.ts'], ['db'], '`db` widened to node, or tests/db dropped from `db`'],
  [['pnpm-lock.yaml'], ['node', 'db'], 'pnpm-lock.yaml dropped from `db` (POLY-102 R5 closes POLY-96 O2) or from `node`'],
  [['turbo.json'], ['node'], 'turbo.json dropped'],
  [['eslint.config.js'], ['node', 'layers'], 'eslint.config.js dropped from either key'],
  [['Dockerfile'], ['image'], 'Dockerfile dropped from `image`'],
  [['Dockerfile.tools', '.dockerignore'], ['image'], 'Dockerfile* glob / .dockerignore dropped'],
  [['compose.prod.yml'], ['image'], 'compose*.yml dropped'],
  [['infra/caddy/Caddyfile'], ['image'], 'infra/** dropped from `image`'],
  [['infra/ci-other/x.sh'], ['image'], 'the infra/ci exception matched as a bare prefix instead of `infra/ci/`'],
  [['bin/polycarpic-ops'], ['image'], 'bin/** dropped'],
  [['infra/ci/changes.mjs'], ['ci'], 'infra/ci counted as `image`, or dropped from `ci`'],
  [['.github/workflows/build.yml'], ['ci'], '.github/workflows dropped from `ci`'],
  [['tests/ci/a.test.ts'], ['ci'], 'tests/ci dropped from `ci`'],
  [['packages-old/x.ts', 'docs/packages/x.md', 'xapps/a.ts'], [], 'unanchored match (substring instead of prefix)'],
  [['docs/DESIGN/tokens.css'], ['node'], 'docs/DESIGN/tokens.css dropped from `node` (POLY-128 R2: the web token-parity test reads it)'],
  [['docs/DESIGN/index.html', 'docs/DESIGN/tokens.html'], [], 'all of docs/DESIGN made to set `node` instead of the one tokens.css file'],
  [['docs/DESIGN/tokens.css'], ['node'], 'docs/DESIGN/tokens.css dropped from `node` (POLY-128 R2: the web token-parity test reads it)'],
  [['docs/DESIGN/index.html', 'docs/DESIGN/tokens.html'], [], 'all of docs/DESIGN made to set `node` instead of the one tokens.css file'],
  // POLY-102 R5: every path a job executes or imports triggers that job.
  [['infra/ci/image.sh'], ['ci', 'image'], 'infra/ci/image.sh dropped from `image` (the POLY-132 gap), or dropped from `ci`'],
  [['infra/ci/install-trivy.sh'], ['ci', 'image'], 'infra/ci/install-trivy.sh dropped from `image`'],
  [['infra/ci/changes.mjs', 'infra/ci/aggregate.mjs'], ['ci'], 'the image entries widened to all of infra/ci/ (the §2 exception lost)'],
  [['.trivyignore'], ['image'], '.trivyignore dropped from `image` (the scan reads it)'],
  [['tests/layers/tsc/package.json'], ['layers', 'image'], 'tests/layers/tsc/package.json dropped from `image` (it enters the image context)'],
  [['packages/config/src/index.ts', 'packages/config/log.schema.json'], ['node', 'db'], 'packages/config dropped from `db` (the closure of tests/db and of the spawned entrypoints reaches @poly/config)'],
  [['packages/db/sql/roles.sql'], ['node', 'db'], 'packages/db/sql dropped from `db` (bootstrap reads it by join(DB_PKG, ...))'],
  [['packages/tenancy/src/index.ts'], ['node', 'db'], 'packages/tenancy dropped from `db` (tests/db imports it)'],
  [['packages/tenancy/permission-matrix.json'], ['node', 'db'], 'permission-matrix.json dropped from `db` (matrix.test reads it by join(ROOT, ...))'],
  [['apps/migrate/src/cli.ts'], ['node', 'db'], 'apps/migrate dropped from `db` (MIGRATE_CLI)'],
  [['apps/web/src/ops/status.ts', 'apps/web/src/ops/health.ts'], ['node', 'db'], 'apps/web/src/ops dropped from `db` (ops-status and ops-hardening import them)'],
  [['apps/web/src/main.ts'], ['node', 'db'], 'apps/web/src/main.ts dropped from `db` (ops-hardening crash handler)'],
  [['apps/web/src/routes/+page.svelte'], ['node'], '`db` widened to all of apps/web'],
  [['tests/log/canary.ts'], ['node', 'db'], 'tests/log dropped from `db` (the canaries are imported by two db files)'],
  // POLY-95 R3: the infra suite and the Postgres FROM line are inputs of the jobs that read them.
  [['tests/infra/lint.test.ts'], ['image'], 'tests/infra dropped from `image` (the lint job and the container tests both read it)'],
  [['infra/postgres/Dockerfile'], ['image', 'db'], 'infra/postgres/Dockerfile dropped from `db` (the battery builds from its FROM line)'],
  [['infra/postgres-major'], ['image', 'db'], 'infra/postgres-major dropped from `db`'],
  [['infra/postgres/postgresql.prod.conf', 'infra/compose/prod.yml', 'infra/lint/policy.json'], ['image'], '`db` widened to all of infra/postgres, or infra/lint/compose dropped from `image`'],
  [['docs/PRD/index.html', 'packages/ledger/src/a.ts'], ['node'], 'a docs path anywhere in the list suppressing the code path'],
];

describe('changes.mjs filter table', () => {
  for (const [paths, expected, mutation] of CASES) {
    it(`${paths.join(' + ')} -> {${expected.join(',')}}  [red if: ${mutation}]`, () => {
      const { r, out, trueKeys } = run(paths);
      expect(r.code, r.stderr).toBe(0);
      expect(Object.keys(out)).toEqual(expect.arrayContaining([...KEYS])); // the five keys are always printed (area keys: db-areas.test.ts)
      expect(trueKeys).toEqual(KEYS.filter((k) => expected.includes(k)));
    });
  }

  it('empty input fails closed (non-zero, no all-false output)  [red if: empty list maps to all-false]', () => {
    for (const input of ['', '\n', '  \n\n', '\0', ' \0\0']) {
      const r = node('changes.mjs', { input });
      expect(r.code).not.toBe(0);
      expect(r.stdout).not.toMatch(/=false/);
    }
  });
});

// POLY-141 C16 / S1: NUL-separated input. Each of these is red while changes.mjs splits on newlines.
describe('changes.mjs: NUL-separated input (POLY-141 C16, seceng S1)', () => {
  const keysOn = (paths: string[]) => run(paths).trueKeys;
  it('a later path is classified: README.md then packages/db/x.ts -> db  [red if: stdin is split on newlines, so the whole string is one path]', () => {
    expect(keysOn(['README.md', 'packages/db/x.ts'])).toEqual(['node', 'db']);
  });
  it('non-ASCII name packages/db/sql/café.sql -> db', () => { expect(keysOn(['README.md', 'packages/db/sql/café.sql'])).toContain('db'); });
  it('a tab in a name stays one path: packages/db/sql/a\tb.sql -> db', () => { expect(keysOn(['README.md', 'packages/db/sql/a\tb.sql'])).toContain('db'); });
  it('a newline in a name stays one path and does not split into a second one: docs/a\npackages/db/x.ts -> nothing', () => {
    expect(keysOn(['docs/a\npackages/db/x.ts'])).toEqual([]);
  });
  it('a literal newline-only list is not accepted as several paths  [red if: both separators are honoured]', () => {
    const r = node('changes.mjs', { input: 'README.md\npackages/db/x.ts\n' });
    expect(r.stdout).toContain('db=false');
  });
  it('the source reads stdin split on \\0', () => {
    const src = readFileSync(ci('changes.mjs'), 'utf8');
    expect(src).toMatch(/split\((['"])\\0\1\)/);
  });
});
