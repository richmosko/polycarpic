// POLY-161c, the thin slice: `main.ts` spawned against Postgres serves the built SvelteKit app on 3000 (ruling R2, R3, R6; verdict A1, A2, B1).
// Real server, real build, real sockets, no fake `resolve`. More rows (the crawl, CSP, form origin, limits) join this file after the slice is green.
// Needs `apps/web/build` (it fails, never skips, without one: B31) and a free port 3000.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, startWeb, type Web } from './helpers/web-server';

let web: Web;
beforeAll(async () => { web = await startWeb(); }, 120_000);
afterAll(async () => { await web?.stop(); });

describe('the built app on 3000', () => {
  it('web.started is logged once, after the build was imported, and no fatal event is there  [red if: the server does not start]', () => {
    const ev = web.lines().map((l) => l.event);
    expect(ev.filter((e) => e === 'web.started')).toHaveLength(1);
    expect(web.lines().filter((l) => l.level === 'fatal')).toEqual([]);
  });

  it('GET /api/v1/health is the real server\'s 200 with the exact body and no-store  [red if: the stand-in or another page answers]', async () => {
    const r = await ask('/api/v1/health');
    expect([r.status, r.body]).toEqual([200, '{"ok":true}']);
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('GET /sign-in is the app\'s HTML page with its own marker and a CSP header  [red if: any 200 passes]', async () => {
    const r = await ask('/sign-in');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^text\/html/);
    expect(r.body).toMatch(/<form/i);
    expect(r.headers['content-security-policy']).toBeTruthy();
  });

  it('GET /dashboard signed out is 303 to /sign-in?next=%2Fdashboard  [red if: the guard is not in front of the router]', async () => {
    const r = await ask('/dashboard');
    expect([r.status, r.headers.location]).toEqual([303, '/sign-in?next=%2Fdashboard']);
  });
});
