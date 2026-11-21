// POLY-138 (ruling d5ead294) container tests on the real Caddy derivative (infra/caddy), in front of two echo upstreams:
//   R1  a forged X-Forwarded-For (two entries, plus a second header line), X-Real-IP and Forwarded reach web and auth, on
//       both sites, as ONE X-Forwarded-For line with ONE entry (the TCP peer) and no X-Real-IP / Forwarded.
//   R2  any request carrying Service-Worker (any value, any case of the name) gets 403 with the security headers, on a web
//       path and an /api/auth/* path, on app. and on allowlisted staging. (with and without credentials); without the
//       header the same paths proxy.
//   R3  no query string, path token, Referer or credential value reaches `docker logs`, for a stopped upstream (dial
//       failure) and for one that accepts and closes; the stopped case shows the filtered paths (so a silent log passes nothing).
// The echo upstream is the repo's pinned node image (the app Dockerfile's FROM), already pulled for the app build.
// R10 (Cache-Control override) is not here: it waits for decision D3.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, sh } from './stack.ts';

const IMG = 'poly138-caddy:test';
const tag = randomBytes(3).toString('hex');
const NET = `poly138net${tag}`;
const WEB = `poly138web${tag}`;
const AUTH = `poly138auth${tag}`;
const CADDY = `poly138caddy${tag}`;
const DOMAIN = 'poly.test';
const PORT = 19443 + Math.floor(Math.random() * 500);
const NODE = (/^FROM (node:\S+)/m.exec(readFileSync(join(ROOT, 'Dockerfile'), 'utf8')) ?? [])[1] ?? '';
const SEC = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
let dir = '';

// Echoes the raw request header lines and the peer. A URL containing "closeme" gets its socket destroyed (accept-then-close).
const ECHO = `require('http').createServer((q,r)=>{if(q.url.includes('closeme')){q.socket.destroy();return}
r.setHeader('content-type','application/json');r.end(JSON.stringify({who:process.env.WHO,url:q.url,raw:q.rawHeaders,peer:q.socket.remoteAddress}))}).listen(3000)`;

type Res = { status: number; h: Record<string, string[]>; body: string };
const get = (host: string, path: string, extra: string[] = []): Res => {
  const r = sh('curl', ['-ksS', '-i', '--max-time', '40', '--resolve', `${host}:${PORT}:127.0.0.1`, ...extra, `https://${host}:${PORT}${path}`]);
  const [head = '', ...rest] = r.out.replace(/\r\n/g, '\n').split(/\n\n/);
  const lines = head.split('\n');
  const h: Record<string, string[]> = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) (h[l.slice(0, i).toLowerCase()] ??= []).push(l.slice(i + 1).trim()); }
  return { status: Number(/^HTTP\/\S+ (\d+)/.exec(lines[0] ?? '')?.[1] ?? 0), h, body: rest.join('\n\n') };
};
const echo = (b: string) => JSON.parse(b) as { who: string; url: string; raw: string[]; peer: string };
/** every value of a request header, one per header LINE the upstream received */
const lineValues = (raw: string[], name: string) => raw.reduce<string[]>((a, v, i) => (i % 2 === 0 && v.toLowerCase() === name ? [...a, raw[i + 1]!] : a), []);

const startCaddy = () => {
  sh('docker', ['rm', '-f', CADDY]);
  const r = sh('docker', ['run', '-d', '--name', CADDY, '--network', NET, '-p', `127.0.0.1:${PORT}:8443`,
    '-e', `POLY_DOMAIN=${DOMAIN}`, '-e', 'POLY_TLS=internal', '-e', 'POLY_STAGING_ALLOW=0.0.0.0/0 ::/0',
    '-v', `${dir}/staging_basic_auth:/run/secrets/staging_basic_auth:ro`, IMG]);
  if (r.code !== 0) throw new Error(r.err);
  for (let i = 0; i < 40; i++) { if (get(`app.${DOMAIN}`, '/').status) return; sh('sleep', ['1']); }
  throw new Error('caddy did not answer: ' + sh('docker', ['logs', CADDY]).err.slice(-600));
};
const startEcho = (name: string, who: string, aliases: string[]) => {
  const r = sh('docker', ['run', '-d', '--name', name, '--network', NET, ...aliases.flatMap((a) => ['--network-alias', a]), '-e', `WHO=${who}`, NODE, 'node', '-e', ECHO]);
  if (r.code !== 0) throw new Error(r.err);
};

