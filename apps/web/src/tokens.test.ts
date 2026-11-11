// POLY-128 criterion 1 (ruling R2): app.css is the one colour-literal file and equals DESIGN's tokens.css.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const appCss = join(here, 'app.css');
const designCss = join(here, '..', '..', '..', 'docs', 'DESIGN', 'tokens.css');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties declared in the top-level `selector { ... }` blocks. */
function tokens(css: string, selector: string): Record<string, string> {
  const src = stripComments(css);
  const out: Record<string, string> = {};
  const re = new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  for (const m of src.matchAll(re)) {
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim().replace(/\s+/g, ' ');
  }
  return out;
}

const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FN = /\b(?:rgba?|hsla?|oklch)\(\s*[0-9.]/;
/** 1-based line numbers of raw colour literals in `src`. */
function colourLiterals(src: string): number[] {
  const hits: number[] = [];
  src.split('\n').forEach((line, i) => {
    if (HEX.test(line) || FN.test(line)) hits.push(i + 1);
  });
  return hits;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(svelte|ts|js|css)$/.test(p) ? [p] : [];
  });
}

describe('token parity with docs/DESIGN/tokens.css', () => {
  it('app.css exists  [red if: the stylesheet is missing or elsewhere]', () => {
    expect(existsSync(appCss)).toBe(true);
  });
  for (const sel of [':root', '.dark']) {
    it(`${sel} block equals DESIGN name for name and value for value  [red if: a token is missing, extra or edited]`, () => {
      const design = tokens(readFileSync(designCss, 'utf8'), sel);
      expect(Object.keys(design).length, 'DESIGN has tokens').toBeGreaterThan(40);
      const app = tokens(existsSync(appCss) ? readFileSync(appCss, 'utf8') : '', sel);
      expect(app).toEqual(design);
    });
  }
  it('comments naming --warning are not read as tokens  [red if: comments not stripped]', () => {
    expect(tokens('/* --warning: #fff; */ :root { --a: #000; }', ':root')).toEqual({ '--a': '#000' });
  });
});

describe('hex guard over apps/web/src', () => {
  it('app.css, the one allowed home, exists  [red if: the file is missing]', () => {
    expect(existsSync(appCss)).toBe(true);
  });
  it('no raw colour literal outside app.css and *.test.ts  [red if: any file hard-codes a colour]', () => {
    const bad = walk(here)
      .filter((f) => f !== appCss && !f.endsWith('.test.ts'))
      .flatMap((f) => colourLiterals(readFileSync(f, 'utf8')).map((n) => `${relative(here, f)}:${n}`));
    expect(bad).toEqual([]);
  });
  it('scanner self-test: flags hex in markup, Tailwind arbitrary value, <style>, and colour functions', () => {
    expect(colourLiterals('<p style="color:#fff">')).toEqual([1]);
    expect(colourLiterals('<div class="bg-[#1F2528]">')).toEqual([1]);
    expect(colourLiterals('<style>\n a { color: #abc; }\n</style>')).toEqual([2]);
    expect(colourLiterals('x = "#0000"')).toEqual([1]);
    expect(colourLiterals('c = rgba(0, 0, 0, .5)')).toEqual([1]);
    expect(colourLiterals('c = oklch(0.5 0.1 200)')).toEqual([1]);
    expect(colourLiterals('c = hsl(10 20% 30%)')).toEqual([1]);
  });
  it('scanner self-test: passes fragments, entities and var() uses', () => {
    expect(colourLiterals('<a href="#main">')).toEqual([]);
    expect(colourLiterals('a &#123; b')).toEqual([]);
    expect(colourLiterals('color: var(--sidebar)')).toEqual([]);
    expect(colourLiterals('href="#section-2"')).toEqual([]);
  });
});
