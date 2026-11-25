// POLY-161c: the start-up of the real `main.ts`: zone check before listen (R7, A3, B7 to B12), the missing build, the busy port, the adapter's
// variables (R1, B28), the listener list under hostile adapter variables, and SIGTERM. One spawned process per case; every refusal asserts the
// event AND that no other fatal event is there (B7), and has a positive case. The resolver is faked by an `--import` preload that replaces
// `dns.promises.Resolver.prototype.resolveSoa` (no product seam, R10). Serial: port 3000 is fixed.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from './helpers/pg';
import { ask, freePort, listeners, startWeb, type Web } from './helpers/web-server';

const dir = mkdtempSync(join(tmpdir(), 'poly161-start-'));
const QUERIES = join(dir, 'queries.log');
// zone plan: server -> soa | nx | nodata | servfail | silent. Written once; the product's own two resolvers are asked.
const PRELOAD = join(dir, 'resolver.mjs');
writeFileSync(PRELOAD, `
import dns from 'node:dns/promises';
import { appendFileSync } from 'node:fs';
const plan = JSON.parse(process.env.ZONE_PLAN ?? '{}');
const log = process.env.ZONE_QUERY_LOG;
const err = (code) => Object.assign(new Error('planted ' + code), { code });
dns.Resolver.prototype.resolveSoa = async function (name) {
  const server = this.getServers()[0];
  if (log) appendFileSync(log, server + ' ' + name + '\\n');
  const b = plan[server] ?? 'soa';
  if (b === 'silent') { await new Promise((r) => setTimeout(r, 120000)); throw err('ETIMEOUT'); }
  if (b === 'nx') throw err('ENOTFOUND');
  if (b === 'nodata') throw err('ENODATA');
  if (b === 'servfail') throw err('ESERVFAIL');
  return { nsname: 'ns.test', hostmaster: 'h.test', serial: 1, refresh: 1, retry: 1, expire: 1, minttl: 1 };
};
`);

const REAL = { TLS_MODE: 'real-domain', PUBLIC_ORIGIN: 'https://app.example.com' };
const plan = (a: string, b: string) => ({ ZONE_PLAN: JSON.stringify({ '1.1.1.1': a, '9.9.9.9': b }), ZONE_QUERY_LOG: QUERIES });
const fatals = (w: Web) => w.lines().filter((l) => l.level === 'fatal').map((l) => l.event);
const events = (w: Web) => w.lines().map((l) => l.event);
const opened = (): Promise<boolean> => new Promise((res) => { const s = connect(3000, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });

const started: Web[] = [];
afterEach(async () => { for (const w of started.splice(0)) await w.stop(); });
const run = async (o: Parameters<typeof startWeb>[0]) => { const w = await startWeb(o); started.push(w); return w; };
const queries = () => (existsSync(QUERIES) ? readFileSync(QUERIES, 'utf8').split('\n').filter(Boolean) : []);

describe('the zone check runs before the server listens (A3)', () => {
  it('both resolvers say NXDOMAIN: exit 1, one zone.refused (fatal, outcome refused), nothing else fatal, 3000 never opened  [red if: the server starts, or another fatal event hides in the exit 1]', async () => {
    writeFileSync(QUERIES, '');
    const w = await run({ until: null, preload: [PRELOAD], env: { ...REAL, ...plan('nx', 'nx') } });
    expect(await w.exited).toBe(1);
    expect(fatals(w)).toEqual(['zone.refused']);
    expect(w.lines().find((l) => l.event === 'zone.refused')).toMatchObject({ outcome: 'refused', service: 'web' });
    expect(events(w)).not.toContain('web.started');
    expect(w.out()).not.toContain('example.com');
    expect(queries().map((q) => q.split(' ')[1])).toEqual(['example.com', 'example.com']);
  }, 60_000);

  it('NXDOMAIN beside a silent or failing resolver starts: zone.unverified (warn) before web.started  [red if: one NXDOMAIN refuses]', async () => {
    for (const other of ['servfail', 'nodata']) {
      const w = await run({ preload: [PRELOAD], env: { ...REAL, ...plan('nx', other) } });
      const ev = events(w);
      expect(ev.indexOf('zone.unverified'), other).toBeGreaterThanOrEqual(0);
      expect(ev.indexOf('zone.unverified')).toBeLessThan(ev.indexOf('web.started'));
      expect(fatals(w)).toEqual([]);
      await w.stop();
    }
  }, 120_000);

  it('NXDOMAIN beside an SOA is verified, before web.started; the box answers on 3000  [red if: the positive case is refused]', async () => {
    const w = await run({ preload: [PRELOAD], env: { ...REAL, ...plan('nx', 'soa') } });
    const ev = events(w);
    expect(ev.indexOf('zone.verified')).toBeGreaterThanOrEqual(0);
    expect(ev.indexOf('zone.verified')).toBeLessThan(ev.indexOf('web.started'));
    expect((await ask('/api/v1/health', { host: 'app.example.com' })).status).toBe(200);
  }, 60_000);

  it('while the resolvers are held silent, 3000 refuses connections; it opens only once the bound (5 s) has passed  [red if: the listen comes first (B9)]', async () => {
    const t0 = Date.now();
    const p = startWeb({ preload: [PRELOAD], env: { ...REAL, ...plan('silent', 'silent') } });
    const seen: boolean[] = [];
    let w: Web | undefined;
    const timer = setInterval(() => { void opened().then((o) => seen.push(o)); }, 300);
    w = await p;
    clearInterval(timer);
    started.push(w);
    const took = Date.now() - t0;
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((o) => o === false), 'no connect succeeded while held').toBe(true);
    expect(took).toBeGreaterThanOrEqual(4500);
    expect(took).toBeLessThan(30_000);
    expect(events(w)).toContain('zone.unverified');
    expect(await opened()).toBe(true);
  }, 90_000);

  it('private-ca is skipped: no query is made, no zone event is logged, and it starts  [red if: localhost is looked up]', async () => {
    writeFileSync(QUERIES, '');
    const w = await run({ preload: [PRELOAD], env: plan('nx', 'nx') });
    expect(events(w).filter((e) => e.startsWith('zone.'))).toEqual([]);
    expect(queries()).toEqual([]);
    expect(events(w)).toContain('web.started');
  }, 60_000);
});

