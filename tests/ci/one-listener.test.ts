// POLY-161 A2 / R3 (verdict B5, "no reference left"): the stand-in listener is gone from the tree, and `createServer` appears under apps/web/src in
// the web server and the status listener only. The container's socket list (T-real 1b) is the proof that one listener answers on 3000; this is the
// cheap guard that none is added in source. The name is built from pieces so this file is not its own match.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const STAND_IN = ['public', 'health'].join('-');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    if (['node_modules', '.svelte-kit', 'build', 'test-results', '.git'].includes(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('one listener on 3000 (source)', () => {
  it('the stand-in listener and its test are gone  [red if: either file is restored]', () => {
    expect(existsSync(join(ROOT, `apps/web/src/ops/${STAND_IN}.ts`))).toBe(false);
    expect(existsSync(join(ROOT, `apps/web/src/ops/${STAND_IN}.test.ts`))).toBe(false);
  });

  it('nothing in the product, the CI scripts, the CI tests or the workflow refers to it  [red if: a reference outlives the file]', () => {
    const roots = ['apps/web/src', 'apps/web/tests', 'infra', 'tests/ci', 'tests/infra', 'tests/db', '.github/workflows', 'Dockerfile'];
    const hits: string[] = [];
    for (const r of roots) {
      const p = join(ROOT, r);
      if (!existsSync(p)) continue;
      for (const f of statSync(p).isDirectory() ? walk(p) : [p]) {
        if (/\.(png|ico|woff2?|gz|br|map)$/.test(f)) continue;
        if (readFileSync(f, 'utf8').includes(STAND_IN)) hits.push(relative(ROOT, f));
      }
    }
    expect(hits).toEqual([]);
  });

  it('createServer is called under apps/web/src in ops/server.ts and ops/status.ts only  [red if: a third listener is created in source, a library listener aside]', () => {
    const users = walk(join(ROOT, 'apps/web/src'))
      .filter((f) => /\.(ts|js|svelte)$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => /\bcreateServer\s*\(/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')))
      .map((f) => relative(ROOT, f))
      .sort();
    expect(users).toEqual(['apps/web/src/ops/server.ts', 'apps/web/src/ops/status.ts']);
  });

  it('main.ts starts each of them once  [red if: a second start call is added]', () => {
    const src = readFileSync(join(ROOT, 'apps/web/src/main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src.match(/\bstartWebServer\s*\(/g)).toHaveLength(1);
    expect(src.match(/\bstartStatusServer\s*\(/g)).toHaveLength(1);
  });
});
