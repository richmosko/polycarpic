// POLY-86 criteria 2, 10 and seceng S18: what packages/auth may import and read. Source scans of the shipped (non-test) files plus
// the real lint rule. Titles end with [red if: <mutation>].
import { ESLint } from 'eslint';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const src = readdirSync(here).filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f)).map((f) => [f, readFileSync(join(here, f), 'utf8')] as const);
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('packages/auth source', () => {
  it('has the modules of the ruling  [red if: a module of R1 is absent]', () => {
    for (const f of ['index.ts', 'options.ts', 'routing-pool.ts', 'route-policy.ts', 'second-step.ts', 'handler.ts', 'session.ts', 'user-hooks.ts']) expect(src.map(([n]) => n), f).toContain(f);
  });

  it('imports no Postgres driver and constructs no PostgresDialect, type imports included (criterion 10)  [red if: pg, pg-pool, postgres or PostgresDialect appears]', () => {
    expect(src.length).toBeGreaterThan(1);
    for (const [f, s] of src) {
      expect(code(s), f).not.toMatch(/from\s+['"](pg|pg-pool|postgres|@neondatabase\/serverless)['"]/);
      expect(code(s), f).not.toMatch(/PostgresDialect/);
      expect(code(s), f).not.toMatch(/drizzle-orm\/(node-postgres|postgres-js|neon)/);
    }
  });

  it('takes its pool from db/auth  [red if: the routing pool builds its own pool]', () => {
    expect(src.find(([n]) => n === 'routing-pool.ts')?.[1] ?? '').toMatch(/@poly\/db\/auth/);
  });

  it('reads no environment: no process.env / import.meta.env in shipped files (nothing in auth relaxes the invitation check, S18)  [red if: a switch reads the environment]', () => {
    for (const [f, s] of src) expect(code(s), f).not.toMatch(/process\.env|import\.meta\.env|Deno\.env/);
  });

  it('claimInvitation is called from user-hooks.ts, the user.create.before hook  [red if: the invitation is claimed on /sign-up/email only (S11)]', () => {
    expect(src.find(([n]) => n === 'user-hooks.ts')?.[1] ?? '').toMatch(/claimInvitation/);
  });
});

describe('dependency pins', () => {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  it('better-auth and @better-auth/passkey are pinned to one exact version, 1.7.18; kysely exact 0.29.8  [red if: a range (^ ~ >) or a different version]', () => {
    expect(all['better-auth']).toBe('1.7.18');
    expect(all['@better-auth/passkey']).toBe('1.7.18');
    expect(all['kysely']).toBe('0.29.8');
  });
});

describe('lint', () => {
  // One ESLint instance, warmed once: the first lint loads the whole flat config (the cold start), which on a loaded runner can
  // outlast vitest's 5 s default. The hook and the cases carry explicit timeouts instead of racing the default.
  const eslint = new ESLint({ cwd: root });
  const lint = async (filePath: string, text: string) => {
    const [r] = await eslint.lintText(text, { filePath: join(root, filePath) });
    return r.messages.filter((m) => m.severity === 2);
  };
  beforeAll(async () => {
    await lint('packages/auth/src/options.ts', 'export const warm = 1;\n');
  }, 120_000);
  it('refuses drizzleAdapter in packages/auth  [red if: the restriction rule is absent for this package]', async () => {
    expect((await lint('packages/auth/src/options.ts', `import { drizzleAdapter } from 'better-auth/adapters/drizzle';\nexport const a = drizzleAdapter;\n`)).length).toBeGreaterThan(0);
  }, 60_000);
  it('refuses a pg import in packages/auth  [red if: the layers rule does not cover auth]', async () => {
    expect((await lint('packages/auth/src/routing-pool.ts', `import pg from 'pg';\nexport const a = pg;\n`)).length).toBeGreaterThan(0);
  }, 60_000);
});
