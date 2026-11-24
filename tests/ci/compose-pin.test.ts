// POLY-100 G10 / S40 (ruling f5a62e3c, f887180d): the Compose the box, CI's T-render, the isolation test, T-real and the flag lists run is the one named in infra/deploy/compose-version.
// CI's steps read that file (not their own number), and the installed ops bundle holds it (install.sh's PATHS), or every deploy is `render-env`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the one Compose version (G10)', () => {
  it('infra/deploy/compose-version is one line N.N.N', () => {
    expect(read('infra/deploy/compose-version')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('the installed bundle holds the file: it is in install.sh\'s PATHS  [red if: the path is dropped: every deploy would be render-env]', () => {
    const paths = /^PATHS="([^"]+)"/m.exec(read('infra/ops/install.sh'))![1]!.split(/\s+/);
    expect(paths.some((p) => p === 'infra/deploy/compose-version' || p === 'infra/deploy'), paths.join(' ')).toBe(true);
  });

  it('ci.yml\'s steps read the version from the file and fail when another version is running  [red if: a step installs or trusts the runner\'s own Compose]', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('infra/deploy/compose-version');
    const reads = ci.split('\n').filter((l) => l.includes('infra/deploy/compose-version'));
    expect(reads.length, 'the file is read once per job that runs real Compose').toBeGreaterThanOrEqual(2);
    expect(ci, 'a step that compares the running version with the file').toMatch(/docker compose version --short/);
  });

  it('no workflow step hard-codes the Compose version (the file is the only place)', () => {
    const ci = read('.github/workflows/ci.yml');
    const ver = read('infra/deploy/compose-version').trim();
    const hard = ci.split('\n').filter((l) => l.includes(ver) && !l.includes('infra/deploy/compose-version'));
    expect(hard, 'a step names the version itself').toEqual([]);
  });
});