beforeAll(() => {
  if (!NODE) throw new Error('no node FROM line in the root Dockerfile');
  const b = sh('docker', ['build', '-t', IMG, join(ROOT, 'infra', 'caddy')]);
  if (b.code !== 0) throw new Error(`docker build infra/caddy failed: ${b.err.slice(-500)}`);
  dir = mkdtempSync(join(tmpdir(), 'poly138-caddy-'));
  mkdirSync(dir, { recursive: true });
  const hash = sh('docker', ['run', '--rm', IMG, 'caddy', 'hash-password', '--plaintext', 'pw']).out;
  writeFileSync(join(dir, 'staging_basic_auth'), `qa ${hash}\n`, { mode: 0o644 });
  sh('docker', ['network', 'create', NET]);
  startEcho(WEB, 'web', ['prod-web', 'staging-web']);
  startEcho(AUTH, 'auth', ['prod-auth', 'staging-auth']);
  for (let i = 0; i < 30; i++) { if (sh('docker', ['logs', WEB]).code === 0 && sh('docker', ['exec', WEB, 'node', '-e', "require('http').get('http://127.0.0.1:3000',r=>process.exit(0)).on('error',()=>process.exit(1))"]).code === 0) break; sh('sleep', ['1']); }
  startCaddy();
});
afterAll(() => { sh('docker', ['rm', '-f', CADDY, WEB, AUTH]); sh('docker', ['network', 'rm', NET]); });

const SITES: [string, string[]][] = [[`app.${DOMAIN}`, []], [`staging.${DOMAIN}`, ['-u', 'qa:pw']]];
const PATHS: [string, string][] = [['/sign-in', 'web'], ['/api/auth/session', 'auth']];

describe('R1: Caddy overwrites the client address (forged headers never reach an upstream)', () => {
  const FORGE = ['-H', 'X-Forwarded-For: 198.51.100.1, 203.0.113.5', '-H', 'X-Forwarded-For: 9.9.9.9', '-H', 'X-Real-IP: 198.51.100.7', '-H', 'Forwarded: for=198.51.100.7;proto=https'];
  const cases = SITES.flatMap(([host, auth]) => PATHS.map(([path, who]) => [host, auth, path, who] as const));
  it.each(cases)('%s %s %s: one X-Forwarded-For line, one entry, the peer; no X-Real-IP, no Forwarded', (host, auth, path, who) => {
    const clean = get(host, path, auth);
    expect(clean.status, 'an unforged request proxies').toBe(200);
    const peer = lineValues(echo(clean.body).raw, 'x-forwarded-for');
    expect(peer, 'the peer, as a single entry').toHaveLength(1);
    expect(peer[0]).toMatch(/^[0-9a-f.:]+$/i);

    const r = get(host, path, [...auth, ...FORGE]);
    expect(r.status).toBe(200);
    const e = echo(r.body);
    expect(e.who).toBe(who);
    const xff = lineValues(e.raw, 'x-forwarded-for');
    expect(xff, 'exactly one header line').toHaveLength(1); // red: the second line reaches the upstream
    expect(xff[0]!.split(',').map((x) => x.trim()), 'one entry').toHaveLength(1); // red: the forged list is kept or appended to
    expect(xff[0]).toBe(peer[0]); // red: a forged address wins (trusted_proxies), or the peer differs from the real one
    for (const forged of ['198.51.100.1', '203.0.113.5', '9.9.9.9']) expect(xff[0]).not.toContain(forged);
    expect(lineValues(e.raw, 'x-real-ip'), 'X-Real-IP deleted').toEqual([]); // red: no `header_up -X-Real-IP`
    expect(lineValues(e.raw, 'forwarded'), 'Forwarded deleted').toEqual([]); // red: no `header_up -Forwarded`
  });
});

