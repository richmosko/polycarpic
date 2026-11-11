// POLY-96 criteria 1, 2, 6, 10 -- the change filter, infra/ci/changes.mjs (ruling §2).
// Contract: changed paths on stdin, one per line; stdout is `key=true|false` for ALL FIVE keys
// (node, layers, db, image, ci); exit non-zero on empty/blank stdin (fail closed, never all-false).
import { describe, expect, it } from 'vitest';
import { node } from './helpers.ts';

const KEYS = ['node', 'layers', 'db', 'image', 'ci'] as const;
const run = (paths: string[]) => {
  const r = node('changes.mjs', { input: paths.join('\n') + '\n' });
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
  [['pnpm-lock.yaml'], ['node'], '`db` widened to the lockfile (O2) or lockfile dropped from `node`'],
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
  [['docs/PRD/index.html', 'packages/ledger/src/a.ts'], ['node'], 'a docs path anywhere in the list suppressing the code path'],
];

describe('changes.mjs filter table', () => {
  for (const [paths, expected, mutation] of CASES) {
    it(`${paths.join(' + ')} -> {${expected.join(',')}}  [red if: ${mutation}]`, () => {
      const { r, out, trueKeys } = run(paths);
      expect(r.code, r.stderr).toBe(0);
      expect(Object.keys(out).sort()).toEqual([...KEYS].sort()); // all five keys always printed
      expect(trueKeys).toEqual(KEYS.filter((k) => expected.includes(k)));
    });
  }

  it('empty input fails closed (non-zero, no all-false output)  [red if: empty list maps to all-false]', () => {
    for (const input of ['', '\n', '  \n\n']) {
      const r = node('changes.mjs', { input });
      expect(r.code).not.toBe(0);
      expect(r.stdout).not.toMatch(/=false/);
    }
  });
});
