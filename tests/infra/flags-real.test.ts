// POLY-100 F16 / T14 (ruling 9476666f): the option lists the fakes refuse against (tests/infra/ops/fixtures/flags.json) come from the real tools' own `--help`, so a fake cannot accept an option
// the real subcommand lacks (it accepted `compose run --no-build`, which real Compose rejects). Needs docker with the compose plugin, gh and git on PATH; no daemon, no network (lint job).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const FX = join(ROOT, 'tests', 'infra', 'ops', 'fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'poly100-flags-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const committed: Record<string, any> = JSON.parse(readFileSync(join(FX, 'flags.json'), 'utf8'));
const run = spawnSync('python3', ['-I', join(FX, 'gen_flags.py'), '--out', join(tmp, 'flags.json')], { encoding: 'utf8' });
const real: Record<string, any> = run.status === 0 ? JSON.parse(readFileSync(join(tmp, 'flags.json'), 'utf8')) : {};

describe('F16: the fakes\' option lists are the real tools\'', () => {
  it('the real --help could be read (docker compose, gh, git on PATH)', () => {
    expect(run.status, run.stderr).toBe(0);
    for (const k of Object.keys(committed)) if (k !== '_versions') expect(Object.keys(real), k).toContain(k);
  });

  for (const key of Object.keys(committed).filter((k) => k !== '_versions')) {
    it(`${key}: every committed option is one the installed tool really has`, () => {
      const invented = (committed[key] as string[]).filter((o) => !(real[key] ?? []).includes(o));
      expect(invented).toEqual([]);
    });
  }

  it('docker compose run has no --no-build (up has): the option the build used on `run` was never real', () => {
    expect(real['docker compose run']).not.toContain('--no-build');
    expect(real['docker compose up']).toContain('--no-build');
    expect(committed['docker compose run']).not.toContain('--no-build');
  });
});
