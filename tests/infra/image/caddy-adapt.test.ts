// POLY-95 verdict C1: the Caddyfile must parse with exactly the environment edge.yml renders for caddy. `caddy adapt`
// can log an error line and still exit 0, so both the exit code and the output are checked.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sh } from './stack.ts';

describe('Caddyfile parses with the environment edge.yml passes to caddy (C1)', () => {
  it('caddy adapt exits 0 and prints no error line', () => {
    const img = 'poly95-caddy-adapt:test';
    const b = sh('docker', ['build', '-t', img, join(ROOT, 'infra', 'caddy')]);
    expect(b.code, b.err.slice(-400)).toBe(0);
    const env = { POLY_BIND_ADDR: '192.0.2.1', POLY_DOMAIN: 'poly.example', POLY_STAGING_ALLOW: '192.0.2.0/24', POLY_TLS: 'ops@poly.example' };
    const cfg = sh('docker', ['compose', '-f', join(ROOT, 'infra', 'compose', 'edge.yml'), 'config', '--format', 'json'], { env });
    expect(cfg.code, cfg.err).toBe(0);
    const rendered = JSON.parse(cfg.out).services.caddy.environment as Record<string, string>;
    const args = Object.entries(rendered).flatMap(([k, val]) => ['-e', `${k}=${val}`]);
    const r = sh('docker', ['run', '--rm', ...args, img, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile']);
    expect(r.code, r.err).toBe(0);
    expect(r.out + r.err).not.toMatch(/"level":"error"/); // red: a directive with a missing or empty value
  });
});
