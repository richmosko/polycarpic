// POLY-150 RC2 (the prerender ban), RC3 (pagehide, no-store) and RC4 widened (no {@html under routes/{settings,sign-in} or in ConfirmItsYou.svelte).
// Titles end [red if: ...]. Red today: the pages and the component do not exist.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routes = dirname(fileURLToPath(import.meta.url));
const SETUP = join(routes, 'settings', 'second-step');
const HELD = join(routes, 'sign-in', 'second-step');
const TREES = [join(routes, 'settings'), join(routes, 'sign-in')];
const libDir = join(routes, '..', 'lib');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
const src = (f: string) => readFileSync(f, 'utf8');
const sourcesOf = (dirs: string[]) => dirs.flatMap(walk).filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f));
/** The ruling's rule: a `prerender` export or setting in a route file. */
const prerenders = (text: string): boolean => /\bprerender\s*(=|:)/.test(text) || /export\s*\{[^}]*\bprerender\b/.test(text);

describe('RC2: no prerender under routes/{settings,sign-in} (a prerendered page carries the policy only in a <meta>, where frame-ancestors is ignored)', () => {
  it('no file under either tree sets prerender, in a page, a layout or a server file [red if: a page can be prerendered]', () => {
    expect(existsSync(join(HELD, '+page.svelte')), 'the trees are built, so "none" is not vacuous').toBe(true);
    for (const f of sourcesOf(TREES)) expect(prerenders(src(f)), relative(routes, f)).toBe(false);
  });
  it('the rule fails on a plant: `export const prerender = true` in a copy, a string value, and a re-export [red if: the rule cannot see a prerender]', () => {
    for (const planted of ['export const prerender = true;\n', 'export const prerender = "auto"', 'const prerender = true; export { prerender };']) expect(prerenders(planted), planted).toBe(true);
    expect(prerenders('export const ssr = true;\n'), 'control').toBe(false);
  });
});

describe('RC3: the codes are cleared on pagehide and on destroy; the set-up page is not storable', () => {
  it('the component that shows backup codes listens for pagehide and clears on destroy [red if: a back-forward-cache restore can show the codes]', () => {
    const files = sourcesOf([SETUP, libDir]).filter((f) => /\.svelte$/.test(f) && /backup/i.test(src(f)));
    expect(files.length, 'a component shows backup codes').toBeGreaterThan(0);
    const clears = files.filter((f) => /pagehide/.test(src(f)) && /onDestroy|return\s*\(\)\s*=>/.test(src(f)));
    expect(clears.length, 'one clears on pagehide and on destroy').toBeGreaterThan(0);
  });
  it("/settings/second-step's load sets Cache-Control: no-store [red if: the set-up page is storable]", () => {
    const load = join(SETUP, '+page.server.ts');
    expect(existsSync(load)).toBe(true);
    expect(src(load)).toMatch(/no-store/);
  });
});

describe('RC4 widened: {@html is banned under routes/{settings,sign-in} and in ConfirmItsYou.svelte', () => {
  it('none of them uses {@html [red if: a name or error is injected as HTML]', () => {
    expect(existsSync(join(HELD, '+page.svelte'))).toBe(true);
    const confirm = walk(libDir).filter((f) => /ConfirmItsYou\.svelte$/.test(f));
    expect(confirm.length, 'ConfirmItsYou.svelte is built (R6)').toBeGreaterThan(0);
    for (const f of [...sourcesOf(TREES), ...confirm]) expect(src(f), relative(routes, f)).not.toMatch(/\{@html\b/);
  });
});
