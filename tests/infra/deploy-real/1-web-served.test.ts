// POLY-161 R9 / S10 (verdict A1, A2, A4, B4 to B6, B22, B23): what the real first-deploy left running is the real web server. Runs right after part 1 on the box it made
// (file order: 1-first-deploy, 1-web-served, 2-rollback). Everything is asked of the RUNNING web container, inside its own network namespace:
//   1. its listening TCP sockets are exactly 0.0.0.0:3000 and 127.0.0.1:8081 (one listener on 3000; 8081 is the control that the list is read in the right namespace);
//   2. the page, its CSP by value, an asset it names, the guard, the pinned Host, health over loopback;
//   3. the guard's positive case: a user seeded as the superuser (password hashed in the auth container, random per run), signed in through auth, then /dashboard on web
//      with the handle: 200 and the user's name, no Set-Cookie, no-store; a random handle: 303 and the cookie cleared;
//   4. web's own `docker logs`: every line JSON with an event, none holding the handle, the password, a planted cookie, a planted path or an invitation canary,
//      and a zone event before web.started.
// Secrets are made at run time (never a literal beside a credential-like name) and recorded with secret(), so the sweep of the kept log looks for them too.
import { describe, expect, it } from 'vitest';
import { IN_CI, log, missing, projectContainers, putRoot, readRoot, root, secret, step } from './harness.ts';

const gap = missing();
if (gap.length && IN_CI) throw new Error(`deploy-real: ${gap.join(', ')} missing in CI: T-real must run, not skip`);
const suite = gap.length ? describe.skip : describe;

const HOST = 'staging.example.com';
const mark = (s: string) => ['canary', 'zq7', s].join('-');
const nameOf = (service: string): string => { const c = projectContainers().find((x) => x.service === service); if (!c) throw new Error(`no ${service} container`); return c.name; };
const exec = (service: string, argv: string[], input?: string) => root(['docker', 'exec', ...(input ? ['-i'] : []), nameOf(service), ...argv], input ? { input } : {});

interface Ask { path: string; method?: string; host?: string; headers?: Record<string, string>; body?: string }
interface Got { status: number; headers: Record<string, string | string[]>; raw: string[]; body: string }
/** Requests made from inside the web container to its own 3000, with any Host, by node:http (fetch cannot set Host). */
function webAsk(reqs: Ask[]): Got[] {
  const script = `
    const http = require('node:http');
    const reqs = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    const one = (q) => new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: 3000, path: q.path, method: q.method || 'GET', setHost: false, headers: { ...(q.host === null ? {} : { host: q.host || '${HOST}' }), ...(q.headers || {}) } }, (res) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body: Buffer.concat(c).toString('utf8') }));
      });
      r.on('error', (e) => resolve({ status: 0, headers: {}, raw: [], body: String(e.code || e) }));
      if (q.body) r.write(q.body);
      r.end();
    });
    (async () => { const out = []; for (const q of reqs) out.push(await one(q)); process.stdout.write(JSON.stringify(out)); })();
  `;
  const r = exec('web', ['node', '-e', script], JSON.stringify(reqs));
  if (r.code !== 0) throw new Error(`webAsk failed: ${r.err || r.out}`);
  return JSON.parse(r.out) as Got[];
}
const one = (q: Ask): Got => webAsk([q])[0]!;

const handle = { value: '' };
const user = { id: '', name: '', email: '', password: '' };

