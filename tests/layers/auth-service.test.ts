// POLY-152 R1.8, R5, R6.1: the layer map for the sign-in service, and the rule that web holds no BetterAuth. Source and JSON scans.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const layers = JSON.parse(readFileSync(join(root, 'layers.json'), 'utf8'));
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f.startsWith('.') ? [] : statSync(p).isDirectory() ? walk(p) : [p]; });
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('layers.json', () => {
  it('auth-app is apps/auth, layer 6, allowing config, config/log, db/startup, auth [red if: the key is absent or wider]', () => {
    const a = layers.packages['auth-app'];
    expect(a.dir).toBe('apps/auth');
    expect(a.layer).toBe(6);
    expect([...a.allow].sort()).toEqual(['auth', 'config', 'config/log', 'db/startup']);
  });
  it('packages/auth gains the subpath ./web; web allows auth/web and no longer auth [red if: web may still import the root]', () => {
    expect(layers.packages.auth.subpaths).toContain('./web');
    expect(layers.packages.web.allow).toContain('auth/web');
    expect(layers.packages.web.allow).not.toContain('auth');
    expect(layers.packages.web.allow).not.toContain('db/auth');
  });
  it('db exports ./auth to the service only: withAuthSession and withSignInTx are on @poly/db/auth and nowhere else [red if: absent from the subpath]', () => {
    const a = readFileSync(join(root, 'packages/db/src/auth.ts'), 'utf8');
    expect(a).toMatch(/withAuthSession/);
    expect(a).toMatch(/withSignInTx/);
    const idx = readFileSync(join(root, 'packages/db/src/index.ts'), 'utf8');
    expect(idx).not.toMatch(/withAuthSession|withSignInTx/);
  });
  it('the reserved literals: enter_auth_session only in packages/db/src/context.ts, provision_person only in packages/tenancy/src/index.ts [red if: not reserved]', () => {
    expect(layers.reservedLiterals.enter_auth_session).toEqual(['packages/db/src/context.ts']);
    expect(layers.reservedLiterals.provision_person).toEqual(['packages/tenancy/src/index.ts']);
  });
});

describe('E4/R1.8/R6.1 web holds no BetterAuth', () => {
  const files = () => walk(join(root, 'apps/web/src')).filter((f) => /\.(ts|svelte|js)$/.test(f) && !/\.test\.ts$/.test(f));
  it('nothing under apps/web/src imports better-auth, @better-auth/*, @poly/auth (the root) or @poly/db/auth [red if: any file does]', () => {
    for (const f of files()) {
      const c = strip(readFileSync(f, 'utf8'));
      expect(c, f).not.toMatch(/from\s+['"](better-auth|@better-auth\/[^'"]+|@poly\/auth|@poly\/db\/auth)['"]/);
      expect(c, f).not.toMatch(/import\(\s*['"](better-auth|@better-auth\/[^'"]+|@poly\/auth)['"]\s*\)/);
    }
  });
  it('apps/web/package.json depends on neither better-auth nor @better-auth/* [red if: web still lists them]', () => {
    const p = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
    for (const k of Object.keys({ ...p.dependencies, ...p.devDependencies })) expect(k).not.toMatch(/^(better-auth|@better-auth\/)/);
  });
  it('lib/server/auth.ts (startAuth) is deleted [red if: web still starts BetterAuth]', () => {
    expect(() => readFileSync(join(root, 'apps/web/src/lib/server/auth.ts'), 'utf8')).toThrow();
  });
});

describe('R6.1 @poly/auth/web imports neither better-auth nor @poly/db/auth', () => {
  it('the web subpath\'s source reaches only fetch and @poly/db (poly_app) [red if: web.ts is absent or imports BetterAuth]', () => {
    const src = strip(readFileSync(join(root, 'packages/auth/src/web.ts'), 'utf8'));
    expect(src).not.toMatch(/from\s+['"](better-auth|@better-auth\/[^'"]+|@poly\/db\/auth)['"]/);
    expect(src).not.toMatch(/from\s+['"]\.\/(handler|options|index|routing-pool|second-step|user-hooks)(\.ts)?['"]/);
  });
});
