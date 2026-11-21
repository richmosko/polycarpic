// POLY-138 R5 (ruling d5ead294): fail fixtures for the edge rules in infra/lint/compose-policy.mjs: edge-network (two new
// fixtures), edge-alias, caddy-upstream, caddy-xff, caddy-sw, caddy-log. Each is the pass baseline (baseline.ts: the ruled
// target Caddyfile, `<kind>-web` and `<kind>-auth` aliases) plus ONE mutation; the assertion is the exact rule id in
// stderr and a non-zero exit. Every rule also has a positive case: the baseline, and mutations that must stay clean.
// The caddy-cache rule (R10) is not here: it waits for decision D3.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baseline, materialise, PG_IMAGE_ENV, type FxSet } from './baseline.ts';

const LINT = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra', 'lint', 'compose-policy.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function lint(root: string): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const c = spawn('node', [LINT, '--root', root], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_POSTGRES_IMAGE: PG_IMAGE_ENV, POLY_BIND_ADDR: '192.168.1.20' } });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err }));
  });
}
async function run(mut: (s: FxSet) => void) {
  const s = baseline();
  mut(s);
  const root = mkdtempSync(join(tmpdir(), 'poly138-lint-'));
  made.push(root);
  materialise(root, s);
  return lint(root);
}
const CF = 'infra/caddy/Caddyfile';
const cf = (s: FxSet, f: (t: string) => string) => {
  const before = s.text[CF]!;
  s.text[CF] = f(before);
  if (s.text[CF] === before) throw new Error('fixture mutation did not change the Caddyfile (a typo in the test, not a red)');
};
const rep = (from: string | RegExp, to: string) => (s: FxSet) => cf(s, (t) => t.replace(from, to));
const svc = (s: FxSet, p: 'prod' | 'staging' | 'edge', n: string) => s[p].services[n];

const SW = '\t\t@sw header Service-Worker *\n\t\trespond @sw 403\n';
const APP_AUTH = '\t\t@auth path /api/auth /api/auth/*\n\t\treverse_proxy @auth prod-auth:3000 {\n\t\t\timport upstream\n\t\t}\n';