suite('T-real 1b: the running web container serves the real app', () => {
  it('B5, B6: web\'s listening sockets, read in its own namespace, are exactly 0.0.0.0:3000 and 127.0.0.1:8081; 8081 is seen as a control  [red if: a second listener on 3000 or another port, or the list is read in the host\'s namespace]', () => {
    const rd = (f: string) => exec('web', ['cat', f]).out;
    const socks: string[] = [];
    for (const [file, v6] of [['/proc/net/tcp', false], ['/proc/net/tcp6', true]] as const) {
      for (const line of rd(file).split('\n').slice(1)) {
        const c = line.trim().split(/\s+/);
        if (c.length < 4 || c[3] !== '0A') continue;
        const [a, p] = c[1]!.split(':');
        const port = parseInt(p!, 16);
        const ip = v6 ? (/^0+$/.test(a!) ? '[::]' : `v6:${a}`) : a!.match(/../g)!.reverse().map((h) => parseInt(h, 16)).join('.');
        socks.push(`${ip}:${port}`);
      }
    }
    // Docker's embedded resolver sits on 127.0.0.11, in every container namespace: left out by that exact address only.
    const own = socks.filter((s) => !/^127\.0\.0\.11:\d+$/.test(s)).sort();
    log(`web listeners: ${own.join(' ')}`);
    expect(own).toEqual(['0.0.0.0:3000', '127.0.0.1:8081']);
    expect(rd('/proc/net/tcp').length, 'the control read something').toBeGreaterThan(100);
  });

  it('B22: /sign-in is the app\'s HTML page: its own form, one CSP header by value with a nonce or hash, and the first immutable file it names is served as JavaScript  [red if: any 200 passes]', () => {
    const [page] = webAsk([{ path: '/sign-in' }]);
    expect(page!.status).toBe(200);
    expect(String(page!.headers['content-type'])).toMatch(/^text\/html/);
    expect(page!.body).toMatch(/<form/i);
    const csp = page!.raw.flatMap((h, i) => (i % 2 === 0 && h.toLowerCase() === 'content-security-policy' ? [page!.raw[i + 1]!] : []));
    expect(csp, 'exactly one CSP header').toHaveLength(1);
    const dirs = Object.fromEntries(csp[0]!.split(/;\s*/).map((d) => { const [n, ...v] = d.split(/\s+/); return [n, v]; })) as Record<string, string[]>;
    const { 'script-src': scripts, ...rest } = dirs;
    expect(rest).toEqual({
      'default-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'"], 'connect-src': ["'self'"],
      'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
    });
    expect(scripts![0]).toBe("'self'");
    expect(scripts!.slice(1)).toHaveLength(1);
    expect(scripts!.slice(1)[0]).toMatch(/^'(nonce-|sha256-)/);
    const href = /\/?_app\/immutable\/[^"' )]+\.js/.exec(page!.body)?.[0];
    expect(href, 'the page names an immutable file').toBeTruthy();
    const asset = one({ path: href!.startsWith('/') ? href! : `/${href}` });
    expect(asset.status).toBe(200);
    expect(String(asset.headers['content-type'])).toMatch(/javascript/);
  });

  it('the guard, the pinned Host and health: /dashboard is 303 to sign-in, another Host is 421, the loopback Host serves health and nothing else  [red if: the router is open, or Host decides the URL]', () => {
    const got = webAsk([
      { path: '/dashboard' },
      { path: '/dashboard', host: 'evil.example' },
      { path: '/api/v1/health', host: '127.0.0.1:3000' },
      { path: '/dashboard', host: '127.0.0.1:3000' },
      { path: '/api/v1/health', host: 'evil.example' },
      { path: '/api/v1/health' },
    ]);
    expect([got[0]!.status, got[0]!.headers.location]).toEqual([303, '/sign-in?next=%2Fdashboard']);
    expect([got[1]!.status, got[1]!.body]).toEqual([421, '{"error":"misdirected"}']);
    expect([got[2]!.status, got[2]!.body]).toEqual([200, '{"ok":true}']);
    expect(got[3]!.status).toBe(421);
    expect(got[4]!.status).toBe(421);
    expect([got[5]!.status, got[5]!.body], 'health through the public host').toEqual([200, '{"ok":true}']);
  });

  it('B4: a user seeded as the superuser (password hashed in the auth container) signs in through auth; /dashboard on web with the handle is 200 with the name, no Set-Cookie, no-store  [red if: a guard that refuses everyone passes]', () => {
    user.password = secret('web-served/user-password', 18);
    user.name = 'Treal ' + mark('person');
    user.email = `treal-${mark('mail').slice(-6)}@example.test`;
    // the hash, made by the auth container's own BetterAuth configuration: no hand-rolled format
    const hashJs = `
      const m = await import('/app/apps/auth/node_modules/@poly/auth/src/index.ts');
      const a = await m.createAuth(m.authOptions({ secret: 'hash-only-'.repeat(6), baseURL: 'https://${HOST}', tlsMode: 'real-domain', requireClientIp: true, mailer: { send: async () => {} } }));
      const pw = (await a.$context).password;
      process.stdout.write(await pw.hash(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s)); })));
      process.exit(0);`;
    const h = exec('auth', ['node', '--input-type=module', '-e', hashJs], user.password);
    expect(h.code, h.err).toBe(0);
    const hash = h.out.trim();
    expect(hash.length).toBeGreaterThan(40);
    const id = '0f2b7c1e-3d4a-4b5c-8d6e-7f8091a2b3c4';
    user.id = id;
    const sql = `INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${id}', '${user.name}', '${user.email}', true);
      INSERT INTO public.account (account_id, provider_id, user_id, password) VALUES ('${id}', 'credential', '${id}', '${hash}');`;
    const ins = exec('postgres', ['psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-v', 'ON_ERROR_STOP=1'], sql);
    expect(ins.code, ins.err).toBe(0);
    // signed in through auth, from inside its container (Caddy's address header is what the service requires)
    const signJs = `
      const r = await fetch('http://127.0.0.1:3000/api/auth/sign-in/email', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'https://${HOST}', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify(JSON.parse(await new Promise((x) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => x(s)); }))) });
      process.stdout.write(JSON.stringify({ status: r.status, cookies: r.headers.getSetCookie() }));`;
    const s = exec('auth', ['node', '--input-type=module', '-e', signJs], JSON.stringify({ email: user.email, password: user.password }));
    expect(s.code, s.err).toBe(0);
    const signed = JSON.parse(s.out) as { status: number; cookies: string[] };
    expect(signed.status, JSON.stringify(signed.cookies.map((c) => c.split('=')[0]))).toBe(200);
    const hc = signed.cookies.find((c) => c.startsWith('__Host-poly_handle='));
    expect(hc, 'auth set the handle cookie').toBeTruthy();
    handle.value = hc!.split(';')[0]!.slice('__Host-poly_handle='.length);
    expect(handle.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // recorded only so the sweep of the kept log looks for the handle's text too
    const cur = JSON.parse(readRoot('/run/poly-deploy-real/secrets.json') ?? '{}');
    cur['web-served/handle'] = handle.value;
    putRoot('/run/poly-deploy-real/secrets.json', JSON.stringify(cur), '0600');

    const page = one({ path: '/dashboard', headers: { cookie: `__Host-poly_handle=${handle.value}` } });
    expect(page.status).toBe(200);
    expect(page.body).toContain(user.name);
    expect(page.headers['set-cookie'], 'S10: no Set-Cookie on a signed-in page').toBeUndefined();
    expect(String(page.headers['cache-control']), 'S10: no-store').toContain('no-store');
  });

  it('B38: signed in, /settings/second-step is 200 with its own heading on the running image (the page that loads qrcode-generator from the production install)  [red if: the dependency is missing from the install and the page is a 500]', () => {
    const r = one({ path: '/settings/second-step', headers: { cookie: `__Host-poly_handle=${handle.value}` } });
    expect(r.status).toBe(200);
    expect(r.body).toContain('Sign-in and second step');
    expect(r.body).toContain(user.name);
    // and the data route that carries the page's load
    const d = one({ path: '/settings/second-step/__data.json', headers: { cookie: `__Host-poly_handle=${handle.value}` } });
    expect([d.status, JSON.parse(d.body).type]).toEqual([200, 'data']);
  });

  it('a random handle is 303 and the cookie is cleared; the dashboard asked with the real handle but a wrong Host is 421  [red if: a dead handle is let in or left in the browser]', () => {
    const fake = Buffer.from(mark('handle').padEnd(32, 'x')).toString('base64url').slice(0, 43);
    const [r, wrongHost] = webAsk([
      { path: '/dashboard', headers: { cookie: `__Host-poly_handle=${fake}` } },
      { path: '/dashboard', host: 'evil.example', headers: { cookie: `__Host-poly_handle=${handle.value}` } },
    ]);
    expect([r!.status, r!.headers.location]).toEqual([303, '/sign-in?next=%2Fdashboard']);
    expect(([] as string[]).concat(r!.headers['set-cookie'] ?? []), 'F1: exactly the one clearing line').toEqual(['__Host-poly_handle=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax']);
    expect(wrongHost!.status).toBe(421);
  });

  it('B23, S10: web\'s own docker logs: every line is JSON with an event; nothing of the requests above is in them; a zone event precedes web.started  [red if: a request, a cookie or the invitation canary is logged]', () => {
    const planted = {
      path: `/${mark('path')}`,
      query: mark('query'),
      cookie: mark('cookie'),
      invite: mark('invite'),
    };
    webAsk([
      { path: `${planted.path}?q=${planted.query}`, headers: { cookie: `__Host-poly_handle=${planted.cookie}`, 'x-planted': planted.cookie } },
      { path: `/sign-up?invitation=${planted.invite}` },
      { path: '/sign-in', method: 'POST', headers: { origin: `https://${HOST}`, 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${planted.cookie}` }, body: `email=${planted.query}` },
    ]);
    const logs = root(['docker', 'logs', nameOf('web')]);
    const text = logs.out + logs.err;
    expect(text.length, 'web wrote logs (the control)').toBeGreaterThan(100);
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const bad = lines.filter((l) => { try { return typeof JSON.parse(l).event !== 'string'; } catch { return true; } });
    expect(bad, 'lines that are not a JSON log line').toEqual([]);
    for (const [what, v] of [...Object.entries(planted), ['handle', handle.value], ['password', user.password]] as const) expect(text, `${what} is in web's logs`).not.toContain(v);
    const events = lines.map((l) => JSON.parse(l).event as string);
    expect(events).toContain('web.started');
    const zone = events.findIndex((e) => e === 'zone.verified' || e === 'zone.unverified');
    expect(zone, 'a zone event is logged').toBeGreaterThanOrEqual(0);
    expect(zone).toBeLessThan(events.indexOf('web.started'));
    expect(events.filter((e) => e === 'zone.refused')).toEqual([]);
    step('web logs checked', () => log(`web log events: ${[...new Set(events)].join(', ')}`));
  });
});

// POLY-160 R5 (C20, C23, C24), the literal restart: Postgres restarts under the running web, auth and worker. None of the three restarts or crashes, health answers 200 again, and the worker's next job.run is ok.
// [red if: survive() is removed from a pool: the process ends on the unhandled client error and Docker restarts it (StartedAt and RestartCount change)]
// The three `db.connection_lost.*` lines are not asserted: a client that was idle at the restart is dropped by the pool silently (R5), and only a checked-out one is reported; that is not decidable from outside.
suite('T-real 1c: Postgres restarts under the running services', () => {
  const sleep = (s: number) => root(['sleep', String(s)]);
  const pg = (sql: string) => exec('postgres', ['psql', '-U', 'postgres', '-d', 'polycarpic', '-X', '-Atc', sql]).out.trim();
  const health = () => one({ path: '/api/v1/health' }).status;
  const probe = (name: string) => { const r = root(['docker', 'inspect', '-f', '{{.State.StartedAt}} {{.RestartCount}}', nameOf(name)]); return r.out.trim(); };
  const lines = (service: string) => { const r = root(['docker', 'logs', nameOf(service)]); return (r.out + r.err).split('\n').filter((l) => l.trim() !== ''); };
  const jobOk = (l: string) => { try { const j = JSON.parse(l); return j.event === 'job.run' && j.outcome === 'ok'; } catch { return false; } };

  it('poly_app, poly_auth and poly_worker are connected at once; `docker restart` of Postgres; health is 200 within 60 s; the three are not restarted; the worker runs a job ok afterwards  [red if: a pool lets the lost connection end its process]', () => {
    // make all three roles hold a connection: health and a page for app, auth's own endpoint, and the worker's drain (every 30 s, idle clients live 10 s)
    const seen = (): string[] => pg("select distinct usename from pg_stat_activity where usename in ('poly_app','poly_auth','poly_worker') order by 1").split('\n');
    let have: string[] = [];
    for (let t = 0; t < 90; t += 3) {
      health();
      exec('auth', ['node', '-e', "fetch('http://127.0.0.1:3000/api/auth/ok',{headers:{'x-forwarded-for':'127.0.0.1'}}).then(()=>process.exit(0))"]);
      have = seen();
      if (have.join() === 'poly_app,poly_auth,poly_worker') break;
      sleep(3);
    }
    expect(have, 'all three roles connected before the restart (never skipped)').toEqual(['poly_app', 'poly_auth', 'poly_worker']);
    const before = { web: probe('web'), auth: probe('auth'), worker: probe('worker') };
    const okBefore = lines('worker').filter(jobOk).length;
    const r = root(['docker', 'restart', nameOf('postgres')], { timeout: 120_000 });
    expect(r.code, r.err).toBe(0);
    let status = 0;
    for (let t = 0; t < 60 && status !== 200; t += 2) {
      status = health();
      if (status !== 200) sleep(2);
    }
    expect(status, 'health is 200 within 60 s of the restart').toBe(200);
    sleep(15);
    expect({ web: probe('web'), auth: probe('auth'), worker: probe('worker') }, 'StartedAt and RestartCount of the three are unchanged').toEqual(before);
    for (const s of ['web', 'auth', 'worker']) expect(lines(s).filter((l) => /process\.crash/.test(l)), `${s} logged no crash`).toEqual([]);
    let ok = false;
    for (let t = 0; t < 90 && !ok; t += 3) {
      ok = lines('worker').filter(jobOk).length > okBefore;
      if (!ok) sleep(3);
    }
    expect(ok, 'the worker\'s next job.run after the restart is ok').toBe(true);
    for (const s of ['web', 'auth', 'worker']) expect(lines(s).join('\n'), `${s}'s logs hold no password`).not.toContain(user.password || 'no-password-recorded');
  }, 15 * 60_000);
});
