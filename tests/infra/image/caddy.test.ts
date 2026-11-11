// POLY-95 R1 [S#9]: the Caddy derivative (infra/caddy/Dockerfile + Caddyfile) puts HSTS, nosniff and Referrer-Policy on
// EVERY response class, with the exact values, even when the upstream sets a conflicting Referrer-Policy and no HSTS;
// the upstream's CSP passes through; the :80 redirect carries nosniff. Runs in the `image` job.
//
// CONTRACT pinned here (the ruling names the file, not the hooks):
//  - Caddy listens on 8080/8443 inside the container (ruling R1 [S2]); the test publishes those.
//  - build context infra/caddy/ -> the Caddy image; it runs the Caddyfile at /etc/caddy/Caddyfile (copied in or mounted).
//  - env the Caddyfile reads: POLY_DOMAIN (sites app.$POLY_DOMAIN, staging.$POLY_DOMAIN), POLY_STAGING_ALLOW
//    (space-separated remote_ip ranges for staging), and the TLS mode: the test sets POLY_TLS=internal; the Caddyfile
//    must put `tls {$POLY_TLS}` (empty = automatic) in each site block so CI can use Caddy's internal CA.
//  - upstreams: prod web = `prod-web:3000`, staging web = `staging-web:3000` (network aliases on the edge networks).
//  - staging basic auth: file /run/secrets/staging_basic_auth holds one line `<user> <bcrypt hash>`.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, sh } from './stack.ts';

const IMG = 'poly95-caddy:test';
const tag = randomBytes(3).toString('hex');
const NET = `poly95net${tag}`;
const STUB = `poly95stub${tag}`;
const CADDY = `poly95caddy${tag}`;
const DOMAIN = 'poly.test';
const PORT = 18443 + Math.floor(Math.random() * 500);
const WANT = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
let dir = '';

const curl = (host: string, path: string, extra: string[] = []) => {
  const r = sh('curl', ['-ksS', '-D', '-', '-o', '/dev/null', '--max-time', '20', '--resolve', `${host}:${PORT}:127.0.0.1`, ...extra, `https://${host}:${PORT}${path}`]);
  const lines = r.out.split(/\r?\n/);
  const status = Number(/^HTTP\/\S+ (\d+)/.exec(lines[0] ?? '')?.[1] ?? 0);
  const h: Record<string, string[]> = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) (h[l.slice(0, i).toLowerCase()] ??= []).push(l.slice(i + 1).trim()); }
  return { status, h, err: r.err };
};
const startCaddy = (allow: string) => {
  sh('docker', ['rm', '-f', CADDY]);
  const r = sh('docker', ['run', '-d', '--name', CADDY, '--network', NET, '-p', `127.0.0.1:${PORT}:8443`, '-p', `127.0.0.1:${PORT + 1000}:8080`,
    '-e', `POLY_DOMAIN=${DOMAIN}`, '-e', 'POLY_TLS=internal', '-e', `POLY_STAGING_ALLOW=${allow}`,
    '-v', `${dir}/staging_basic_auth:/run/secrets/staging_basic_auth:ro`, IMG]);
  if (r.code !== 0) throw new Error(r.err);
  for (let i = 0; i < 40; i++) { if (curl(`app.${DOMAIN}`, '/').status) return; sh('sleep', ['1']); }
  throw new Error('caddy did not answer: ' + sh('docker', ['logs', CADDY]).err.slice(-600));
};

beforeAll(() => {
  const b = sh('docker', ['build', '-t', IMG, join(ROOT, 'infra', 'caddy')]);
  if (b.code !== 0) throw new Error(`docker build infra/caddy failed: ${b.err.slice(-500)}`);
  dir = mkdtempSync(join(tmpdir(), 'poly95-caddy-'));
  mkdirSync(dir, { recursive: true });
  const hash = sh('docker', ['run', '--rm', IMG, 'caddy', 'hash-password', '--plaintext', 'pw']).out;
  writeFileSync(join(dir, 'staging_basic_auth'), `qa ${hash}\n`, { mode: 0o644 });
  writeFileSync(join(dir, 'Stub'), `{\n\tauto_https off\n}\n:3000 {\n\theader Referrer-Policy "no-referrer"\n\theader Content-Security-Policy "default-src 'none'"\n\t@missing path /missing\n\trespond @missing 404\n\t@nocsp path /nocsp\n\theader @nocsp -Content-Security-Policy\n\trespond @nocsp "nocsp" 200\n\trespond "ok" 200\n}\n`);
  sh('docker', ['network', 'create', NET]);
  const s = sh('docker', ['run', '-d', '--name', STUB, '--network', NET, '--network-alias', 'prod-web', '--network-alias', 'staging-web',
    '-v', `${dir}/Stub:/etc/caddy/Caddyfile:ro`, IMG]);
  if (s.code !== 0) throw new Error(s.err);
  startCaddy('0.0.0.0/0 ::/0');
});
afterAll(() => { sh('docker', ['rm', '-f', CADDY, STUB]); sh('docker', ['network', 'rm', NET]); });