type Row = [string, (s: FxSet) => void, string, string];
const ROWS: Row[] = [
  // edge-network: the rule exists today, so these are green now; the mutation that turns them red is removing the check
  ['edge-network: a staging service named prod-web on edge-staging', (s) => { s.staging.services['prod-web'] = { ...svc(s, 'staging', 'worker'), networks: ['default', 'edge-staging'] }; }, 'edge-network', 'the web/auth-only membership check removed'],
  ['edge-network: a second service in edge.yml', (s) => { s.edge.services.sidecar = { ...svc(s, 'edge', 'caddy'), ports: undefined, secrets: undefined }; }, 'edge-network', 'the "unexpected service in the edge project" check removed'],

  // edge-alias
  ['edge-alias: staging web answers to prod-web', (s) => { svc(s, 'staging', 'web').networks['edge-staging'] = { aliases: ['prod-web'] }; }, 'edge-alias', 'rule absent'],
  ['edge-alias: prod auth answers to staging-auth', (s) => { svc(s, 'prod', 'auth').networks['edge-prod'] = { aliases: ['staging-auth'] }; }, 'edge-alias', 'rule absent'],
  ['edge-alias: a second alias beside the ruled one', (s) => { svc(s, 'prod', 'web').networks['edge-prod'] = { aliases: ['prod-web', 'web'] }; }, 'edge-alias', 'aliases not compared for equality'],
  ['edge-alias: no alias on the edge network', (s) => { svc(s, 'prod', 'web').networks['edge-prod'] = {}; }, 'edge-alias', 'a missing alias accepted'],
  ['edge-alias: web aliased as auth (right project, wrong service)', (s) => { svc(s, 'prod', 'web').networks['edge-prod'] = { aliases: ['prod-auth'] }; }, 'edge-alias', 'only the project prefix compared'],
  ['edge-alias: container_name on an edge service', (s) => { svc(s, 'prod', 'web').container_name = 'prod-auth'; }, 'edge-alias', 'container_name (a name on every network) not refused'],
  ['edge-alias: links on an edge service', (s) => { svc(s, 'staging', 'auth').links = ['postgres:prod-web']; }, 'edge-alias', 'links not refused'],
  ['edge-alias: external_links on an edge service', (s) => { svc(s, 'staging', 'web').external_links = ['x:prod-web']; }, 'edge-alias', 'external_links not refused'],

  // caddy-upstream
  ['caddy-upstream: app. proxies web to a staging name', rep('reverse_proxy prod-web:3000', 'reverse_proxy staging-web:3000'), 'caddy-upstream', 'site/kind prefix not compared'],
  ['caddy-upstream: app. proxies /api/auth to staging-auth', rep('prod-auth:3000', 'staging-auth:3000'), 'caddy-upstream', 'site/kind prefix not compared'],
  ['caddy-upstream: staging. proxies web to a prod name', rep('staging-web:3000', 'prod-web:3000'), 'caddy-upstream', 'site/kind prefix not compared'],
  ['caddy-upstream: an upstream on another port', rep('prod-web:3000', 'prod-web:3001'), 'caddy-upstream', 'port not compared'],
  ['caddy-upstream: an upstream outside the four names', rep('prod-auth:3000', 'postgres:5432'), 'caddy-upstream', 'allowlist not applied'],
  ['caddy-upstream: the http:// redirect block proxies', rep('\tredir https://{host}{uri} permanent\n', '\treverse_proxy prod-web:3000 {\n\t\timport upstream\n\t}\n'), 'caddy-upstream', 'http block not scanned'],

  // caddy-xff
  ['caddy-xff: (upstream) lacks header_up -Forwarded', rep('\theader_up -Forwarded\n', ''), 'caddy-xff', 'snippet content not compared'],
  ['caddy-xff: (upstream) lacks header_up -X-Real-IP', rep('\theader_up -X-Real-IP\n', ''), 'caddy-xff', 'snippet content not compared'],
  ['caddy-xff: (upstream) appends instead of setting', rep('header_up X-Forwarded-For {remote_host}', 'header_up X-Forwarded-For "{http.request.header.X-Forwarded-For}, {remote_host}"'), 'caddy-xff', 'value not compared'],
  ['caddy-xff: (upstream) lacks lb_try_duration', rep('\tlb_try_duration 10s\n', ''), 'caddy-xff', 'R4 line not required'],
  ['caddy-xff: (upstream) carries an extra line', rep('\tlb_try_duration 10s\n', '\tlb_try_duration 10s\n\theader_up X-Real-IP {remote_host}\n'), 'caddy-xff', 'snippet must be exactly the four lines'],
  ['caddy-xff: a reverse_proxy without the import', rep('reverse_proxy prod-web:3000 {\n\t\t\timport upstream\n\t\t}', 'reverse_proxy prod-web:3000'), 'caddy-xff', 'per-proxy import not checked'],
  ['caddy-xff: the import is not the line after reverse_proxy', rep('reverse_proxy staging-web:3000 {\n\t\t\timport upstream', 'reverse_proxy staging-web:3000 {\n\t\t\tflush_interval -1\n\t\t\timport upstream'), 'caddy-xff', 'import position not checked'],
  ['caddy-xff: the (upstream) snippet is missing', (s) => cf(s, (t) => t.replace(/\(upstream\) \{[\s\S]*?\n\}\n\n/, '').replaceAll('\t\t\timport upstream\n', '\t\t\tlb_try_duration 10s\n')), 'caddy-xff', 'snippet absence not reported'],

  // caddy-sw
  ['caddy-sw: app. has no @sw matcher', rep(SW + APP_AUTH, APP_AUTH), 'caddy-sw', 'app. site not scanned'],
  ['caddy-sw: matches the value script, not presence', rep('@sw header Service-Worker *', '@sw header Service-Worker script'), 'caddy-sw', 'value match accepted'],
  ['caddy-sw: the matcher without its respond', rep('\t\trespond @sw 403\n\t\t@auth', '\t\t@auth'), 'caddy-sw', 'respond not required'],
  ['caddy-sw: answers 401, not 403', rep('respond @sw 403', 'respond @sw 401'), 'caddy-sw', 'status not compared'],
  ['caddy-sw: staging. refusal sits after basic_auth', (s) => cf(s, (t) => t.replace(SW + '\t\tbasic_auth', '\t\tbasic_auth').replace('\t\t@auth path /api/auth /api/auth/*\n\t\treverse_proxy @auth staging-auth', SW + '\t\t@auth path /api/auth /api/auth/*\n\t\treverse_proxy @auth staging-auth')), 'caddy-sw', 'order against basic_auth not checked'],
  ['caddy-sw: app. refusal sits after the first reverse_proxy', rep(SW + APP_AUTH, APP_AUTH + SW), 'caddy-sw', 'order against reverse_proxy not checked'],
  ['caddy-sw: the refusal is outside the route block', (s) => cf(s, (t) => t.replace(SW + APP_AUTH, APP_AUTH).replace('\troute {\n\t\t@auth path', '\t@sw header Service-Worker *\n\trespond @sw 403\n\troute {\n\t\t@auth path')), 'caddy-sw', 'route membership not checked'],

  // caddy-log
  ['caddy-log: no global log block', (s) => cf(s, (t) => t.replace(/\tlog \{[\s\S]*?\n\t\}\n\}/, '}')), 'caddy-log', 'global log not required'],
  ['caddy-log: the Referer filter line is missing', rep('\t\t\trequest>headers>Referer delete\n', ''), 'caddy-log', 'filter lines not compared'],
  ['caddy-log: the uri filter does not strip the query', rep('"^(/api/auth/[^/?#]*)[^?#]*|[?#].*"', '"^(/[^?#]*).*"'), 'caddy-log', 'regexp not compared'],
  ['caddy-log: the global debug option', rep('\tadmin off\n', '\tadmin off\n\tdebug\n'), 'caddy-log', 'debug accepted'],
  ['caddy-log: log_credentials in the global block', rep('\t\toutput stderr\n', '\t\toutput stderr\n\t\tlog_credentials\n'), 'caddy-log', 'log_credentials accepted'],
  ['caddy-log: a site-level log directive', rep('app.{$POLY_DOMAIN} {\n\ttls {$POLY_TLS}\n', 'app.{$POLY_DOMAIN} {\n\ttls {$POLY_TLS}\n\tlog\n'), 'caddy-log', 'site log (which bypasses the filter) accepted'],
  ['caddy-log: a site-level log block with its own output', rep('staging.{$POLY_DOMAIN} {\n\ttls {$POLY_TLS}\n', 'staging.{$POLY_DOMAIN} {\n\ttls {$POLY_TLS}\n\tlog {\n\t\toutput stdout\n\t}\n'), 'caddy-log', 'site log accepted'],

  // caddy-cache (R10, decision D3 taken)
  ['caddy-cache: the (no_store) snippet is missing', (s) => cf(s, (t) => t.replace(/\(no_store\) \{[\s\S]*?\n\}\n\n/, '').replaceAll('\timport no_store\n', '')), 'caddy-cache', 'snippet absence not reported'],
  ['caddy-cache: app. does not import no_store', rep('\ttls {$POLY_TLS}\n\timport security_headers\n\timport no_store\n', '\ttls {$POLY_TLS}\n\timport security_headers\n'), 'caddy-cache', 'app. import not checked'],
  ['caddy-cache: staging. does not import no_store', rep(/(staging\.\{\$POLY_DOMAIN\} \{\n\ttls \{\$POLY_TLS\}\n\timport security_headers\n)\timport no_store\n/, '$1'), 'caddy-cache', 'staging. import not checked'],
  ['caddy-cache: no_store imported inside handle_errors', rep('\thandle_errors {\n\t\timport security_headers\n\t}\n\troute {\n\t\t@sw header Service-Worker *\n\t\trespond @sw 403\n\t\t@auth', '\thandle_errors {\n\t\timport security_headers\n\t\timport no_store\n\t}\n\troute {\n\t\t@sw header Service-Worker *\n\t\trespond @sw 403\n\t\t@auth'), 'caddy-cache', 'the matcher would be defined twice (M14)'],
  ['caddy-cache: no_store imported in the http:// redirect block', rep('\timport security_headers\n\tredir', '\timport security_headers\n\timport no_store\n\tredir'), 'caddy-cache', 'http block not scanned'],
  ['caddy-cache: the override value is max-age, not no-store', rep('Cache-Control "no-store"', 'Cache-Control "max-age=60"'), 'caddy-cache', 'value not compared'],
  ['caddy-cache: the override is not deferred (the upstream header would win)', rep('\t\tdefer\n\t\tCache-Control', '\t\tCache-Control'), 'caddy-cache', 'defer not required'],
  ['caddy-cache: the matcher spares nothing (every path no-store)', rep('@mutable not path /_app/immutable/*', '@mutable path *'), 'caddy-cache', 'immutable exemption not compared'],
  ['caddy-cache: the matcher spares more than /_app/immutable/*', rep('@mutable not path /_app/immutable/*', '@mutable not path /_app/*'), 'caddy-cache', 'exemption width not compared'],
  ['caddy-cache: the header is not bound to the matcher', rep('header @mutable {', 'header {'), 'caddy-cache', 'matcher binding not checked'],
];

