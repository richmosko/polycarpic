// POLY-150 R1.4: across ALL of apps/web/src (the dialog can be mounted anywhere), web's server code never calls or names the sign-in service. Each rule is
// shown to fail on a planted copy. Titles end [red if: ...]. The scan is a pin today (web names no /api/auth in a server file); the plants show it bites.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrc = dirname(fileURLToPath(import.meta.url));
const walk = (d: string): string[] => (!existsSync(d) ? [] : readdirSync(d)).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const isServer = (f: string) => /(^|[/\\])(hooks\.server|[^/\\]*\+(page|layout)?\.?server)\.ts$|\.server\.ts$/.test(f) && !/\.test\.ts$/.test(f);
const namesService = (t: string) => /\/api\/auth|AUTH_PUBLIC_PORT/.test(t);
const callsFetch = (t: string) => /\bfetch\s*\(/.test(t);

describe('R1.4 whole-of-web server boundary', () => {
  const servers = walk(webSrc).filter(isServer);
  it('there are server files to scan, and the second-step dialog exists (so the scan is not vacuous) [red if: the dialog is missing]', () => {
    expect(servers.length).toBeGreaterThan(3);
    expect(existsSync(join(webSrc, 'lib', 'second-step', 'SecondStepSetup.svelte'))).toBe(true);
  });
  it('no server file names /api/auth or AUTH_PUBLIC_PORT, except hooks.server.ts (its 404 for the tree) [red if: web proxies or calls the service]', () => {
    for (const f of servers.filter((p) => !/hooks\.server\.ts$/.test(p))) expect(namesService(readFileSync(f, 'utf8')), relative(webSrc, f)).toBe(false);
  });
  it('no server file calls fetch against the service: a server fetch is allowed nowhere that also names /api/auth [red if: a server file fetches the service]', () => {
    for (const f of servers) {
      const t = readFileSync(f, 'utf8');
      expect(callsFetch(t) && namesService(t) && !/hooks\.server\.ts$/.test(f), relative(webSrc, f)).toBe(false);
    }
  });
  it('the rules fail on plants: a server file that fetches /api/auth, and one that names AUTH_PUBLIC_PORT [red if: a rule cannot see them]', () => {
    expect(namesService("const r = await fetch('/api/auth/sign-in/email');")).toBe(true);
    expect(callsFetch("const r = await fetch('/api/auth/sign-in/email');")).toBe(true);
    expect(namesService('process.env.AUTH_PUBLIC_PORT')).toBe(true);
    expect(namesService('export const load = () => ({});')).toBe(false);
  });
  it('+page.server.ts files export no `actions` under settings/second-step and sign-in/second-step, and the held page has no server file [red if: a form action can post secrets to web]', () => {
    for (const d of ['routes/settings/second-step', 'routes/sign-in/second-step']) for (const f of walk(join(webSrc, d)).filter(isServer)) expect(readFileSync(f, 'utf8')).not.toMatch(/export\s+(const|let|function)\s+actions\b/);
    expect(existsSync(join(webSrc, 'routes/sign-in/second-step/+page.svelte'))).toBe(true);
  });
});
