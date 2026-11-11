// POLY-102 R5: every relative import in tests/db/**/*.ts must resolve to a path the `db` filter matches, so a change to
// code the db battery imports runs the db job. Paths built with join(ROOT|DB_PKG, ...) cannot be seen statically; those are
// explicit cases in changes.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../infra/ci/changes.mjs';
import { ROOT } from './helpers.ts';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : p.endsWith('.ts') ? [p] : [];
});
const specs = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]!);

describe('the db filter covers what tests/db imports', () => {
  const found = walk(join(ROOT, 'tests', 'db')).flatMap((f) => specs(f).map((s) => ({ f, target: relative(ROOT, resolve(dirname(f), s)) })));

  it('finds relative imports outside tests/db and packages/db (the scan is not vacuous)  [red if: the regex stops matching import()/from]', () => {
    const outside = found.filter((x) => !/^(tests\/db|packages\/db)\//.test(x.target)).map((x) => x.target);
    expect(outside).toEqual(expect.arrayContaining(['tests/log/canary.ts', 'packages/tenancy/src/index.ts']));
  });

  it('every resolved import target exists and sets `db`  [red if: a db pattern for tests/log or packages/tenancy is removed]', () => {
    const bad = found.filter((x) => !existsSync(join(ROOT, x.target)) || !classify([x.target]).db).map((x) => `${relative(ROOT, x.f)} -> ${x.target}`);
    expect(bad).toEqual([]);
  });
});
