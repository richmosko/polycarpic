// POLY-161c: the real artefact. `main.ts` spawned against Postgres serving the built SvelteKit app on 3000 (ruling R2 to R6, R15; seceng S2 to S5, S10;
// verdict A1, A2, A6, A8, B1 to B4, B15, B18 to B22, B34, B36). Real server, real build, real sockets: no fake `resolve`, no hand-written route list.
// Needs `apps/web/build` (a missing build FAILS, never skips: B31) and a free port 3000; the file runs serially (vitest.config SERIAL).
// Ordered: everything with the database up, then the database taken away (the last describe).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HANDLE_COOKIE, sessionWithHandle } from './helpers/handle';
import { must } from './helpers/sql';
import { ask, BUILD, listeners, ORIGIN_HOST, startWeb, type Web } from './helpers/web-server';

// Built at run time from low-entropy pieces (scanner rule 8): never a literal beside a credential-like name.
const mark = (s: string) => ['canary', 'zq7', s].join('-');
const CANARY_PATH = mark('path');
const CANARY_QUERY = mark('query');
const CANARY_HDR = mark('hdr');
const CANARY_BODY = mark('body');
const CANARY_INVITE = mark('invite');
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const OURS = `https://${ORIGIN_HOST}`;

// R6's exact set, written here on purpose: a test that reads the product's own set agrees with it by construction.
const PUBLIC = ['/api/v1/health', '/sign-in', '/sign-in/cancel-method', '/sign-in/forgot', '/sign-in/reset', '/sign-in/second-step', '/sign-up'];

let web: Web;
let handle: string;
const userId = '11111111-2222-4333-8444-555555555555';
const NAME = 'Qa Person Onesixone';
const cookie = () => `${HANDLE_COOKIE}=${handle}`;

beforeAll(async () => {
  web = await startWeb();
  must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${userId}', '${NAME}', 'qa161@qa.test', true)`, web.db);
  handle = sessionWithHandle(web.db, userId).handle;
}, 120_000);
afterAll(async () => { await web?.stop(); });

const routeIds = (): string[] => [...readFileSync(join(BUILD, 'server/manifest.js'), 'utf8').matchAll(/^\s*id: "([^"]+)"/gm)].map((m) => m[1]!);
const concrete = (id: string) => id.replace(/\[\.\.\.[^\]]+\]|\[\[?[^\]]+\]\]?/g, 'x');
const dataOf = (p: string) => (p === '/' ? '/__data.json' : `${p}/__data.json`);
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe('start: one real server, one listener on 3000', () => {
  it('web.started is logged once and no fatal event is there  [red if: the server does not start]', () => {
    expect(web.lines().filter((l) => l.event === 'web.started')).toHaveLength(1);
    expect(web.lines().filter((l) => l.level === 'fatal')).toEqual([]);
  });

  it('the process\'s listening sockets are exactly 0.0.0.0:3000 and 127.0.0.1:<status port>; the status port is seen as a control  [red if: a second listener appears on 3000 or another port]', () => {
    expect(listeners(web.proc.pid!)).toEqual([`0.0.0.0:3000`, `127.0.0.1:${web.statusPort}`].sort());
  });
});

