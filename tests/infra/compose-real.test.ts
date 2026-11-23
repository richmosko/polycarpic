// POLY-100 R5 on REAL renders: the box guard's judgement of what `docker compose config` actually emits for the shipped files and for S10/S14's unsafe
// edits of them. The unit tests (tests/infra/ops/test_deploy_guard.py) use committed fixtures; this file shows the fixtures equal real output and that
// the guard, run on real output, refuses the same things. Needs the compose CLI, no daemon (the lint job has it).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const FX = join(ROOT, 'tests', 'infra', 'ops', 'fixtures');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'poly100-real-')); made.push(d); return d; };
const py = (args: string[]) => spawnSync('python3', ['-I', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });

/** Real renders of a copy of infra/compose with one edit applied to staging.yml; -> the guard's verdict for the staging project. */
function judge(edit: (y: any, dir: string) => void): string {
  const d = tmp();
  cpSync(join(ROOT, 'infra', 'compose'), join(d, 'compose'), { recursive: true });
  const f = join(d, 'compose', 'staging.yml');
  const y = parse(readFileSync(f, 'utf8'));
  edit(y, join(d, 'compose'));
  writeFileSync(f, stringify(y));
  const g = py([join(FX, 'gen_compose.py'), '--from', join(d, 'compose'), '--out', join(d, 'out'), '--only', 'staging']);
  if (g.status !== 0) return 'RENDER-FAILED ' + g.stderr;
  const v = py([join(FX, 'guard_real.py'), 'staging', join(d, 'out', 'staging.raw.json'), join(d, 'out', 'staging.plain.json')]);
  return (v.stdout || v.stderr).trim();
}

describe('guard on real compose renders (POLY-100 R5, S10, S14)', () => {
  it('the committed render fixtures equal real `docker compose config` output for the shipped files', () => {
    const d = tmp();
    const g = py([join(FX, 'gen_compose.py'), '--out', d]);
    expect(g.status, g.stderr).toBe(0);
    const names = readdirSync(join(FX, 'compose')).sort();
    expect(readdirSync(d).sort()).toEqual(names);
    for (const n of names) expect(readFileSync(join(d, n), 'utf8'), n).toBe(readFileSync(join(FX, 'compose', n), 'utf8'));
  });

  it('the shipped staging.yml passes the installed policy', () => expect(judge(() => {})).toBe('PASS'));

  const web = (y: any) => y.services.web;
  const CASES: [string, (y: any, dir: string) => void, string[]][] = [
    ['privileged: true', (y) => { web(y).privileged = true; }, ['guard-key']],
    ['network_mode: container:polycarpic-prod-web-1 (S10)', (y) => { web(y).network_mode = 'container:polycarpic-prod-web-1'; }, ['guard-key', 'RENDER']], // real compose may refuse to render it at all: either way the box refuses (guard-render)
    ['a staging env_file of the prod host env (S10: only the raw render keeps env_file)', (y) => { web(y).env_file = ['/etc/polycarpic/host.env']; }, ['guard-env']],
    ['user: "0"', (y) => { web(y).user = '0'; }, ['guard-pinned']],
    ['cap_drop removed', (y) => { web(y).cap_drop = []; }, ['guard-pinned']],
    ['a bind of / on postgres', (y) => { y.services.postgres.volumes = [...(y.services.postgres.volumes ?? []), '/:/host']; }, ['guard-mount']],
    ['the Docker socket on postgres', (y) => { y.services.postgres.volumes = [...(y.services.postgres.volumes ?? []), '/var/run/docker.sock:/s']; }, ['guard-mount']],
    ['a named volume with driver_opts bind /', (y) => { y.volumes = { v: { driver: 'local', driver_opts: { type: 'none', o: 'bind', device: '/' } } }; y.services.postgres.volumes = [...(y.services.postgres.volumes ?? []), 'v:/v']; }, ['guard-mount', 'guard-key']],
    ['a configs file /etc/shadow', (y) => { y.configs = { c: { file: '/etc/shadow' } }; web(y).configs = ['c']; }, ['guard-file', 'guard-key']],
    ['container_name', (y) => { web(y).container_name = 'polycarpic-prod-web-1'; }, ['guard-name']],
    ['a top-level name of polycarpic-prod', (y) => { y.name = 'polycarpic-prod'; }, ['guard-name']],
    ['an include that adds a service (S10: include is resolved by both renders)', (y, dir) => { writeFileSync(join(dir, 'x.yml'), stringify({ services: { x: { image: 'ghcr.io/anyone/x@sha256:' + '9'.repeat(64) } } })); y.include = ['x.yml']; }, ['guard-service', 'RENDER']],
    ['an external network named polycarpic-prod_default behind the key default (S14: the resolved name decides)', (y) => { y.networks.default = { external: true, name: 'polycarpic-prod_default' }; }, ['guard-network']],
    ['the staging edge key pointing at polycarpic-edge-prod (S14)', (y) => { y.networks['edge-staging'] = { external: true, name: 'polycarpic-edge-prod' }; }, ['guard-network']],
    ['a published port on web', (y) => { web(y).ports = ['3000:3000']; }, ['guard-ports', 'guard-key']],
    ['an image outside the verified set', (y) => { web(y).image = 'ghcr.io/anyone/x@sha256:' + '9'.repeat(64); }, ['guard-image']],
  ];
  it.each(CASES)('refused on the real render: %s', (_n, edit, rules) => {
    const got = judge(edit);
    expect(rules).toContain(got.startsWith('RENDER-FAILED') ? 'RENDER' : got);
  });
});
