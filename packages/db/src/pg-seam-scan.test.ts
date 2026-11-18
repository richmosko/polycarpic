// POLY-147 guard (i), ruling R4 bypass check: nothing outside the seam can reach pg. A source scan over packages/ and apps/
// (not *.test.ts, not node_modules or build output). Written by qa-147 at the red gate; it needs no database.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (['node_modules', '.claude', '.svelte-kit', 'dist', 'build', '.turbo', 'coverage'].includes(f)) return [];
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|js|mjs|cjs|svelte)$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : [];
  });
}
const files = [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'apps'))].map((p) => ({ rel: relative(ROOT, p), src: readFileSync(p, 'utf8') }));
// The patterns, named so each can be proven against a sample (see the last describe).
const VALUE_IMPORT = /\bimport\s+(?!type\b)[^;'"]*?from\s+['"]pg['"]|\bexport\s+(?!type\b)[^;'"]*?from\s+['"]pg['"]|\brequire\(\s*['"]pg['"]\s*\)|\bimport\(\s*['"]pg['"]\s*\)|\bimport\s+['"]pg['"]/;
const POOL_CTOR = /\bnew\s+(?:[A-Za-z_$][\w$]*\.)*Pool\(|\b[A-Za-z_$][\w$]*\.Pool\(/;
const CLIENT_CTOR = /\bnew\s+(?:[A-Za-z_$][\w$]*\.)*Client\(/;
const PG_POOL = /['"]pg-pool['"]/;
const where = (re: RegExp) => files.filter((f) => re.test(f.src)).map((f) => f.rel).sort();
const only = (rels: string[]) => rels.sort();

describe('the source scan: nothing outside the seam can reach pg', () => {
  it('a value import of pg appears only in pool.ts, migrate.ts and extended-client.ts  [red if: another module builds its own client]', () => {
    const value = VALUE_IMPORT;
    expect(where(value)).toEqual(only(['packages/db/src/extended-client.ts', 'packages/db/src/migrate.ts', 'packages/db/src/pool.ts']));
  });
  it('a type-only import of pg stays inside packages/db/src  [red if: a type import leaks a driver dependency elsewhere]', () => {
    const typeOnly = /\bimport\s+type\b[^;]*?from\s+['"]pg['"]/;
    for (const r of where(typeOnly)) expect(r.startsWith('packages/db/src/'), r).toBe(true);
  });
  it('pools are built in pool.ts alone; plain clients in migrate.ts alone; a Client subclass in extended-client.ts alone  [red if: a second pool or client constructor appears]', () => {
    expect(where(POOL_CTOR)).toEqual(['packages/db/src/pool.ts']);
    expect(where(CLIENT_CTOR)).toEqual(['packages/db/src/migrate.ts']);
    expect(where(/\bextends\s+(?:pg\.)?Client\b/)).toEqual(['packages/db/src/extended-client.ts']);
  });
  it('every new pg.Pool in pool.ts passes Client: ExtendedClient  [red if: one pool is left on the default client]', () => {
    const src = readFileSync(join(ROOT, 'packages/db/src/pool.ts'), 'utf8');
    const pools = src.match(/new pg\.Pool\(/g) ?? [];
    const withClient = src.match(/new pg\.Pool\(\{[^}]*Client:\s*ExtendedClient/g) ?? [];
    expect(pools.length).toBe(4); // POLY-152: the poly_auth pool is the fourth
    expect(withClient.length).toBe(4);
  });
  it('pg-pool is imported nowhere (it would build clients that skip ExtendedClient)  [red if: a module imports pg-pool, in packages/db or elsewhere]', () => {
    expect(where(PG_POOL)).toEqual([]);
  });
  it('pg-native and a .native binding appear nowhere  [red if: the native driver (which has its own query path) is introduced]', () => {
    expect(where(/pg-native/)).toEqual([]);
    expect(where(/\bpg\.native\b|\bnative\s*:\s*true/)).toEqual([]);
  });
});

// Each pattern proven against samples: a widened rule that stops matching goes red here (seceng N2).
describe('the scan patterns catch what they are for', () => {
  const bad: [string, RegExp, string][] = [
    ['export { Pool } from', VALUE_IMPORT, "export { Pool } from 'pg';"],
    ['export * from', VALUE_IMPORT, "export * from 'pg'"],
    ['import default', VALUE_IMPORT, "import pg from 'pg';"],
    ['import named', VALUE_IMPORT, "import { Pool } from \"pg\";"],
    ['require', VALUE_IMPORT, "const pg = require('pg');"],
    ['dynamic import', VALUE_IMPORT, "const m = await import('pg');"],
    ['side-effect import', VALUE_IMPORT, "import 'pg';"],
    ['aliased constructor', POOL_CTOR, 'const p = new x.Pool({});'],
    ['namespace constructor', POOL_CTOR, 'const p = new pg.Pool({});'],
    ['bare constructor', POOL_CTOR, 'const p = new Pool({});'],
    ['aliased call', POOL_CTOR, 'const p = x.Pool({});'],
    ['aliased client', CLIENT_CTOR, 'const c = new y.Client({});'],
    ['pg-pool import', PG_POOL, "import { Pool } from 'pg-pool';"],
    ['pg-pool require', PG_POOL, "require(\"pg-pool\")"],
  ];
  for (const [name, re, sample] of bad) {
    it(`${name} is caught  [red if: the pattern is narrowed again]`, () => { expect(re.test(sample), sample).toBe(true); });
  }
  it('a type-only import or export of pg is not a value import  [red if: the pattern refuses types]', () => {
    expect(VALUE_IMPORT.test("import type { Pool } from 'pg';")).toBe(false);
    expect(VALUE_IMPORT.test("export type { Pool } from 'pg';")).toBe(false);
  });
});