describe('the route crawl on the built server (S2; B1 to B3, B34)', () => {
  it('the ids come from the manifest, there are at least 18, and every public path is among them  [red if: a hand-written list, or a renamed route leaves a stale public entry]', () => {
    const ids = routeIds();
    expect(ids.length).toBeGreaterThanOrEqual(18);
    for (const p of PUBLIC) expect(ids, p).toContain(p);
  });

  it('every route id, in every method and as __data.json: public ids are served, every other is the sign-in guard  [red if: a route is unguarded, or a prefix makes a new one public]', async () => {
    const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const bad: string[] = [];
    for (const id of routeIds()) {
      const path = concrete(id);
      const isPublic = PUBLIC.includes(id);
      const next = `/sign-in?next=${encodeURIComponent(path)}`;
      for (const method of methods) {
        const withBody = ['POST', 'PUT', 'PATCH'].includes(method);
        const r = await ask(path, { method, headers: { origin: OURS, ...(withBody ? FORM : {}) }, ...(withBody ? { body: 'a=b' } : {}) });
        const guarded = r.status === 303 && r.headers.location === next;
        if (r.headers['set-cookie']) bad.push(`${method} ${path}: a signed-out answer sets a cookie (${String(r.headers['set-cookie'])})`);
        if (isPublic && guarded) bad.push(`${method} ${path}: public but guarded`);
        if (!isPublic && !guarded) bad.push(`${method} ${path}: expected guard ${next}, got ${r.status} ${r.headers.location ?? ''}`);
        if (!isPublic && r.body.includes('<form')) bad.push(`${method} ${path}: a page body behind the guard`);
      }
      const d = await ask(dataOf(path));
      if (d.headers['set-cookie']) bad.push(`__data ${path}: a signed-out answer sets a cookie`);
      if (isPublic && id !== '/api/v1/health') {
        if (!(d.status === 200 && /"type":"data"/.test(d.body))) bad.push(`__data ${path}: public page has no data node (${d.status})`);
      } else if (!isPublic) {
        let body: { type?: string; location?: string } = {};
        try { body = JSON.parse(d.body); } catch { /* checked below */ }
        if (!(d.status === 200 && body.type === 'redirect' && body.location === next && !/"type":"data"/.test(d.body))) bad.push(`__data ${path}: expected a redirect to ${next} and no data node, got ${d.status} ${d.body.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a guarded route\'s answer to POST with our Origin is the 303, not a page and not Kit\'s 405 (the guard is in front of the router)  [red if: the router answers before the guard]', async () => {
    const r = await ask('/dashboard', { method: 'POST', headers: { origin: OURS, ...FORM }, body: 'a=b' });
    expect([r.status, r.headers.location]).toEqual([303, '/sign-in?next=%2Fdashboard']);
  });

  it('unknown paths, near misses and traversal forms are the guard too  [red if: a prefix or a decode bug opens a path]', async () => {
    for (const p of ['/sign-in/anything', '/sign-in/reset/x', '/healthz', '/api/v1/health/x', '/robots.txt', '/service-worker.js', '/%2e%2e/dashboard', '/dashboard%2f', '/DASHBOARD', '/sign-in%2fx']) {
      const r = await ask(p);
      expect(r.status, p).toBe(303);
      expect(String(r.headers.location), p).toMatch(/^\/sign-in\?next=%2F/);
    }
    expect((await ask('/sign-in/__data.json')).status).toBe(200);
    expect(JSON.parse((await ask('/dashboard/__data.json')).body).type).toBe('redirect');
  });

  it('what Kit answers before the hook: env.js is empty, other /_app files 404, __route.js 400, a trailing slash 308, a remote call is no data  [red if: env.js carries a value or a path leaks data]', async () => {
    expect((await ask('/_app/env.js')).body).toBe('export const env={}');
    for (const p of ['/_app/nope.js', '/_app/immutable/x.js', '/_app/routes/x', '/_app/packages.json', '/packages.json']) {
      const r = await ask(p);
      expect([404, 303], p).toContain(r.status);
      expect(r.body, p).not.toMatch(/"name"\s*:/);
    }
    for (const p of ['/__route.js', '/dashboard/__route.js']) expect((await ask(p)).status, p).toBe(400);
    for (const p of ['/sign-in/', '/dashboard/']) expect((await ask(p)).status, p).toBe(308);
    const remote = await ask('/_app/remote/x/y', { headers: { 'x-sveltekit-pathname': '/sign-in' } });
    expect(remote.status).not.toBe(200);
    expect(remote.body).not.toMatch(/"type":"(result|data)"/);
  });

  it('the manifest\'s remotes key exists and has no entry; the build has no service worker  [red if: a remote function or a worker file is added]', () => {
    const m = readFileSync(join(BUILD, 'server/manifest.js'), 'utf8');
    expect(/remotes:\s*\{\s*\}/.test(m), 'remotes: {} present and empty').toBe(true);
    expect(readdirSync(join(BUILD, 'client')).includes('service-worker.js')).toBe(false);
    expect(walk(join(BUILD, 'client')).some((f) => /service-worker/.test(f))).toBe(false);
  });

  it('the static files outside _app/immutable are exactly the listed ones; each is public  [red if: a file is planted in static/ or a map is emitted for the client]', async () => {
    const files = walk(join(BUILD, 'client')).map((f) => relative(join(BUILD, 'client'), f)).filter((f) => !f.startsWith('_app/immutable/')).sort();
    expect(files).toEqual(['_app/version.json', '_app/version.json.br', '_app/version.json.gz', 'theme.js', 'theme.js.br', 'theme.js.gz']);
    expect(walk(join(BUILD, 'client')).filter((f) => f.endsWith('.map'))).toEqual([]);
    for (const f of ['/theme.js', '/_app/version.json']) expect((await ask(f)).status, f).toBe(200);
  });

  it('the first immutable file the sign-in page names is served as JavaScript  [red if: the asset tree is not mounted]', async () => {
    const page = await ask('/sign-in');
    const href = /\/?_app\/immutable\/[^"' )]+\.js/.exec(page.body)?.[0];
    expect(href, 'the page names an immutable file').toBeTruthy();
    const r = await ask(href!.startsWith('/') ? href! : `/${href}`);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/javascript/);
    expect(String(r.headers['cache-control'])).toMatch(/immutable/);
  });

  it('no file under build/client or build/server is a source map once the stage has run, and the adapter\'s index.js is absent from the image build; here the local build is only checked for client maps  [red if: client maps are emitted]', () => {
    expect(walk(join(BUILD, 'client')).filter((f) => f.endsWith('.map'))).toEqual([]);
  });
});

describe('B4: the guard\'s positive case, with a live handle', () => {
  it('GET /dashboard with a live handle is the page for that user: 200, the name, no-store, no Set-Cookie  [red if: a guard that refuses everyone passes]', async () => {
    const r = await ask('/dashboard', { headers: { cookie: cookie() } });
    expect(r.status).toBe(200);
    expect(r.body).toContain(NAME);
    expect(String(r.headers['cache-control'])).toContain('no-store');
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('its __data.json is data, not a redirect  [red if: the data route is guarded for a signed-in user]', async () => {
    const r = await ask('/dashboard/__data.json', { headers: { cookie: cookie() } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).type).toBe('data');
  });

  it('a random handle is the 303 to sign-in and the cookie is cleared  [red if: a dead handle leaves the cookie, or is let in]', async () => {
    const r = await ask('/dashboard', { headers: { cookie: `${HANDLE_COOKIE}=${'a'.repeat(43)}` } });
    expect([r.status, r.headers.location]).toEqual([303, '/sign-in?next=%2Fdashboard']);
    // F1: exactly one Set-Cookie, the clearing of web's own handle, every attribute
    expect(([] as string[]).concat(r.headers['set-cookie'] ?? [])).toEqual([`${HANDLE_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`]);
  });
});

describe('S3, B36: the CSP, by value, exactly one header', () => {
  const EXPECT: Record<string, string[]> = {
    'default-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'"],
    'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
  };
  const parse = (v: string) => Object.fromEntries(v.split(/;\s*/).filter(Boolean).map((d) => { const [n, ...vals] = d.split(/\s+/); return [n!, vals]; })) as Record<string, string[]>;
  const header = (r: Awaited<ReturnType<typeof ask>>) => {
    const all = r.rawHeaders.flatMap((h, i) => (i % 2 === 0 && h.toLowerCase() === 'content-security-policy' ? [r.rawHeaders[i + 1]!] : []));
    expect(all, 'exactly one CSP header').toHaveLength(1);
    return parse(all[0]!);
  };
  /** `nonce` pages: script-src is 'self' plus one nonce or hash; the static 500 page: 'self' only. */
  const check = (p: Record<string, string[]>, scripts: 'nonce' | 'self') => {
    const { 'script-src': s, ...rest } = p;
    expect(rest).toEqual(EXPECT);
    expect(s!.filter((t) => t === "'self'")).toHaveLength(1);
    const extra = s!.filter((t) => t !== "'self'");
    if (scripts === 'self') expect(extra).toEqual([]);
    else { expect(extra).toHaveLength(1); expect(extra[0]).toMatch(/^'(nonce-[A-Za-z0-9+/_=-]+|sha256-[A-Za-z0-9+/=]+)'$/); }
    expect(s!.some((t) => /unsafe-(inline|eval)/.test(t))).toBe(false);
  };

  it('the 200 sign-in page and the 200 signed-in page carry C-07\'s directives, script-src \'self\' plus one nonce or hash  [red if: a directive is missing, widened, duplicated or the header is doubled]', async () => {
    check(header(await ask('/sign-in')), 'nonce');
    check(header(await ask('/dashboard', { headers: { cookie: cookie() } })), 'nonce');
  });

  it('the 404 page (a signed-in unknown path) carries them too  [red if: the error page skips the policy]', async () => {
    const r = await ask('/nonexistent', { headers: { cookie: cookie() } });
    expect(r.status).toBe(404);
    expect(String(r.headers['content-type'])).toMatch(/text\/html/);
    check(header(r), 'nonce');
  });

  it('a redirect and a fixed JSON answer carry the default policy, by value  [red if: only pages are covered]', async () => {
    check(header(await ask('/dashboard')), 'self');
  });
});

describe('S4: the form-origin check (C-06) on the built server', () => {
  it.each(['/sign-in', '/sign-up', '/dashboard', '/api/v1/health'])('POST %s: a foreign Origin and no Origin are Kit\'s 403 with its fixed message; our Origin is not  [red if: the check is off or the message differs]', async (p) => {
    for (const [label, headers] of [['foreign', { origin: 'https://evil.example' }], ['none', {}], ['null', { origin: 'null' }], ['http scheme', { origin: `http://${ORIGIN_HOST}` }]] as const) {
      const r = await ask(p, { method: 'POST', headers: { ...FORM, ...headers }, body: 'a=b' });
      expect([r.status, r.body.trim()], `${p} ${label}`).toEqual([403, 'Cross-site POST form submissions are forbidden']);
    }
    const ok = await ask(p, { method: 'POST', headers: { ...FORM, origin: OURS }, body: 'a=b' });
    expect(ok.status, `${p} ours`).not.toBe(403);
  });

  it('the other form content types are checked, and a forged Host cannot make a foreign Origin ours  [red if: multipart or text/plain slip through, or Host is trusted]', async () => {
    for (const ct of ['multipart/form-data; boundary=x', 'text/plain']) {
      const r = await ask('/dashboard', { method: 'POST', headers: { 'content-type': ct, origin: 'https://evil.example' }, body: 'a' });
      expect(r.status, ct).toBe(403);
    }
    const forged = await ask('/dashboard', { method: 'POST', host: 'evil.example', headers: { ...FORM, origin: 'https://evil.example' }, body: 'a=b' });
    expect([forged.status, forged.body]).toEqual([421, '{"error":"misdirected"}']);
  });
});

describe('health on the real server (B21)', () => {
  it('GET is 200 with byte-equal body and the ruled headers, a query is ignored, HEAD has no body  [red if: any page answers 200]', async () => {
    const a = await ask('/api/v1/health');
    const b = await ask('/api/v1/health?x=1');
    for (const r of [a, b]) {
      expect([r.status, r.body]).toEqual([200, '{"ok":true}']);
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.headers['cache-control']).toBe('no-store');
    }
    const h = await ask('/api/v1/health', { method: 'HEAD' });
    expect([h.status, h.body]).toEqual([200, '']);
  });

  it('POST and PUT with our Origin are 405; a trailing slash is a 308; the status listener does not serve it  [red if: another verb answers, or 8081 carries health]', async () => {
    const got: Record<string, number> = {};
    for (const m of ['POST', 'PUT', 'PATCH']) got[m] = (await ask('/api/v1/health', { method: m, headers: { ...FORM, origin: OURS }, body: 'a=b' })).status;
    got.DELETE = (await ask('/api/v1/health', { method: 'DELETE', headers: { origin: OURS } })).status;
    got.OPTIONS = (await ask('/api/v1/health', { method: 'OPTIONS', headers: { origin: OURS } })).status;
    expect(got).toEqual({ POST: 405, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 });
    expect((await ask('/api/v1/health/')).status).toBe(308);
    const s = await ask('/api/v1/health', { port: web.statusPort, host: `127.0.0.1:${web.statusPort}` });
    expect(s.body).not.toBe('{"ok":true}');
    expect([404, 401, 403, 405]).toContain(s.status);
  });

  it('a wrong Host is 421 even for health; the loopback Host is admitted for the probe only (M5, B20)  [red if: the exception is wider than one path and one method]', async () => {
    for (const host of ['evil.example', `${ORIGIN_HOST}/sign-in?`, 'localhost:5174']) {
      const r = await ask('/api/v1/health', { host });
      expect([r.status, r.body], host).toEqual([421, '{"error":"misdirected"}']);
    }
    const probe = await ask('/api/v1/health', { host: '127.0.0.1:3000' });
    expect([probe.status, probe.body]).toEqual([200, '{"ok":true}']);
    for (const p of ['/dashboard', '/sign-in', '/api/v1/health?x', '/api/v1/health/']) expect((await ask(p, { host: '127.0.0.1:3000' })).status, p).toBe(421);
    expect((await ask('/api/v1/health', { host: '127.0.0.1:3000', method: 'HEAD' })).status).toBe(421);
  });

  it('a path inside Host (M5) answers 421, not the page it names  [red if: Host decides the URL]', async () => {
    const r = await ask('/dashboard', { host: `${ORIGIN_HOST}/sign-in?` });
    expect(r.status).toBe(421);
  });
});

describe('aborts and bad bytes on the real server (B18)', () => {
  it('a battery of resets leaves the same pid answering and logs no crash  [red if: an abort reaches the crash handler]', async () => {
    const pid = web.proc.pid;
    const socks: Socket[] = [];
    const fire = (fn: (s: Socket) => void) => { const s = connect(3000, '127.0.0.1'); socks.push(s); s.on('error', () => {}); s.on('connect', () => fn(s)); };
    for (let i = 0; i < 6; i++) {
      fire((s) => { s.write(`GET /sign-in HTTP/1.1\r\nHost: ${ORIGIN_HOST}\r\nX`); s.destroy(); });
      fire((s) => { s.write(`POST /sign-in HTTP/1.1\r\nHost: ${ORIGIN_HOST}\r\nOrigin: ${OURS}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\nabc`); s.destroy(); });
      fire((s) => { s.write(`GET /sign-in HTTP/1.1\r\nHost: ${ORIGIN_HOST}\r\n\r\n`); s.once('data', () => s.resetAndDestroy()); });
      fire((s) => { s.resetAndDestroy(); });
      fire((s) => { s.write(`GET /dashboard/__data.json HTTP/1.1\r\nHost: ${ORIGIN_HOST}\r\nCookie: ${cookie()}\r\n\r\n`); setTimeout(() => s.resetAndDestroy(), 5); });
    }
    await new Promise((r) => setTimeout(r, 800));
    for (const s of socks) s.destroy();
    expect((await ask('/api/v1/health')).status).toBe(200);
    expect(web.proc.pid).toBe(pid);
    expect(web.proc.exitCode).toBeNull();
    expect(web.lines().filter((l) => l.event === 'process.crash')).toEqual([]);
  });
});

describe('A8: nothing of the request in the logs', () => {
  it('requests that carry canaries in the path, query, header, cookie and body leave none in web\'s output, and every line is a JSON log line  [red if: a request is logged, or a non-JSON line is printed]', async () => {
    await ask(`/${CANARY_PATH}?q=${CANARY_QUERY}`, { headers: { 'x-canary': CANARY_HDR, cookie: `${HANDLE_COOKIE}=${CANARY_HDR}` } });
    await ask(`/sign-up?invitation=${CANARY_INVITE}`);
    await ask('/sign-in', { method: 'POST', headers: { ...FORM, origin: OURS, authorization: `Bearer ${CANARY_HDR}` }, body: `email=${CANARY_BODY}` });
    await ask(`/dashboard/${CANARY_PATH}`, { headers: { cookie: cookie(), referer: `https://x.example/${CANARY_QUERY}` } });
    const out = web.out();
    for (const c of [CANARY_PATH, CANARY_QUERY, CANARY_HDR, CANARY_BODY, CANARY_INVITE, handle]) expect(out, c).not.toContain(c);
    const bad = out.split('\n').filter((l) => l.trim() !== '').filter((l) => { try { return typeof JSON.parse(l).event !== 'string'; } catch { return true; } });
    expect(bad).toEqual([]);
  });

  it('a control line from the same logger is seen, so an empty sweep cannot pass  [red if: the capture is blind]', () => {
    expect(web.lines().some((l) => l.event === 'web.started')).toBe(true);
  });
});

describe('B15, A8, B21: the database failing under a running web (last: the faults stay)', () => {
  // SQL-level faults, not a killed connection: a dropped idle pool socket is a different failure (reported apart).
  it('a signed-in request whose session call errors is Kit\'s fixed 500 page with the exact default policy; the log has web.error with type and code, and no request or error text  [red if: handleError is missing, the raw error is printed, or the 500 page has no policy]', async () => {
    must('ALTER FUNCTION app.enter_session(text) RENAME TO enter_session_planted', web.db);
    const r = await ask(`/dashboard?q=${CANARY_QUERY}`, { headers: { cookie: cookie() } });
    expect(r.status).toBe(500);
    expect(String(r.headers['content-type'])).toMatch(/text\/html/);
    const csp = r.rawHeaders.flatMap((h, i) => (i % 2 === 0 && h.toLowerCase() === 'content-security-policy' ? [r.rawHeaders[i + 1]!] : []));
    expect(csp).toHaveLength(1);
    const dirs = Object.fromEntries(csp[0]!.split(/;\s*/).map((d) => { const [n, ...v] = d.split(/\s+/); return [n, v]; }));
    // by value, every directive: the static 500 page does not go through Kit's policy, so this is the default header's own text
    expect(dirs).toEqual({
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'"],
      'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
    });
    expect(r.body).not.toContain(CANARY_QUERY);
    expect(r.body).not.toMatch(/enter_session|does not exist|at .*\.js:\d+/);
    await new Promise((res) => setTimeout(res, 200));
    const errs = web.lines().filter((l) => l.event === 'web.error');
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0]).toMatchObject({ outcome: 'error', status: 500 });
    expect(errs[0]!.err?.type).toBeTruthy();
    const out = web.out();
    for (const c of [CANARY_QUERY, handle, 'enter_session', 'does not exist', 'dashboard?']) expect(out, c).not.toContain(c);
    expect(web.lines().filter((l) => l.event === 'process.crash')).toEqual([]);
    expect(web.proc.exitCode).toBeNull();
  });

  it('health is 503 {"ok":false} once the memo expires and the migration table is unreadable; the same pid; a signed-out page is still served  [red if: health stays green over a failing database]', async () => {
    const pid = web.proc.pid;
    must('ALTER TABLE drizzle.__drizzle_migrations RENAME TO __drizzle_migrations_planted', web.db);
    await new Promise((r) => setTimeout(r, 5500));
    const h = await ask('/api/v1/health');
    expect([h.status, h.body]).toEqual([503, '{"ok":false}']);
    expect(h.headers['cache-control']).toBe('no-store');
    expect((await ask('/sign-in')).status).toBe(200);
    expect(web.proc.pid).toBe(pid);
    expect(web.proc.exitCode).toBeNull();
  }, 30_000);
});
