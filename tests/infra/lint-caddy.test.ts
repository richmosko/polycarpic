// POLY-100 T-caddy (A12, S20): `caddy-allow` treats infra/caddy/Caddyfile as an allowlist, ordered. It passes the real file and refuses the edits below.
// Each case is the baseline (which carries the real Caddyfile) plus ONE edit; the mutants of the lint itself are in red-run.md.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, materialise, PG_IMAGE_ENV, type FxSet } from './baseline.ts';

const LINT = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra', 'lint', 'compose-policy.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function run(mut: (s: FxSet) => void) {
  const s = baseline();
  mut(s);
  const root = mkdtempSync(join(tmpdir(), 'poly100-caddy-'));
  made.push(root);
  materialise(root, s);
  const r = spawnSync('node', [LINT, '--root', root], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' } });
  return { code: r.status, err: r.stderr ?? '' };
}
const caddy = (f: (t: string) => string) => (s: FxSet) => { s.text['infra/caddy/Caddyfile'] = f(s.text['infra/caddy/Caddyfile']!); };
const swap = (a: string, b: string) => caddy((t) => { if (!t.includes(a)) throw new Error('fixture text not found: ' + a); return t.replace(a, b); });

const CASES: [string, (s: FxSet) => void][] = [
  ['forward_auth in a site', swap('\ttls {$POLY_TLS}\n\timport security_headers\n\timport no_store\n\thandle_errors {', '\ttls {$POLY_TLS}\n\tforward_auth prod-auth:3000\n\timport security_headers\n\timport no_store\n\thandle_errors {')],
  ['a second global log', swap('\tadmin off\n', '\tadmin off\n\tlog {\n\t\toutput stderr\n\t}\n')],
  ['php_fastcgi on one line with its block', swap('\t\trespond @sw 403\n\t\t@auth path /api/auth /api/auth/*\n\t\treverse_proxy @auth prod-auth:3000 {', '\t\trespond @sw 403\n\t\tphp_fastcgi x:9000 { root /x }\n\t\t@auth path /api/auth /api/auth/*\n\t\treverse_proxy @auth prod-auth:3000 {')],
  ['import other', swap('\timport no_store\n\thandle_errors {', '\timport no_store\n\timport other\n\thandle_errors {')],
  ['an extra site block', caddy((t) => t + '\nevil.{$POLY_DOMAIN} {\n\trespond 200\n}\n')],
  ['a repeated allowed line', swap('\t\trespond @sw 403\n\t\tbasic_auth {', '\t\trespond @sw 403\n\t\trespond @sw 403\n\t\tbasic_auth {')],
  ['@denied moved below basic_auth', swap('\t\t@denied not remote_ip {$POLY_STAGING_ALLOW}\n\t\trespond @denied 403\n\t\t@sw header Service-Worker *\n\t\trespond @sw 403\n\t\tbasic_auth {\n\t\t\timport /run/secrets/staging_basic_auth\n\t\t}\n',
    '\t\t@sw header Service-Worker *\n\t\trespond @sw 403\n\t\tbasic_auth {\n\t\t\timport /run/secrets/staging_basic_auth\n\t\t}\n\t\t@denied not remote_ip {$POLY_STAGING_ALLOW}\n\t\trespond @denied 403\n')],
  ['a directive naming a different upstream', swap('reverse_proxy prod-web:3000 {', 'reverse_proxy evil:3000 {')],
  ['a header_up removed from the upstream snippet (order and count)', swap('\theader_up -X-Real-IP\n', '')],
  ['an unlisted global option', swap('\tadmin off\n', '\tadmin off\n\tservers {\n\t\ttrusted_proxies static 0.0.0.0/0\n\t}\n')],
];

describe('T-caddy: the Caddyfile is an allowlist', () => {
  it('passes the real file', () => expect(run(() => {})).toEqual({ code: 0, err: '' }));
  it.each(CASES)('refused: %s', (_n, mut) => {
    const r = run(mut);
    expect(r.code, r.err).not.toBe(0);
    expect(r.err).toMatch(/\[caddy-allow\]/);
  });
  it('refused: a command on caddy (compose level)', () => {
    const r = run((s) => { s.edge.services.caddy.command = ['caddy', 'run', '--config', '/x']; });
    expect(r.code, r.err).not.toBe(0);
  });
});
