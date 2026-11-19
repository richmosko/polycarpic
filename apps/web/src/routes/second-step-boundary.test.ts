// POLY-150 R1, R10, RC4: what keeps every secret out of web's process (a boundary test, not a policy). Source-level, no browser.
// Titles end [red if: ...]. Red today: the second-step pages do not exist; the placeholder has no server file.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routes = dirname(fileURLToPath(import.meta.url));
const SETUP = join(routes, 'settings', 'second-step');
const HELD = join(routes, 'sign-in', 'second-step');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
const src = (f: string) => readFileSync(f, 'utf8');
const serverFiles = (d: string) => walk(d).filter((f) => /\+(page|layout)?\.?server\.ts$|\+server\.ts$/.test(f));

describe('R1: the pages exist', () => {
  it('both second-step pages are built [red if: a page is missing]', () => {
    expect(existsSync(join(HELD, '+page.svelte')), 'sign-in/second-step').toBe(true);
    expect(src(join(SETUP, '+page.svelte'))).not.toMatch(/The setup screen is not built yet/);
  });
  it('the Settings page has a load that reads mySecondStep from @poly/auth/web [red if: the page reads from anywhere else]', () => {
    const load = join(SETUP, '+page.server.ts');
    expect(existsSync(load), 'settings/second-step/+page.server.ts').toBe(true);
    expect(src(load)).toMatch(/mySecondStep/);
    expect(src(load)).toMatch(/@poly\/auth\/web/);
  });
});

describe('R1: no server file under /sign-in/second-step; no fetch, no /api/auth, no actions under either route', () => {
  it('/sign-in/second-step has no server file at all [red if: a load, action or +server.ts exists there (S10)]', () => {
    expect(existsSync(join(HELD, '+page.svelte'))).toBe(true); // the page is there, so "none" is not vacuous
    expect(serverFiles(HELD)).toEqual([]);
  });
  it('no server file under either route calls fetch, names /api/auth or AUTH_PUBLIC_PORT, or exports actions [red if: web proxies the service]', () => {
    expect(serverFiles(SETUP).length, 'the Settings page has its load').toBeGreaterThan(0);
    for (const f of [...serverFiles(SETUP), ...serverFiles(HELD)]) {
      const s = src(f);
      const where = relative(routes, f);
      expect(s, `${where} calls fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(s, `${where} names /api/auth`).not.toMatch(/\/api\/auth/);
      expect(s, `${where} names AUTH_PUBLIC_PORT`).not.toMatch(/AUTH_PUBLIC_PORT/);
      expect(s, `${where} exports actions`).not.toMatch(/export\s+(const|let|function)\s+actions\b/);
    }
  });
  it('no +server.ts under either route [red if: an endpoint hides under the page]', () => {
    expect(existsSync(join(SETUP, '+page.svelte'))).toBe(true);
    for (const d of [SETUP, HELD]) expect(walk(d).filter((f) => /\+server\.ts$/.test(f))).toEqual([]);
  });
});

describe('R1 / R7 / RC4: what the page sources may contain', () => {
  const sources = () => [...walk(SETUP), ...walk(HELD), ...walk(join(routes, '..', 'lib')).filter((f) => /second-step|ConfirmItsYou|SecondStep/i.test(f))].filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f));
  it('{@html is not used under the second-step routes or the panel components (RC4: a passkey name is the user\'s text) [red if: a name or error is injected as HTML]', () => {
    expect(src(join(SETUP, '+page.svelte'))).not.toMatch(/The setup screen is not built yet/); // built, so the scan below reads real pages
    for (const f of sources()) expect(src(f), relative(routes, f)).not.toMatch(/\{@html\b/);
  });
  it('no source names locked_until or lockedUntil: the lock shows no time (R7, S14) [red if: the page learns or shows when a lock ends]', () => {
    expect(existsSync(join(HELD, '+page.svelte'))).toBe(true);
    for (const f of sources()) expect(src(f), relative(routes, f)).not.toMatch(/locked_?[uU]ntil/);
  });
  it('no source sends trustDevice (R7) and none names get-totp-uri (R3: the URI is never fetched again) [red if: either appears]', () => {
    expect(existsSync(join(HELD, '+page.svelte'))).toBe(true);
    for (const f of sources()) {
      const s = src(f);
      expect(s, relative(routes, f)).not.toMatch(/trustDevice/);
      expect(s, relative(routes, f)).not.toMatch(/get-totp-uri/);
    }
  });
  it('the three pages that read `next` import the one module (S22) [red if: a page keeps its own copy of the rule]', () => {
    const hooks = src(join(routes, '..', 'hooks.server.ts'));
    expect(hooks).toMatch(/safe-next/);
    expect(src(join(routes, 'sign-in', '+page.svelte'))).toMatch(/safe-next/);
    expect(src(join(HELD, '+page.svelte'))).toMatch(/safe-next/);
  });
});
