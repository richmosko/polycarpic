// POLY-100 G11 on REAL Compose (ruling 3b62bbe6): the caller's directory decides nothing. Measured at v5.7.0: on stdin Compose reads `.env` of the caller's directory, takes values from it and turns profiles on
// (`COMPOSE_PROFILES`); `--project-directory <empty>` and `--env-file /dev/null` stop it. Control first (the hostile `.env` DOES change a bare call, or the case proves nothing), then the tool's own options.
// Needs the compose CLI (no daemon). Runs in the lint job; fails, never skips, when compose is missing in CI.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const have = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' });
if (have.status !== 0 && process.env.CI === 'true') throw new Error('render-cwd: the compose plugin is missing in CI: this case must run, not skip');
const suite = have.status === 0 ? describe : describe.skip;

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); made.push(d); return d; };

// a judged file's shape: a base service and one that only a profile turns on
const FILE = JSON.stringify({ name: 'polycarpic-cwd', services: { base: { image: 'example.invalid/a@sha256:' + '1'.repeat(64), labels: { v: '${V:-clean}' } }, extra: { image: 'example.invalid/b@sha256:' + '2'.repeat(64), profiles: ['extra'] } } });

function render(cwd: string, opts: string[], extraEnv: Record<string, string> = {}): { code: number; services: string[]; v: string; err: string } {
  const r = spawnSync('docker', ['compose', '-p', 'polycarpic-cwd', ...opts, '-f', '-', '--profile', '*', 'config', '--format', 'json'], { cwd, input: FILE, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extraEnv } });
  let services: string[] = [];
  let v = '';
  try { const j = JSON.parse(r.stdout); services = Object.keys(j.services ?? {}).sort(); v = j.services?.base?.labels?.v ?? ''; } catch { /* an error */ }
  return { code: r.status ?? 1, services, v, err: r.stderr };
}

suite('G11 on real Compose: the caller\'s directory decides nothing', () => {
  const hostile = tmp('poly100-hostile-');
  writeFileSync(join(hostile, '.env'), 'V=hostile\nCOMPOSE_PROFILES=extra\n');
  writeFileSync(join(hostile, 'compose.yaml'), 'services:\n  planted:\n    image: example.invalid/c@sha256:' + '3'.repeat(64) + '\n');
  const home = tmp('poly100-render-home-'); // empty, as the render home is
  const clean = tmp('poly100-clean-');
  const base = render(clean, []);

  it('the control: with no options a hostile `.env` in the caller\'s directory changes the answer (else the case proves nothing)', () => {
    const bare = render(hostile, []);
    expect(base.code, base.err).toBe(0);
    expect(bare.code, bare.err).toBe(0);
    expect(base.v).toBe('clean');
    expect(bare.v, 'Compose ignored the hostile .env even without the options: the control is vacuous on this version').toBe('hostile');
  });

  it('with --project-directory <empty render home> and --env-file /dev/null the answer is the clean directory\'s, from the hostile directory', () => {
    const opts = ['--project-directory', home, '--env-file', '/dev/null'];
    const a = render(hostile, opts);
    const b = render(clean, opts);
    expect(a.code, a.err).toBe(0);
    expect(a.v, 'a value of the caller\'s .env reached the render').toBe('clean');
    expect(a.services).toEqual(b.services);
    expect(a.services, '`extra` (a profile) is on in both: `--profile "*"` is the tool\'s own, never the caller\'s').toContain('extra');
    expect(a.services, 'a compose.yaml of the caller\'s directory was read').not.toContain('planted');
  });

  it('a `.env` planted in the caller\'s directory AFTER the render changes neither values nor profiles of the second render', () => {
    const opts = ['--project-directory', home, '--env-file', '/dev/null'];
    const first = render(clean, opts);
    writeFileSync(join(clean, '.env'), 'COMPOSE_PROFILES=nothing\nCOMPOSE_PROJECT_NAME=late\n');
    const second = render(clean, opts);
    expect(second.v).toBe(first.v);
    expect(second.services).toEqual(first.services);
  });

  it('COMPOSE_FILE and COMPOSE_PROFILES in the tool\'s own environment never reach a render (the tool builds the child\'s environment from nothing: R1)', () => {
    // the isolated child is given an environment of its own; here the control is the caller's: with the variable set, a bare call is changed
    const opts = ['--project-directory', home, '--env-file', '/dev/null'];
    mkdirSync(join(clean, 'sub'), { recursive: true });
    const withVar = render(clean, opts, { COMPOSE_PROFILES: 'extra' });
    const without = render(clean, opts);
    expect(withVar.services).toEqual(without.services);
  });
});
