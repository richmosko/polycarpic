// POLY-136 ruling addendum 2 (seceng C1, C3, C4, C5): apps/migrate/src/run.ts stays a library function that reads only
// the env it is given, and nothing but cli.ts and tests can reach it. Runs in the `lint` job with the rest of tests/layers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// C1 + C3, pure so each is shown red on a mutant of the real file.
function runViolations(src: string): string[] {
  const s = noComments(src);
  const out: string[] = [];
  if (/\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*['"]env['"]\s*\]/.test(s)) out.push('C1: names process.env');
  for (const m of s.matchAll(/\b(runCheckConfig|checkDatabaseConfig)\s*\(([^)]*)\)/g)) {
    if (m[2]!.split(',').filter((a) => a.trim()).length < 2) out.push(`C1: ${m[1]} called without an explicit env`);
  }
  if (!/\brunCheckConfig\s*\(/.test(s)) out.push('C1: no runCheckConfig call found');
  for (const m of s.matchAll(/\b(migrate|plan)\s*\(([^)]*)\)/g)) {
    if (!/\benv\b|\bopts\b/.test(m[2]!)) out.push(`C1: ${m[1]}() without env`);
  }
  if (/\bprocess\s*\.\s*exit\b|\bprocess\s*\.\s*(on|once)\s*\(/.test(s)) out.push('C3: process.exit, process.on or process.once');
  return out;
}

describe('apps/migrate/src/run.ts is a library function over an explicit env (C1, C3)', () => {
  const real = () => read('apps/migrate/src/run.ts');
  it('exists and is clean  [red if: run.ts is missing, names process.env, or exits or installs a handler]', () => {
    expect(real(), 'apps/migrate/src/run.ts must exist').not.toBeNull();
    expect(runViolations(real()!)).toEqual([]);
  });
  const sample = `export async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const FOLDER = env.POLY_MIGRATIONS_DIR;
  if (argv[0] === 'check-config') return runCheckConfig('migrate', env);
  const problems = checkDatabaseConfig('migrate', env);
  const pending = await plan({ env, folder: FOLDER });
  await migrate({ env, folder: FOLDER });
  return 0;
}`;
  const mutants: [string, (s: string) => string][] = [
    ["runCheckConfig('migrate') with the default env", (s) => s.replace("runCheckConfig('migrate', env)", "runCheckConfig('migrate')")],
    ["checkDatabaseConfig('migrate') with the default env", (s) => s.replace("checkDatabaseConfig('migrate', env)", "checkDatabaseConfig('migrate')")],
    ['const FOLDER = process.env.POLY_MIGRATIONS_DIR', (s) => s.replace('env.POLY_MIGRATIONS_DIR', 'process.env.POLY_MIGRATIONS_DIR')],
    ['{ ...process.env, ...env }', (s) => s.replace('{ env, folder', '{ env: { ...process.env, ...env }, folder')],
    ['plan() without env', (s) => s.replace('plan({ env, folder: FOLDER })', 'plan({ folder: FOLDER })')],
    ['process.exit', (s) => s.replace('return 0;', 'process.exit(0);')],
    ['process.on(', (s) => s.replace('return 0;', "process.on('exit', () => {}); return 0;")],
    ['process.once(', (s) => s.replace('return 0;', "process.once('SIGTERM', () => {}); return 0;")],
  ];
  it('the clean sample passes the rule', () => expect(runViolations(sample)).toEqual([]));
  for (const [name, f] of mutants) {
    it(`red on: ${name}  [red if: runViolations stops flagging it]`, () => {
      const m = f(sample);
      expect(m).not.toBe(sample);
      expect(runViolations(m).length).toBeGreaterThan(0);
    });
  }
});

// C4: the package surface does not grow.
describe('@poly/migrate exposes nothing new (C4)', () => {
  const surfaceViolations = (pkg: { exports?: unknown }, index: string, layers: { packages: Record<string, { allow: string[] }> }): string[] => {
    const out: string[] = [];
    if (JSON.stringify(pkg.exports) !== JSON.stringify({ '.': './src/index.ts' })) out.push('exports changed');
    if (/\brun\b/.test(noComments(index))) out.push('index.ts names run');
    for (const [k, v] of Object.entries(layers.packages)) if (v.allow.some((a) => a === 'migrate' || a.startsWith('migrate/'))) out.push(`${k} allows migrate`);
    return out;
  };
  const pkg = () => JSON.parse(read('apps/migrate/package.json') ?? '{}');
  const layers = () => JSON.parse(read('layers.json') ?? '{"packages":{}}');
  const index = () => read('apps/migrate/src/index.ts') ?? '';
  it('exports stay exactly ".", index.ts does not re-export run, no package allows migrate  [red if: any of the three changes]', () => {
    expect(surfaceViolations(pkg(), index(), layers())).toEqual([]);
  });
  it('red on: "./run" added to exports', () => {
    const p = pkg();
    p.exports['./run'] = './src/run.ts';
    expect(surfaceViolations(p, index(), layers()).length).toBeGreaterThan(0);
  });
  it("red on: export { run } from './run.ts' in index.ts", () => {
    expect(surfaceViolations(pkg(), `${index()}\nexport { run } from './run.ts';\n`, layers()).length).toBeGreaterThan(0);
  });
  it('red on: a package that allows migrate', () => {
    const l = layers();
    l.packages.db.allow.push('migrate');
    expect(surfaceViolations(pkg(), index(), l).length).toBeGreaterThan(0);
  });
});

// C5: the layer lint refuses run.ts from anywhere but cli.ts, its own tests and tests/**.
describe('the layer lint confines run.ts (C5)', () => {
  const lint = async (virtualPath: string, src: string) => {
    const [res] = await new ESLint({ cwd: root }).lintText(src, { filePath: join(root, virtualPath) });
    return res!.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
  };
  const refused: [string, string][] = [
    ['apps/web/src/lib/use-run.ts', "import { run } from '../../../migrate/src/run.ts';\nexport const r = run;\n"],
    ['packages/db/src/use-run.ts', "import { run } from '../../../apps/migrate/src/run.ts';\nexport const r = run;\n"],
    ['apps/web/src/lib/use-run-pkg.ts', "import { run } from '@poly/migrate/run';\nexport const r = run;\n"],
  ];
  for (const [path, src] of refused) {
    it(`${path} importing run.ts is an error  [red if: the lint lets run.ts be reached from outside cli.ts and tests]`, async () => {
      expect((await lint(path, src)).length).toBeGreaterThan(0);
    });
  }
  it('apps/migrate/src/cli.ts importing ./run.ts is clean of run.ts errors', async () => {
    const msgs = await lint('apps/migrate/src/cli.ts', "import { run } from './run.ts';\nrun([], {}).then(() => undefined);\n");
    expect(msgs.filter((m) => /run(\.ts)?\b/.test(m) && !/no-unresolved|unused/.test(m))).toEqual([]);
  });
  it('a test file in tests/ may import run.ts', async () => {
    const msgs = await lint('tests/db/uses-run.test.ts', "import { run } from '../../apps/migrate/src/run.ts';\nexport const r = run;\n");
    expect(msgs.filter((m) => /run(\.ts)?\b/.test(m) && !/no-unresolved|unused/.test(m))).toEqual([]);
  });
});
