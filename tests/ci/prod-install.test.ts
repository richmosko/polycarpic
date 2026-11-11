// POLY-86 (image Trivy findings, runs 42989973126 / 42990359638 / 42990790271): better-auth lists drizzle-kit, vitest, svelte,
// @sveltejs/kit, drizzle-orm and pg as OPTIONAL peers, and pnpm resolved each from the workspace into the production install,
// which put two esbuild Go binaries (fixable CRITICAL/HIGH) in the image. pnpm-workspace.yaml removes them. This test does what
// the Dockerfile does, `pnpm install --frozen-lockfile --prod` over the workspace manifests and the committed lockfile, in a
// scratch directory, and fails if any build tool lands in node_modules/.pnpm. Titles end with [red if: <mutation>].
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const BUILD_TOOLS = /^(esbuild|@esbuild\+|drizzle-kit|vite@|vitest|tsx@)/;
const scratch = mkdtempSync(join(tmpdir(), 'poly-prod-install-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function manifests(): string[] {
  const out = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tests/layers/tsc/package.json'];
  for (const base of ['packages', 'apps']) {
    for (const d of readdirSync(join(ROOT, base), { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(ROOT, base, d.name, 'package.json'))) out.push(`${base}/${d.name}/package.json`);
    }
  }
  return out;
}

describe('the production install carries no build tooling', () => {
  it('a frozen --prod install holds no esbuild, drizzle-kit, vite, vitest or tsx  [red if: an optional peer of better-auth (or any new dependency) drags a build tool into the image]', () => {
    for (const f of manifests()) {
      mkdirSync(dirname(join(scratch, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(scratch, f));
    }
    const r = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prod', '--prefer-offline'], { cwd: scratch, encoding: 'utf8', timeout: 240_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-1500)).toBe(0);
    const installed = readdirSync(join(scratch, 'node_modules', '.pnpm'));
    expect(installed.length).toBeGreaterThan(50); // not vacuous
    expect(installed.some((n) => n.startsWith('better-auth@'))).toBe(true);
    expect(installed.filter((n) => BUILD_TOOLS.test(n))).toEqual([]);
  }, 300_000);

  it('pnpm-workspace.yaml removes every optional peer of better-auth  [red if: an override is dropped]', () => {
    const text = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    for (const peer of ['drizzle-kit', 'vitest', 'svelte', '@sveltejs/kit', 'drizzle-orm', 'pg']) {
      expect(text, peer).toContain(`'better-auth>${peer}': '-'`);
    }
  });
});