describe('R2: a request carrying Service-Worker is refused before basic_auth and any proxy', () => {
  const expectSecurity = (h: Record<string, string[]>) => { for (const [k, v] of Object.entries(SEC)) expect(h[k], k).toEqual([v]); };
  const sw = [['app', `app.${DOMAIN}`, []], ['staging with credentials', `staging.${DOMAIN}`, ['-u', 'qa:pw']], ['staging without credentials', `staging.${DOMAIN}`, []]] as const;
  it.each(sw.flatMap(([n, host, auth]) => PATHS.map(([p]) => [n, host, auth, p] as const)))('%s %s %s: Service-Worker: script -> 403 with the security headers', (_n, host, auth, path) => {
    const r = get(host, path, [...auth, '-H', 'Service-Worker: script']);
    expect(r.status).toBe(403); // red: 200 (proxied) or 401 (basic_auth first)
    expectSecurity(r.h); // red: the refusal bypasses the header snippet
    expect(r.body, 'nothing from the upstream').not.toMatch(/"who"/);
  });
  it('any value is refused, not only "script" (presence match)', () => {
    for (const v of ['x', 'Script', '']) {
      const r = get(`app.${DOMAIN}`, '/sign-in', ['-H', v ? `Service-Worker: ${v}` : 'Service-Worker;']); // curl sends `Service-Worker;` as an empty value
      expect(r.status, JSON.stringify(v)).toBe(403); // red: a `header Service-Worker script` value match
    }
  });
  it('the lowercase header name is refused too, on a web path and an /api/auth path', () => {
    for (const p of ['/sign-in', '/api/auth/session']) {
      const r = get(`app.${DOMAIN}`, p, ['-H', 'service-worker: script']);
      expect(r.status, p).toBe(403);
      expectSecurity(r.h);
    }
  });
  it('without the header the same paths proxy (the refusal is not a blanket 403)', () => {
    for (const [host, auth] of SITES) for (const [p, who] of PATHS) {
      const r = get(host, p, auth);
      expect(r.status, `${host}${p}`).toBe(200);
      expect(echo(r.body).who).toBe(who);
    }
    expect(get(`staging.${DOMAIN}`, '/sign-in').status, 'staging without credentials still asks for them').toBe(401);
  });
});

describe('R3: no token reaches the Caddy logs', () => {
  const m = () => randomBytes(8).toString('hex');
  const uris = (t: string) => [`/sign-up?invitation=${t}`, `/api/auth/reset-password/${t}?callbackURL=${t}`, `/api/auth/magic-link/verify?token=${t}`, `/api/auth/callback/google?code=${t}&state=${t}`];
  const logs = () => { const r = sh('docker', ['logs', CADDY]); return r.out + '\n' + r.err; };
  const hit = (t: string, extra: string[] = []) => uris(t).forEach((u) => get(`app.${DOMAIN}`, u, [...extra, '-H', `Referer: https://app.${DOMAIN}/x?r=${t}`, '-H', `Authorization: Bearer ${t}`, '-H', `Cookie: s=${t}`]));

  it('a stopped upstream (dial failure, the 502 Caddy logs by default): no marker; the filtered paths are logged', { timeout: 240_000 }, () => {
    const t = m();
    sh('docker', ['stop', WEB, AUTH]);
    try { hit(t); } finally { sh('docker', ['start', WEB, AUTH]); sh('sleep', ['2']); }
    const l = logs();
    expect(l.includes(t), 'the marker appears in docker logs').toBe(false); // red: the full URI, Referer or a credential is logged
    for (const p of ['/sign-up', '/api/auth/reset-password', '/api/auth/magic-link', '/api/auth/callback']) {
      expect(l, `the filtered path ${p} is logged, so a silent log cannot pass`).toMatch(new RegExp(`"uri":"${p.replace(/\//g, '\\/')}"`)); // red: no log line, or the path is cut short or kept whole
    }
  });
  it('an upstream that accepts and closes: no marker (Caddy may log nothing at the default level, which also passes)', { timeout: 240_000 }, () => {
    const t = m();
    const closing = (u: string) => u.replace(/^(\/[^?]*?)(\?|$)/, `$1/closeme$2`);
    for (const u of uris(t)) get(`app.${DOMAIN}`, closing(u), ['-H', `Referer: https://app.${DOMAIN}/x?r=${t}`, '-H', `Cookie: s=${t}`]);
    expect(logs().includes(t)).toBe(false); // red: a Caddy that starts logging this 502 unfiltered
  });
  it('a request that succeeds leaves no marker either', () => {
    const t = m();
    hit(t);
    expect(logs().includes(t)).toBe(false);
  });
});
