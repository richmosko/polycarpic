// POLY-96 seceng condition on 5a0b259: strict dependency builds may be relaxed in ci.yml only.
// In build.yml, release.yml, the Dockerfile and .npmrc, strict mode is the alarm for a production dependency with a build script.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('ci.yml may relax it (allowed, not required) and only ever to false', () => {
    const t = wfText('ci.yml');
    for (const m of t.matchAll(new RegExp(ANY.source + '[^\\n]*', 'gi'))) expect(m[0]).toMatch(RELAXED);
  });
  it('the matcher itself catches the env, npmrc and quoted spellings', () => {
    for (const s of ['pnpm_config_strict_dep_builds: "false"', 'ENV pnpm_config_strict_dep_builds=false', 'strict-dep-builds=false', "strict_dep_builds: 'false'"]) expect(s).toMatch(RELAXED);
  });
});