describe.concurrent('compose-policy lint: POLY-138 edge fail fixtures (pass baseline + one mutation each)', () => {
  it.each(ROWS)('%s -> rule fires', async (name, mut, id) => {
    const r = await run(mut);
    expect(r.code, `${name}: ${r.err}`).not.toBe(0);
    expect(r.err).toMatch(new RegExp(`\\[${id}\\]`));
  });
});

// Positive cases: each guard has a passing counterpart, so a rule that refuses everything fails here.
const PASS: [string, (s: FxSet) => void][] = [
  ['the baseline: target Caddyfile, <kind>-web and <kind>-auth aliases, only caddy in edge.yml', () => {}],
  ['comments and blank lines around the (upstream) snippet', rep('(upstream) {\n', '# the one place the client address is set\n\n(upstream) {\n')],
  ['a comment between the refusal and basic_auth', rep(SW + '\t\tbasic_auth', SW + '\t\t# the refusal precedes basic_auth\n\t\tbasic_auth')],
];
describe.concurrent('compose-policy lint: POLY-138 edge positive cases', () => {
  it.each(PASS)('%s is clean', async (name, mut) => {
    const r = await run(mut);
    expect({ name, code: r.code, err: r.err }).toEqual({ name, code: 0, err: '' });
  });
});
