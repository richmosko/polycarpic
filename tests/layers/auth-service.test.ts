// POLY-152 R1.8, R5, R6.1 and the architect's condition (c36bf83e): the layer map for the sign-in service, and the rule that web holds no
// BetterAuth and no poly_auth pool. The layer check works per package, not per subpath, so the boundary test below is the guard: it
// resolves imports TRANSITIVELY from web's entry points and from packages/auth/src/web.ts, and it is shown to bite on planted imports.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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
  it('withAuthSession and withSignInTx are on @poly/db/auth and not on the @poly/db index [red if: absent from the subpath or leaked to the index]', () => {
    const a = readFileSync(join(root, 'packages/db/src/auth.ts'), 'utf8');
    expect(a).toMatch(/withAuthSession/);
    expect(a).toMatch(/withSignInTx/);
    expect(readFileSync(join(root, 'packages/db/src/index.ts'), 'utf8')).not.toMatch(/withAuthSession|withSignInTx/);
  });
  it('the reserved literals: enter_auth_session only in packages/db/src/context.ts, provision_person only in packages/tenancy/src/index.ts [red if: not reserved]', () => {
    expect(layers.reservedLiterals.enter_auth_session).toEqual(['packages/db/src/context.ts']);
    expect(layers.reservedLiterals.provision_person).toEqual(['packages/tenancy/src/index.ts']);
  });
});

// ---- the transitive boundary scanner ----
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const FORBIDDEN_EXT = /^(better-auth(\/.*)?|@better-auth\/.+)$/;
const EXT = ['.ts', '.js', '.svelte', '/index.ts', '/index.js', ''];

