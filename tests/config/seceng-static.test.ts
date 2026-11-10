// POLY-85 seceng S-7(b, c) static halves: crash handlers installed, one pino dependency, no console in app sources.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const tracked = (glob: string) => spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', glob], { encoding: 'utf8', cwd: ROOT }).stdout.split('\n').filter(Boolean);

describe('S-7(b) web and worker main.ts install the crash handlers', () => {
  for (const app of ['web', 'worker']) {
    const p = `apps/${app}/src/main.ts`;
    it(`${p}: uncaughtException and unhandledRejection handlers log process.crash with err and exit 1`, () => {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
      const s = read(p);
      expect(s).toMatch(/process\.on\(\s*['"]uncaughtException['"]/);
      expect(s).toMatch(/process\.on\(\s*['"]unhandledRejection['"]/);
      expect(s).toMatch(/['"]process\.crash['"]/);
      expect(s).toMatch(/exit\(\s*1\s*\)/);
    });
  }
});

describe('S-7(c) pino is a dependency of packages/config alone; app sources do not use console', () => {
  it('only packages/config/package.json depends on pino', () => {
    const pkgs = tracked('**/package.json').filter((f) => !f.includes('node_modules'));
    const withPino = pkgs.filter((f) => /"pino"/.test(read(f)));
    expect(withPino).toEqual(['packages/config/package.json']);
  });
  it('no console.* in apps/web/src or apps/worker/src outside cli / check-config files and tests', () => {
    const files = [...tracked('apps/web/src/**/*.ts'), ...tracked('apps/worker/src/**/*.ts')].filter((f) => !/\.test\.ts$/.test(f) && !/(^|\/)(cli|check-config)[^/]*\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(read(f), f).not.toMatch(/\bconsole\.\w+/);
  });
  it('eslint no-console is on for apps/web/src and apps/worker/src', () => {
    const e = read('eslint.config.js');
    expect(e).toMatch(/no-console/);
    expect(e).toMatch(/apps\/web\/src/);
    expect(e).toMatch(/apps\/worker\/src/);
  });
});
