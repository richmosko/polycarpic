import { spawnSync } from 'node:child_process';
// POLY-100 F1 (ruling.md R13, build review 3bbc6626): the image ships R4's exact manifest at /release/infra, root-owned and read-only, not the whole repository. Static half (lint job): the
// Dockerfile assembles /release/infra from the same list release.py's filter accepts. The built-image half is tests/infra/image/release-bundle.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const docker = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const releasePy = readFileSync(join(ROOT, 'infra', 'ops', 'lib', 'release.py'), 'utf8');

/** release.py's FILES tuple, read as text (the box's own list; the filter refuses anything else). */
export function manifestFiles(): string[] {
  const m = /^FILES = \(([^)]*)\)/m.exec(releasePy);
  if (!m) throw new Error('FILES not found in release.py');
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** The infra paths the Dockerfile names on the lines that assemble /release/infra. */
export function dockerfileManifest(): string[] {
  const lines = docker.split('\n').filter((l) => /\/release\b/.test(l) || /^\s*(COPY|RUN)\b.*\binfra\//.test(l) && /release/i.test(l));
  return [...new Set(lines.flatMap((l) => [...l.matchAll(/\binfra\/[A-Za-z0-9_./*-]+/g)].map((x) => x[0].replace(/\/+$/, ''))))].sort();
}

describe('F1: the Dockerfile ships the manifest, not the repository', () => {
  it('has a /release/infra assembly in its build stage and the runtime stage copies it from there', () => {
    expect(docker, 'no /release/infra anywhere').toMatch(/\/release\/infra/);
    expect(docker).toMatch(/COPY[^\n]*--from=build[^\n]* \/release /); // the whole assembled /release tree, so the box's `docker cp cid:/release/infra` finds exactly it
  });

  it('the runtime copy is root-owned and read-only', () => {
    const line = docker.split('\n').find((l) => /COPY[^\n]*--from=build[^\n]* \/release /.test(l)) ?? '';
    expect(line).toMatch(/--chown=root:root/);
    expect(docker, 'modes are set where /release is assembled: files 0644, scripts 0755, none group- or world-writable').toMatch(/find \/release -type f -exec chmod 0644/);
    expect(docker.split('\n').filter((l) => /^\s*COPY\b.*--chown=node:node.*\/app\b/.test(l)).join('\n')).not.toMatch(/\/app\/infra\b/);
  });

  it('names every file of release.py\'s manifest, and no whole directory of infra/', () => {
    const named = dockerfileManifest();
    for (const f of manifestFiles()) {
      const dir = f.split('/').slice(0, -1).join('/');
      expect(named.some((n) => n === f || n === dir || (n.endsWith('*') && f.startsWith(n.slice(0, -1)))), `${f} is not assembled`).toBe(true);
    }
    expect(named.filter((n) => n === 'infra' || n === 'infra/.' || n === 'infra/*'), 'a whole infra/ copy').toEqual([]);
  });

  it('a missing file fails the build: the assembly uses cp/COPY of each path, never `|| true`', () => {
    const assembly = docker.split('\n').filter((l) => /\/release\b/.test(l)).join('\n');
    expect(assembly).not.toMatch(/\|\|\s*true|2>\s*\/dev\/null\s*;/);
  });

  it('runs the image check on a change to the installed filter (the image job triggers on release.py)', () => {
    // the image job's trigger is infra/ci/changes.mjs's `image` filter (ci.yml only reads its output): run the classifier on the changed path
    const r = spawnSync('node', [join(ROOT, 'infra', 'ci', 'changes.mjs')], { input: 'infra/ops/lib/release.py\0', encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^image=true$/m);
  });
});
