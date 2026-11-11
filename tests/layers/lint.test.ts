// POLY-82 acceptance harness, source-lint half. Every file under fixtures/ is linted AS the repo path named in its
// `// @virtual-path:` header, through the real eslint config (or the config generated from a named layers.json variant).
// `// @expect: a,b` (fail fixtures): every listed rule id must be reported as an error. No @expect: zero errors.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixturesDir = join(here, 'fixtures');

// Named layers.json variants a fixture can request with `// @layers: <name>`.
const variants: Record<string, (l: any) => any> = {
  'ledger-allows-posting': (l) => {
    const c = structuredClone(l);
    c.packages.ledger.allow.push('posting');
    return c;
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') || p.endsWith('.svelte')) ? [p] : [];
  });
}

function header(src: string, key: string): string | undefined {
  // `// @key: v` in .ts fixtures; `<!-- @key: v -->` in .svelte fixtures (POLY-128)
  return (src.match(new RegExp(`^// @${key}: (.+)$`, 'm')) ?? src.match(new RegExp(`^<!-- @${key}: (.+?) -->$`, 'm')))?.[1].trim();
}

async function eslintFor(variant?: string): Promise<ESLint> {
  if (!variant) return new ESLint({ cwd: root });
  const { generateConfig } = await import(pathToFileURL(join(root, 'scripts/layers/generate.mjs')).href);
  const layers = variants[variant](JSON.parse(readFileSync(join(root, 'layers.json'), 'utf8')));
  return new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: generateConfig(layers, { root }) });
}

const fixtures = walk(fixturesDir).sort();

describe('layer lint fixtures', () => {
  it('has fixtures, each with a virtual path, and fail/pass names matching @expect', () => {
    expect(fixtures.length).toBeGreaterThan(100);
    for (const f of fixtures) {
      const src = readFileSync(f, 'utf8');
      const name = f.split('/').pop()!;
      expect(header(src, 'virtual-path'), f).toBeTruthy();
      expect(!!header(src, 'expect'), `${name}: pass-/fail- prefix vs @expect`).toBe(name.startsWith('fail-'));
    }
  });

  it('every criterion directory has at least one pass or fail pair where both make sense', () => {
    const dirs = new Set(fixtures.map((f) => dirname(f)));
    for (const d of dirs) {
      const names = fixtures.filter((f) => dirname(f) === d).map((f) => f.split('/').pop()!);
      expect(names.some((n) => n.startsWith('fail-')), d).toBe(true);
    }
  });

  for (const f of fixtures) {
    const label = relative(fixturesDir, f);
    it(label, async () => {
      const src = readFileSync(f, 'utf8');
      const vpath = header(src, 'virtual-path')!;
      const expected = header(src, 'expect')?.split(',').map((s) => s.trim());
      const eslint = await eslintFor(header(src, 'layers'));
      const [res] = await eslint.lintText(src, { filePath: join(root, vpath) });
      // `// @ignore: id` drops one rule from the result (e.g. the variant adds an edge package.json does not declare).
      const ignored = header(src, 'ignore')?.split(',').map((x) => x.trim()) ?? [];
      const errors = res.messages.filter((m) => m.severity === 2 && !ignored.includes(m.ruleId ?? ''));
      const ids = errors.map((m) => m.ruleId ?? `parse:${m.message}`);
      if (!expected) {
        expect(ids, 'pass fixture must report no errors').toEqual([]);
      } else {
        for (const id of expected) expect(ids, `expected rule ${id}`).toContain(id);
      }
    });
  }
});
