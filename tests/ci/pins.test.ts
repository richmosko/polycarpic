// POLY-96 criterion 4 (pin check) -- infra/ci/check-pins.mjs (ruling §1 `guard`, S96-1).
// Contract: `node check-pins.mjs <dir|file>...` scans *.yml/*.yaml; exit 0 clean, non-zero on any violation,
// the offending file named on stderr/stdout. Accepts `owner/repo[/path]@<40-hex> # vX.Y.Z`,
// `docker://...@sha256:<64-hex>`, local `./...`.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { node, ROOT } from './helpers.ts';

const H40 = 'a'.repeat(40);
const H64 = 'b'.repeat(64);
const check = (uses: string, trailer = '') => {
  const d = mkdtempSync(join(tmpdir(), 'pins-'));
  writeFileSync(join(d, 'w.yml'), `jobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}${trailer}\n`);
  return node('check-pins.mjs', { args: [d] });
};

describe('check-pins.mjs', () => {
  const good: [string, string][] = [
    [`actions/checkout@${H40}`, ' # v7.0.1'],
    [`github/codeql-action/analyze@${H40}`, ' # v3.28.0'],
    [`docker://ghcr.io/o/i@sha256:${H64}`, ''],
    ['./.github/actions/local', ''],
  ];
  for (const [u, t] of good) it(`accepts ${u}${t}`, () => { const r = check(u, t); expect(r.code, r.stderr + r.stdout).toBe(0); });

  const bad: [string, string, string][] = [
    ['actions/checkout@v4', '', 'tag ref'],
    ['actions/checkout@main', '', 'branch ref'],
    ['actions/checkout@3d3c42e', ' # v7.0.1', 'short sha'],
    [`actions/checkout@${H40}`, '', 'pinned sha with no version comment'],
    [`actions/checkout@${H40.toUpperCase()}`, ' # v1.0.0', 'uppercase hex'],
    ['actions/checkout', '', 'missing ref'],
    ['docker://alpine:3.20', '', 'docker without digest'],
    [`docker://alpine@sha256:${'b'.repeat(40)}`, '', 'docker with short digest'],
    ['"${{ inputs.action }}@v1"', '', 'expression in uses'],
  ];
  for (const [u, t, why] of bad) it(`rejects ${why}: ${u}  [red if: that class is allowed]`, () => { expect(check(u, t).code).not.toBe(0); });

  it('an unpinned uses in a second file of the directory is found', () => {
    const d = mkdtempSync(join(tmpdir(), 'pins-'));
    writeFileSync(join(d, 'ok.yml'), `jobs:\n  j:\n    steps:\n      - uses: actions/checkout@${H40} # v1.0.0\n`);
    writeFileSync(join(d, 'bad.yaml'), `jobs:\n  j:\n    steps:\n      - uses: actions/checkout@v4\n`);
    const r = node('check-pins.mjs', { args: [d] });
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/bad\.yaml/);
  });
  it('a nonexistent path fails closed  [red if: missing dir scans nothing and passes]', () => {
    expect(node('check-pins.mjs', { args: [join(tmpdir(), 'no-such-dir-poly96')] }).code).not.toBe(0);
  });
  it('the real .github/ and infra/ci/ are pinned  [red if: any workflow carries a tag/branch ref]', () => {
    const r = node('check-pins.mjs', { args: [join(ROOT, '.github'), join(ROOT, 'infra', 'ci')] });
    expect(r.code, r.stdout + r.stderr).toBe(0);
  });
});
