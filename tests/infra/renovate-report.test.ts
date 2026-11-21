// POLY-138 D1(b): the decision of the weekly Renovate check, infra/renovate/check-report.sh <report.json> (devops, 96dbb7d9).
// Behavioural: real script, fixture reports in the shape Renovate's file report has. Exit 1 = an update is due, 0 = none,
// 2 = broken lookup (fails closed). Each test names the mutation that turns it red. Needs bash and jq (both on the runner).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const SCRIPT = join(ROOT, 'infra', 'renovate', 'check-report.sh');
const dir = mkdtempSync(join(tmpdir(), 'poly138-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const run = (body: string | null) => {
  const f = join(dir, `r${n++}.json`);
  if (body !== null) writeFileSync(f, body);
  const r = spawnSync('bash', [SCRIPT, f], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const report = (deps: unknown[], file = 'infra/caddy/Dockerfile') => JSON.stringify({ repositories: { r: { packageFiles: { dockerfile: [{ packageFile: file, deps }] } } } });

describe('infra/renovate/check-report.sh', () => {
  it('exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });
  it('an update on one dependency: exit 1, one line naming file, dependency, current and new value', () => {
    const r = run(report([{ depName: 'postgres', currentValue: '17.12', updates: [{ newValue: '17.13', newDigest: 'sha256:abc' }] }], 'infra/postgres/Dockerfile'));
    expect(r.code).toBe(1); // red: an update does not fail the run (exit 0)
    expect(r.out).toMatch(/infra\/postgres\/Dockerfile: postgres 17\.12 -> 17\.13@sha256:abc/);
  });
  it('a digest-only update (new value equals the current one, the Caddy case) is due: exit 1', () => {
    const r = run(report([{ depName: 'caddy', currentValue: '2.11.9', updates: [{ newValue: '2.11.9', newDigest: 'sha256:def' }] }]));
    expect(r.code).toBe(1); // red: only a changed version is counted
    expect(r.out).toMatch(/caddy 2\.11\.9 -> 2\.11\.9@sha256:def/);
  });
  it('one dependency with an update among several without: exit 1 and only that dependency is named', () => {
    const r = run(report([{ depName: 'a', currentValue: '1', updates: [] }, { depName: 'b', currentValue: '1', updates: [{ newValue: '2' }] }, { depName: 'c', currentValue: '1' }]));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/: b 1 -> 2/);
    expect(r.out).not.toMatch(/: a 1|: c 1/);
  });
  it('an update in the second package file or second manager is found too', () => {
    const body = JSON.stringify({ repositories: { r: { packageFiles: { dockerfile: [{ packageFile: 'x/Dockerfile', deps: [{ depName: 'a', currentValue: '1', updates: [] }] }], regex: [{ packageFile: 'infra/postgres/Dockerfile', deps: [{ depName: 'age', currentValue: '1.2.1', updates: [{ newValue: '1.2.2' }] }] }] } } } });
    expect(run(body).code).toBe(1); // red: only the first manager or file is read
  });
  it('every dependency has an empty updates list: exit 0, "No update is due."', () => {
    const r = run(report([{ depName: 'postgres', currentValue: '17.12', updates: [] }, { depName: 'age', currentValue: '1.2.1', updates: [] }]));
    expect(r.code).toBe(0); // red: a clean lookup fails the weekly run (noise)
    expect(r.out).toMatch(/No update is due\./);
  });
  it('dependencies with no updates key at all: exit 0', () => {
    expect(run(report([{ depName: 'postgres', currentValue: '17.12' }])).code).toBe(0);
  });
  it.each([
    ['a missing file', null],
    ['an empty file', ''],
    ['text that is not JSON', 'Renovate crashed'],
    ['JSON with no repositories key', '{}'],
    ['an empty repositories object', '{"repositories":{}}'],
    ['repositories as a list', '{"repositories":[]}'],
  ])('%s: exit 2 on stderr, nothing on stdout (a broken lookup is never "nothing due")', (_n, body) => {
    const r = run(body);
    expect(r.code).toBe(2); // red: exit 0 or 1 (a failed lookup reads as clean, or as an update)
    expect(r.err.length).toBeGreaterThan(0);
    expect(r.out).not.toMatch(/No update is due/);
  });
  it('a repository whose lookup extracted no package files at all: exit 2 (the ruled config always finds two Dockerfiles)', () => {
    const r = run('{"repositories":{"r":{}}}');
    expect(r.code).toBe(2); // red: exit 0 "No update is due." for a lookup that looked at nothing (a broken includePaths or config)
    expect(r.out).not.toMatch(/No update is due/);
  });
  it('a repository whose package files hold no dependencies at all: exit 2 as well', () => {
    expect(run(report([])).code).toBe(2); // red: an empty extraction reads as clean
  });
  it('the weekly workflow runs this script, not an inline check', () => {
    const f = join(ROOT, '.github', 'workflows', 'renovate-check.yml');
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, 'utf8')).toContain('infra/renovate/check-report.sh'); // red: the decision is made elsewhere and this test proves nothing about it
  });
});
