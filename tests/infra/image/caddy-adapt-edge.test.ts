// POLY-138 R1, R3, R4 (ruling d5ead294): the adapted JSON, as M11 measured it. Every reverse_proxy handler on both sites sets
// X-Forwarded-For to the peer, deletes X-Real-IP and Forwarded, and retries for 10 s; the default logger carries the R3
// filter; no site writes its own log; no debug; no log_credentials; no trusted_proxies.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT, sh } from './stack.ts';

let text = '';
let json: any;
beforeAll(() => {
  const img = 'poly138-caddy-adapt:test';
  const b = sh('docker', ['build', '-t', img, join(ROOT, 'infra', 'caddy')]);
  if (b.code !== 0) throw new Error(`docker build infra/caddy failed: ${b.err.slice(-400)}`);
  const env = { POLY_CADDY_IMAGE: 'ghcr.io/richmosko/polycarpic-caddy@sha256:' + '3'.repeat(64), POLY_BIND_ADDR: '192.0.2.1', POLY_DOMAIN: 'poly.example', POLY_STAGING_ALLOW: '192.0.2.0/24', POLY_TLS: 'ops@poly.example' };
  const cfg = sh('docker', ['compose', '-f', join(ROOT, 'infra', 'compose', 'edge.yml'), 'config', '--no-env-resolution', '--format', 'json'], { env });
  const rendered = JSON.parse(cfg.out).services.caddy.environment as Record<string, string>;
  const args = Object.entries(rendered).flatMap(([k, val]) => ['-e', `${k}=${val}`]);
  const r = sh('docker', ['run', '--rm', ...args, img, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile']);
  if (r.code !== 0) throw new Error(`caddy adapt failed: ${r.err}`);
  text = r.out;
  json = JSON.parse(r.out);
});

const proxies = (node: unknown, out: any[] = []): any[] => {
  if (Array.isArray(node)) node.forEach((n) => proxies(n, out));
  else if (node && typeof node === 'object') {
    if ((node as any).handler === 'reverse_proxy') out.push(node);
    Object.values(node).forEach((n) => proxies(n, out));
  }
  return out;
};

describe('Caddyfile adapts to the ruled edge shape (R1, R3, R4)', () => {
  it('all four reverse_proxy handlers set X-Forwarded-For to the peer and delete X-Real-IP and Forwarded', () => {
    const p = proxies(json.apps.http.servers);
    expect(p).toHaveLength(4); // red: a proxy added or dropped without a ruling
    for (const h of p) {
      expect(h.headers?.request?.set?.['X-Forwarded-For']).toEqual(['{http.request.remote.host}']);
      expect(h.headers?.request?.delete).toEqual(['X-Real-IP', 'Forwarded']); // red: no `import upstream`, or a line dropped
    }
  });
  it('all four retry an upstream for 10 s (R4: ARCH 8.1 and INFRA 4.6 say so)', () => {
    for (const h of proxies(json.apps.http.servers)) expect(h.load_balancing?.try_duration).toBe(10_000_000_000); // red: no lb_try_duration
  });
  it('no trusted_proxies, no log_credentials, no debug level anywhere', () => {
    expect(text).not.toMatch(/trusted_proxies/);
    expect(text).not.toMatch(/log_credentials/);
    const lvl = json.logging?.logs?.default?.level;
    expect(lvl === undefined || !/debug/i.test(lvl)).toBe(true); // red: global `debug`
  });
  it('the default logger carries the R3 filter: query/fragment and /api/auth path tokens stripped, Referer deleted', () => {
    const enc = json.logging?.logs?.default?.encoder;
    expect(enc?.format, 'a filter encoder on the default logger').toBe('filter'); // red: no global log block
    expect(enc.fields['request>uri']).toMatchObject({ filter: 'regexp', regexp: '^(/api/auth/[^/?#]*)[^?#]*|[?#].*', value: '${1}' });
    expect(enc.fields['request>headers>Referer']).toMatchObject({ filter: 'delete' });
  });
  it('no site writes its own access log (a site logger bypasses the default filter)', () => {
    for (const s of Object.values<any>(json.apps.http.servers)) expect(s.logs, 'server logs').toBeUndefined(); // red: a site `log` directive
  });
});