describe('the other refusals each name their own event (B7)', () => {
  it('a build that is missing: exit 1, web.build_missing, nothing else fatal, 3000 never opened  [red if: exit 1 alone is accepted]', async () => {
    const copy = join(dir, 'nobuild');
    mkdirSync(join(copy, 'apps/web'), { recursive: true });
    cpSync(join(ROOT, 'apps/web/src'), join(copy, 'apps/web/src'), { recursive: true });
    cpSync(join(ROOT, 'apps/web/package.json'), join(copy, 'apps/web/package.json'));
    symlinkSync(join(ROOT, 'apps/web/node_modules'), join(copy, 'apps/web/node_modules'));
    const { spawn } = await import('node:child_process');
    const { dbEnv, cloneMigrated } = await import('./helpers/api');
    const env = { PATH: process.env.PATH!, ...dbEnv('poly_app', cloneMigrated()), APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', STATUS_PORT: String(await freePort()) };
    const p = spawn('node', ['--experimental-strip-types', join(copy, 'apps/web/src/main.ts')], { env, cwd: copy });
    let out = '';
    p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (out += c));
    const code = await new Promise<number | null>((r) => { const t = setTimeout(() => { p.kill('SIGKILL'); r(null); }, 40_000); p.on('exit', (c) => { clearTimeout(t); r(c); }); });
    const lines = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as { event: string; level: string });
    expect(code, out).toBe(1);
    expect(lines.filter((l) => l.level === 'fatal').map((l) => l.event)).toEqual(['web.build_missing']);
    expect(lines.map((l) => l.event)).not.toContain('web.started');
    expect(await opened()).toBe(false);
  }, 60_000);

  it('a busy port 3000: exit 1, web.bind_failed through the logger, nothing else fatal  [red if: a hand-made line, or exit 1 alone]', async () => {
    const { createServer } = await import('node:net');
    const blocker = createServer().listen(3000, '0.0.0.0');
    await new Promise<void>((r) => blocker.once('listening', () => r()));
    try {
      const { cloneMigrated, dbEnv } = await import('./helpers/api');
      const { spawn } = await import('node:child_process');
      const env = { PATH: process.env.PATH!, ...dbEnv('poly_app', cloneMigrated()), APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', STATUS_PORT: String(await freePort()) };
      const p = spawn('node', ['--experimental-strip-types', join(ROOT, 'apps/web/src/main.ts')], { env, cwd: ROOT });
      let out = '';
      p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (out += c));
      const code = await new Promise<number | null>((r) => { const t = setTimeout(() => { p.kill('SIGKILL'); r(null); }, 40_000); p.on('exit', (c) => { clearTimeout(t); r(c); }); });
      const lines = out.split('\n').filter((l) => l.trim() !== '');
      expect(code, out).toBe(1);
      for (const l of lines) expect(() => JSON.parse(l), `a non-JSON line: ${l}`).not.toThrow();
      const parsed = lines.map((l) => JSON.parse(l) as { event: string; level: string; service?: string; ts?: string });
      expect(parsed.filter((l) => l.level === 'fatal').map((l) => l.event)).toEqual(['web.bind_failed']);
      expect(parsed.find((l) => l.event === 'web.bind_failed')).toMatchObject({ service: 'web' });
      expect(parsed.find((l) => l.event === 'web.bind_failed')!.ts).toBeTruthy();
      expect(parsed.map((l) => l.event)).not.toContain('web.started');
    } finally { blocker.close(); }
  }, 60_000);

  it('POLY_ADAPTER_* is refused by name: exit 1, config.refused fault forbidden, 3000 never opened; the same variable unprefixed is not the adapter\'s  [red if: the adapter\'s variables configure the server]', async () => {
    const w = await run({ until: null, env: { POLY_ADAPTER_HOST_HEADER: 'x-host' } });
    expect(await w.exited).toBe(1);
    expect(w.lines().filter((l) => l.event === 'config.refused')).toEqual([expect.objectContaining({ var: 'POLY_ADAPTER_HOST_HEADER', fault: 'forbidden', outcome: 'refused' })]);
    expect(events(w)).not.toContain('web.started');
    expect(await opened()).toBe(false);
  }, 60_000);

  it('PORT, HOST, SOCKET_PATH, HOST_HEADER, PROTOCOL_HEADER and ORIGIN set leave the bind and the Host pin alone  [red if: an adapter variable moves the listener or the pinned Host]', async () => {
    const w = await run({ env: { PORT: '4001', HOST: '127.0.0.1', SOCKET_PATH: join(dir, 'x.sock'), HOST_HEADER: 'x-forwarded-host', PROTOCOL_HEADER: 'x-forwarded-proto', ORIGIN: 'https://evil.example', ADDRESS_HEADER: 'x-forwarded-for' } });
    expect(listeners(w.proc.pid!)).toEqual(['0.0.0.0:3000', `127.0.0.1:${w.statusPort}`].sort());
    expect((await ask('/api/v1/health')).status).toBe(200);
    const spoof = await ask('/sign-in', { host: 'evil.example', headers: { 'x-forwarded-host': 'localhost:5173' } });
    expect(spoof.status).toBe(421);
    expect(existsSync(join(dir, 'x.sock'))).toBe(false);
  }, 60_000);
});

