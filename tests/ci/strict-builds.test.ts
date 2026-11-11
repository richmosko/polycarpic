// POLY-96 seceng condition on 5a0b259: strict dependency builds may be relaxed in ci.yml only.
// In build.yml, release.yml, the Dockerfile and .npmrc, strict mode is the alarm for a production dependency with a build script.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  // POLY-136 item 7 (ruling addendum 2, seceng S1-S3): CI installs strict like local, build.yml and the Dockerfile;
  // esbuild's build script is declined by name; nothing allows a build.
  const strictFiles = () => [
    ...readdirSync(join(ROOT, '.github', 'workflows')).map((f) => `.github/workflows/${f}`),
    ...readdirSync(ROOT).filter((f) => f.startsWith('Dockerfile')),
    '.npmrc',
    'pnpm-workspace.yaml',
  ];
  it('S3: strict-dep-builds is set nowhere (workflows, Dockerfile*, .npmrc, workspace file)  [red if: the pnpm_config_strict_dep_builds lines return to ci.yml]', () => {
    for (const p of strictFiles()) expect(read(p) ?? '', p).not.toMatch(ANY);
  });
  // S1: parsed, every allowBuilds value is the boolean false. Pure so it can be shown red on mutants.
  const allowViolations = (yamlText: string): string[] => {
    const ws = (parse(yamlText) ?? {}) as { allowBuilds?: Record<string, unknown> };
    const entries = Object.entries(ws.allowBuilds ?? {});
    const out = entries.filter(([, v]) => v !== false).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    if (!entries.some(([k]) => k === 'esbuild')) out.push('no esbuild entry');
    return out;
  };
  it("S1: pnpm-workspace.yaml declines esbuild by name and every allowBuilds value is the boolean false  [red if: the esbuild entry is dropped, or any value is not === false]", () => {
    expect(allowViolations(read('pnpm-workspace.yaml') ?? '')).toEqual([]);
  });
  for (const [name, block] of [['esbuild: true', '  esbuild: true'], ["esbuild: 'false' (a string)", "  esbuild: 'false'"], ['esbuild@0.25.12: true', "  esbuild: false\n  'esbuild@0.25.12': true"]] as const) {
    it(`S1: the check is red on ${name}  [red if: allowViolations stops flagging it]`, () => {
      expect(allowViolations(`allowBuilds:\n${block}\n`).length).toBeGreaterThan(0);
    });
  }
  it('S1: the check is green on the ruled shape', () => {
    expect(allowViolations('allowBuilds:\n  esbuild: false\n')).toEqual([]);
  });
  // S2: no allow-all switch or allowlist key anywhere pnpm reads config, in any spelling.
  const ALLOW_KEYS = /dangerously[-_]?allow[-_]?all[-_]?builds|only[-_]?built[-_]?dependencies(?:[-_]?file)?/i;
  it('S2: no allow-all or allowlist key in pnpm-workspace.yaml, package.json#pnpm or .npmrc  [red if: dangerouslyAllowAllBuilds or onlyBuiltDependencies is added]', () => {
    const pkg = JSON.parse(read('package.json') ?? '{}') as { pnpm?: unknown };
    expect(read('pnpm-workspace.yaml') ?? '').not.toMatch(ALLOW_KEYS);
    expect(JSON.stringify(pkg.pnpm ?? {})).not.toMatch(ALLOW_KEYS);
    expect(read('.npmrc') ?? '').not.toMatch(ALLOW_KEYS);
  });
  it('S2: the matcher catches camelCase, kebab-case and env spellings', () => {
    for (const s of ['dangerouslyAllowAllBuilds: true', 'dangerously-allow-all-builds=true', 'pnpm_config_dangerously_allow_all_builds=1', 'onlyBuiltDependencies:', 'only-built-dependencies-file=x', 'onlyBuiltDependenciesFile: x']) expect(s).toMatch(ALLOW_KEYS);
  });
  it('the README states the plain install command  [red if: the README loses `pnpm install --frozen-lockfile`]', () => {
    expect(read('README.md') ?? '').toMatch(/pnpm install --frozen-lockfile/);
  });
  it('the matcher itself catches the env, npmrc and quoted spellings', () => {
    for (const s of ['pnpm_config_strict_dep_builds: "false"', 'ENV pnpm_config_strict_dep_builds=false', 'strict-dep-builds=false', "strict_dep_builds: 'false'"]) expect(s).toMatch(RELAXED);
  });
});