const expectHeaders = (h: Record<string, string[]>) => {
  for (const [k, v] of Object.entries(WANT)) expect(h[k], k).toEqual([v]); // exactly one header, exact value
};

describe('Caddy security headers on every response class (R1)', () => {
  it('proxied 200: all three exact; the stub\'s conflicting Referrer-Policy is replaced, its CSP passes through unchanged', () => {
    const r = curl(`app.${DOMAIN}`, '/');
    expect(r.status).toBe(200);
    expectHeaders(r.h); // red: snippet missing, or no `defer` so the upstream's no-referrer wins / duplicates
    expect(r.h['content-security-policy']).toEqual(["default-src 'none'"]); // red: Caddy strips or rewrites the CSP
  });
  it('no CSP is added when the upstream sends none', () => {
    const r = curl(`app.${DOMAIN}`, '/nocsp');
    expect(r.status).toBe(200);
    expectHeaders(r.h);
    expect(r.h['content-security-policy']).toBeUndefined(); // red: Caddy injects a CSP (it is Kit's)
  });
  it('caddy adapt: no trusted_proxies anywhere, admin disabled or loopback-only', () => {
    const r = sh('docker', ['run', '--rm', '-e', `POLY_DOMAIN=${DOMAIN}`, '-e', 'POLY_TLS=internal', '-e', 'POLY_STAGING_ALLOW=0.0.0.0/0', IMG, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toMatch(/trusted_proxies/); // red: edge trusts forwarded headers it should not
    const adm = JSON.parse(r.out).admin as { disabled?: boolean; listen?: string } | undefined;
    expect(adm === undefined || adm.disabled === true || /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(adm.listen ?? '')).toBe(true); // red: admin API on 0.0.0.0
  });
  it('upstream 404 carries them too', () => {
    const r = curl(`app.${DOMAIN}`, '/missing');
    expect(r.status).toBe(404);
    expectHeaders(r.h); // red: headers applied only on 2xx
  });
  it('staging 401 (no credentials) carries them', () => {
    const r = curl(`staging.${DOMAIN}`, '/');
    expect(r.status).toBe(401);
    expectHeaders(r.h); // red: snippet not imported in the staging block, or applied after basic_auth only
  });
  it('staging with the right credentials proxies (200) with the headers', () => {
    const r = curl(`staging.${DOMAIN}`, '/', ['-u', 'qa:pw']);
    expect(r.status).toBe(200);
    expectHeaders(r.h);
  });
  it('a request from outside the staging remote_ip allowlist is refused (403), headers still present', () => {
    startCaddy('192.0.2.0/24');
    const r = curl(`staging.${DOMAIN}`, '/', ['-u', 'qa:pw']);
    expect(r.status).toBe(403); // red: allowlist not applied (the 401/200 above would then also be reachable from anywhere)
    expectHeaders(r.h);
    startCaddy('0.0.0.0/0 ::/0');
  });
  it('outside the allowlist, no credentials and wrong credentials both get 403 (no password-guessing oracle, SC3), headers present', () => {
    startCaddy('192.0.2.0/24');
    try {
      for (const extra of [[], ['-u', 'qa:wrong'], ['-u', 'qa:pw']]) {
        const r = curl(`staging.${DOMAIN}`, '/', extra);
        expect(r.status, extra.join(' ')).toBe(403); // red: basic_auth runs before the allowlist (401 for wrong, 403 for right)
        expectHeaders(r.h);
      }
    } finally { startCaddy('0.0.0.0/0 ::/0'); }
  });
  it('Caddy-generated 502 (upstream stopped) carries them', () => {
    sh('docker', ['stop', STUB]);
    try {
      const r = curl(`app.${DOMAIN}`, '/');
      expect(r.status).toBe(502);
      expectHeaders(r.h); // red: error responses bypass the header directive
    } finally { sh('docker', ['start', STUB]); }
  });
  it('port 80 only redirects to 443 and carries nosniff (HSTS exempt over http)', () => {
    const r = sh('curl', ['-sS', '-D', '-', '-o', '/dev/null', '--max-time', '20', '--resolve', `app.${DOMAIN}:${PORT + 1000}:127.0.0.1`, `http://app.${DOMAIN}:${PORT + 1000}/x`]);
    expect(r.out).toMatch(/^HTTP\/\S+ 30[1278]/);
    expect(r.out.toLowerCase()).toMatch(/location: https:\/\//);
    expect(r.out.toLowerCase()).toMatch(/x-content-type-options: nosniff/); // red: redirect site outside the snippet
  });
});