describe('SIGTERM', () => {
  it('stops listening, closes idle connections and exits 0 within the grace; an idle keep-alive socket is closed  [red if: it hangs on an idle connection, or exits non-zero]', async () => {
    const w = await run({});
    const s = connect(3000, '127.0.0.1');
    await new Promise<void>((r) => s.once('connect', () => r()));
    s.write('GET /api/v1/health HTTP/1.1\r\nHost: localhost:5173\r\n\r\n');
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    w.proc.kill('SIGTERM');
    expect(await w.exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(await opened()).toBe(false);
    s.destroy();
  }, 60_000);
});

// seceng's S3 addition (ruling-review @ addendum 2): the CSP replacement is unmeasured, so a header check is not enough. Chromium loads the page from the
// real main.ts and its own script must run: Kit's inline bootstrap (carries the nonce) and start.js (script-src 'self'), with no violation reported.
describe('S3: the page\'s own script runs under the policy, in a browser', () => {
  it('/sign-in loads in Chromium with exactly one CSP header, no violation event or console report, and the SvelteKit bootstrap and entry script have run  [red if: two policies are in force, the nonce does not match, or a script is blocked]', async () => {
    const { createRequire } = await import('node:module');
    const { chromium } = createRequire(join(ROOT, 'apps/web/package.json'))('@playwright/test') as typeof import('@playwright/test');
    const w = await run({});
    expect(w.proc.exitCode).toBeNull();
    const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP localhost:5173 127.0.0.1:3000'] });
    try {
      const page = await browser.newPage();
      const reports: string[] = [];
      page.on('console', (m) => { if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) reports.push(m.text()); });
      page.on('pageerror', (e) => reports.push(String(e)));
      await page.addInitScript(() => { (window as unknown as { __v: string[] }).__v = []; document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.blockedURI}`)); });
      const res = await page.goto('http://localhost:5173/sign-in', { waitUntil: 'networkidle' });
      expect(res!.status()).toBe(200);
      const csp = Object.entries(await res!.allHeaders()).filter(([k]) => k === 'content-security-policy');
      expect(csp, 'exactly one policy header').toHaveLength(1);
      const state = await page.evaluate(() => ({
        v: (window as unknown as { __v: string[] }).__v,
        boot: Object.keys(window).filter((k) => k.startsWith('__sveltekit_')),
        scripts: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/_app\/immutable\/entry\/(start|app)\./.test(n)),
        nonceScripts: [...document.querySelectorAll('script')].filter((s) => s.nonce || s.getAttribute('nonce')).length + [...document.querySelectorAll('script:not([src])')].length,
      }));
      expect(state.v, 'violation events').toEqual([]);
      expect(reports, 'console reports').toEqual([]);
      expect(state.boot.length, 'the inline bootstrap ran').toBeGreaterThan(0);
      expect(state.scripts.length, 'start and app entry scripts were fetched').toBeGreaterThanOrEqual(2);
      expect(state.nonceScripts).toBeGreaterThan(0);
    } finally { await browser.close(); }
  }, 120_000);
});
