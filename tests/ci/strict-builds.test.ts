// POLY-96 seceng condition on 5a0b259: strict dependency builds may be relaxed in ci.yml only.
// In build.yml, release.yml, the Dockerfile and .npmrc, strict mode is the alarm for a production dependency with a build script.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT, wfText } from './helpers.ts';

const RELAXED = /strict[_-]dep[_-]builds["']?\s*[:=]\s*["']?(false|0|no)\b/i;
const ANY = /strict[_-]dep[_-]builds/i;
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

describe('pnpm strict-dep-builds stays on outside ci.yml', () => {
  for (const f of ['build.yml', 'release.yml']) {
    it(`${f} does not mention strict-dep-builds at all  [red if: pnpm_config_strict_dep_builds is added to ${f}]`, () => {
      expect(wfText(f)).not.toMatch(ANY);
    });
  }
  it('the Dockerfile does not set it  [red if: ENV/ARG pnpm_config_strict_dep_builds=false added]', () => {
    const d = read('Dockerfile');
    expect(d, 'Dockerfile must exist').not.toBeNull();
    expect(d!).not.toMatch(ANY);
  });
  it('no .npmrc, pnpm-workspace.yaml or Dockerfile.* relaxes it either', () => {
    for (const p of ['.npmrc', 'pnpm-workspace.yaml', 'Dockerfile.tools', 'Dockerfile.caddy']) expect(read(p) ?? '', p).not.toMatch(RELAXED);
  });
  // POLY-136 item 7: CI installs strict like local, build.yml and the Dockerfile; esbuild's build script is declined by name.
  const allow = () => (parse(read('pnpm-workspace.yaml') ?? '') as { allowBuilds?: Record<string, unknown> }).allowBuilds ?? {};
  it('ci.yml does not relax it  [red if: pnpm_config_strict_dep_builds returns to ci.yml]', () => {
    expect(wfText('ci.yml')).not.toMatch(ANY);
  });
  it("pnpm-workspace.yaml declines esbuild's build script by name  [red if: the esbuild entry is dropped, so the local install exits 1 again]", () => {
    expect(allow().esbuild).toBe(false);
  });
  it('every allowBuilds value is false  [red if: a dependency build script is allowed (C-80)]', () => {
    expect(Object.keys(allow()).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(allow())) expect(v, k).toBe(false);
  });
  it('the README states the plain install command  [red if: the README loses `pnpm install --frozen-lockfile`]', () => {
    expect(read('README.md') ?? '').toMatch(/pnpm install --frozen-lockfile/);
  });
  it('the matcher itself catches the env, npmrc and quoted spellings', () => {
    for (const s of ['pnpm_config_strict_dep_builds: "false"', 'ENV pnpm_config_strict_dep_builds=false', 'strict-dep-builds=false', "strict_dep_builds: 'false'"]) expect(s).toMatch(RELAXED);
  });
});
