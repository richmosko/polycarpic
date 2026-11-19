// POLY-150 RC2 (the prerender ban), RC3 / R3.5 (clearing), R3.0 (the dialog's forms), RC4 (no {@html): the ruling's R1.4 scope is ALL of web, because the
// dialog can be mounted anywhere. Titles end [red if: ...]. Red today: the dialog does not exist.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routes = dirname(fileURLToPath(import.meta.url));
const webSrc = join(routes, '..');
const libDir = join(webSrc, 'lib');
const DIALOG = join(libDir, 'second-step', 'SecondStepSetup.svelte');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
const src = (f: string) => readFileSync(f, 'utf8');
const sourcesOf = (dir: string) => walk(dir).filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f));
/** The ruling's rule: a `prerender` export or setting in a route file. */
const prerenders = (text: string): boolean => /\bprerender\s*(=|:)/.test(text) || /export\s*\{[^}]*\bprerender\b/.test(text);
const htmlIn = (t: string) => /\{@html\b/.test(t);

describe('RC2: no route prerenders (a prerendered page carries the policy only in a <meta>, where frame-ancestors is ignored)', () => {
  it('no file under routes/** sets prerender, in a page, a layout or a server file [red if: a page can be prerendered]', () => {
    expect(existsSync(DIALOG), 'the dialog is built, so "none" is not vacuous').toBe(true);
    for (const f of sourcesOf(routes)) expect(prerenders(src(f)), relative(routes, f)).toBe(false);
  });
  it('the rule fails on a plant: `export const prerender = true` in a copy, a string value, and a re-export [red if: the rule cannot see a prerender]', () => {
    for (const planted of ['export const prerender = true;\n', 'export const prerender = "auto"', 'const prerender = true; export { prerender };']) expect(prerenders(planted), planted).toBe(true);
    expect(prerenders('export const ssr = true;\n'), 'control').toBe(false);
  });
});

describe('RC3 / R3.5: the dialog clears on every way out; web\'s signed-in responses are not storable', () => {
  it('SecondStepSetup.svelte clears on pagehide, beforeNavigate and destroy [red if: a back-forward-cache restore or a client-side navigation can show the codes]', () => {
    expect(existsSync(DIALOG), 'lib/second-step/SecondStepSetup.svelte').toBe(true);
    const s = src(DIALOG);
    expect(s).toMatch(/pagehide/);
    expect(s).toMatch(/beforeNavigate/);
    expect(s).toMatch(/onDestroy|return\s*\(\)\s*=>/);
  });
  it('hooks.server.ts sets Cache-Control: no-store once on signed-in pages and __data.json (R10) [red if: a page that mounts the dialog is storable]', () => {
    expect(src(join(webSrc, 'hooks.server.ts'))).toMatch(/no-store/);
  });
});

describe('R3.0: the dialog is a portal outside any form, and its forms post only by fetch', () => {
  it('its <form>s have no action and no method attribute, every submit handler calls preventDefault, and it mounts on document.body [red if: a submit can fall back to a web action]', () => {
    expect(existsSync(DIALOG)).toBe(true);
    const s = src(DIALOG);
    const forms = s.match(/<form\b[^>]*>/g) ?? [];
    expect(forms.length, 'the steps are forms').toBeGreaterThan(0);
    for (const f of forms) expect(f, f).not.toMatch(/\b(action|method)\s*=/);
    expect(s).toMatch(/preventDefault\(\)/);
    expect(s).toMatch(/document\.body/);
  });
  it('no route renders the dialog inside a <form> [red if: the dialog is nested in a page form]', () => {
    expect(existsSync(DIALOG)).toBe(true);
    for (const f of walk(webSrc).filter((p) => /\.svelte$/.test(p) && p !== DIALOG)) {
      const s = src(f);
      const at = s.search(/<SecondStepSetup\b/);
      if (at === -1) continue;
      const open = s.lastIndexOf('<form', at);
      const close = s.lastIndexOf('</form>', at);
      expect(open > close, `${relative(webSrc, f)} mounts the dialog inside a <form>`).toBe(false);
    }
  });
});

describe('RC4 (R1.4): {@html appears in no .svelte file in apps/web/src', () => {
  it('none uses {@html [red if: a name or error is injected as HTML]', () => {
    expect(existsSync(DIALOG), 'the dialog is built, so the scan reads it').toBe(true);
    for (const f of walk(webSrc).filter((p) => /\.svelte$/.test(p))) expect(htmlIn(src(f)), relative(webSrc, f)).toBe(false);
  });
  it('the rule fails on a planted {@html [red if: the rule cannot see one]', () => {
    expect(htmlIn('<p>{@html name}</p>')).toBe(true);
    expect(htmlIn('<p>{name}</p>')).toBe(false);
  });
});