export function scan(repo: string, entries: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const dirs: Record<string, string> = Object.fromEntries(Object.values<any>(JSON.parse(readFileSync(join(repo, 'layers.json'), 'utf8')).packages).map((p) => [p.name, p.dir]));
  const resolveSpec = (spec: string, from: string): string | null => {
    if (spec.startsWith('.')) {
      const base = resolve(dirname(from), spec);
      for (const e of EXT) if (existsSync(base + e) && statSync(base + e).isFile()) return base + e;
      return null;
    }
    if (spec.startsWith('@poly/')) {
      const [, name, ...sub] = spec.split('/');
      const dir = dirs[`@poly/${name}`];
      if (!dir) return null;
      const f = join(repo, dir, 'src', sub.length ? `${sub.join('/')}.ts` : 'index.ts');
      return existsSync(f) ? f : null;
    }
    return null;
  };
  const visit = (file: string, via: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(repo, file);
    if (/^packages\/auth\/src\//.test(rel) && !/^packages\/auth\/src\/web/.test(rel)) found.push(`${rel} (outside packages/auth/src/web*) via ${via.join(' > ')}`);
    if (rel === 'packages/db/src/auth.ts') found.push(`@poly/db/auth via ${via.join(' > ')}`);
    if (!/\.(ts|js|svelte)$/.test(file)) return;
    for (const m of strip(readFileSync(file, 'utf8')).matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (FORBIDDEN_EXT.test(spec)) { found.push(`${spec} imported by ${rel}`); continue; }
      const r = resolveSpec(spec, file);
      if (r) visit(r, [...via, rel]);
    }
  };
  for (const e of entries) if (existsSync(join(repo, e))) visit(join(repo, e), [e]);
  return found;
}
export const webEntries = (repo: string): string[] => [
  ...walk(join(repo, 'apps/web/src')).filter((f) => /\.(ts|svelte|js)$/.test(f) && !/\.test\.ts$/.test(f)).map((f) => relative(repo, f)),
  'packages/auth/src/web.ts',
];

describe('E4/R1.8/R6.1 web holds no BetterAuth and no poly_auth pool, transitively', () => {
  it('from every web source file and from packages/auth/src/web.ts, nothing reaches better-auth, @better-auth/*, @poly/db/auth or a packages/auth file outside web* [red if: any chain does]', () => {
    expect(scan(root, webEntries(root))).toEqual([]);
  });
  it('packages/auth/src/web.ts exists, so the scan has its second entry point [red if: the subpath file is absent]', () => {
    expect(existsSync(join(root, 'packages/auth/src/web.ts'))).toBe(true);
  });
  it('apps/web/package.json depends on neither better-auth nor @better-auth/* [red if: web still lists them]', () => {
    const p = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
    for (const k of Object.keys({ ...p.dependencies, ...p.devDependencies })) expect(k).not.toMatch(/^(better-auth|@better-auth\/)/);
  });
  it('lib/server/auth.ts (startAuth) is deleted [red if: web still starts BetterAuth]', () => {
    expect(existsSync(join(root, 'apps/web/src/lib/server/auth.ts'))).toBe(false);
  });
});

describe('the boundary scan is shown to fail on a planted import (it bites before it counts)', () => {
  const fixture = (files: Record<string, string>) => {
    const repo = mkdtempSync(join(tmpdir(), 'poly152-bnd-'));
    const put = (f: string, c: string) => { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), c); };
    put('layers.json', JSON.stringify({ packages: { auth: { dir: 'packages/auth', name: '@poly/auth' }, db: { dir: 'packages/db', name: '@poly/db' }, web: { dir: 'apps/web', name: '@poly/web' }, tenancy: { dir: 'packages/tenancy', name: '@poly/tenancy' } } }));
    put('packages/auth/src/web.ts', 'export const x = 1;\n');
    put('packages/auth/src/index.ts', "import 'better-auth';\n");
    put('packages/db/src/auth.ts', 'export {};\n');
    put('packages/db/src/index.ts', 'export {};\n');
    put('packages/tenancy/src/index.ts', "export * from '@poly/db';\n");
    put('apps/web/src/hooks.server.ts', "import { x } from '@poly/auth/web';\n");
    for (const [f, c] of Object.entries(files)) put(f, c);
    return repo;
  };
  const found = (files: Record<string, string>) => { const r = fixture(files); return scan(r, webEntries(r)).join('\n'); };
  it('control: the clean fixture reports nothing', () => { expect(found({})).toBe(''); });
  it('a direct better-auth import in a route', () => { expect(found({ 'apps/web/src/routes/a.ts': "import { betterAuth } from 'better-auth';\n" })).toMatch(/better-auth imported by apps\/web\/src\/routes\/a\.ts/); });
  it('an @better-auth/* import', () => { expect(found({ 'apps/web/src/routes/a.ts': "import p from '@better-auth/passkey';\n" })).toMatch(/@better-auth\/passkey/); });
  it('the @poly/auth root, reached two hops down a relative chain', () => {
    expect(found({ 'apps/web/src/lib/a.ts': "import './b';\n", 'apps/web/src/lib/b.ts': "import { loadSession } from '@poly/auth';\n" })).toMatch(/packages\/auth\/src\/index\.ts/);
  });
  it('@poly/db/auth reached through another package', () => {
    expect(found({ 'packages/tenancy/src/index.ts': "export * from '@poly/db/auth';\n", 'apps/web/src/lib/a.ts': "import '@poly/tenancy';\n" })).toMatch(/@poly\/db\/auth/);
  });
  it('a file outside web* in packages/auth/src, reached from web.ts', () => {
    expect(found({ 'packages/auth/src/web.ts': "import './session.ts';\n", 'packages/auth/src/session.ts': 'export {};\n' })).toMatch(/session\.ts \(outside/);
  });
  it('a dynamic import and a .svelte script block are followed', () => {
    expect(found({ 'apps/web/src/lib/a.ts': "export const f = () => import('better-auth');\n" })).toMatch(/better-auth/);
    expect(found({ 'apps/web/src/routes/p.svelte': '<script lang="ts">import { x } from \'@poly/auth\';</script>\n' })).toMatch(/packages\/auth\/src\/index\.ts/);
  });
});
