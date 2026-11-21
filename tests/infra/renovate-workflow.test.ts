// POLY-138 D1 (Principal, 2026-11-21: option b): the weekly, read-only Renovate lookup workflow,
// .github/workflows/renovate-check.yml. Static structure only: no Docker, no network. Each test names its mutation.
// The mechanism that makes the run fail when an update is due is pinned loosely (a failing shell condition in a run step):
// the ruling fixes the behaviour, not the command. A behavioural test needs a seam (a script path); see test-plan.md.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const FILE = join(ROOT, '.github', 'workflows', 'renovate-check.yml');
const text = () => (existsSync(FILE) ? readFileSync(FILE, 'utf8') : '');
const wf = () => parse(text()) as any;
const steps = () => Object.values<any>(wf().jobs ?? {}).flatMap((j) => j.steps ?? []);
const runText = () => steps().map((s) => String(s.run ?? '')).join('\n');

describe('renovate-check.yml (D1 option b)', () => {
  it('exists', () => {
    expect(existsSync(FILE)).toBe(true); // red: no workflow
  });
  it('permissions are contents: read and nothing more, at the workflow level and in every job', () => {
    expect(wf().permissions).toEqual({ contents: 'read' }); // red: missing (the default token is wider), or any added scope such as pull-requests: write
    for (const [n, j] of Object.entries<any>(wf().jobs ?? {})) if (j.permissions !== undefined) expect(j.permissions, `job ${n}`).toEqual({ contents: 'read' }); // red: a job widens it
  });
  it('references no secret: no secrets.* expression, no secrets: key, no GH_TOKEN/RENOVATE_TOKEN environment', () => {
    const t = text();
    expect(t.length).toBeGreaterThan(0);
    expect(t).not.toMatch(/secrets\s*[.\[]/); // red: ${{ secrets.X }}
    expect(t).not.toMatch(/^\s*secrets\s*:/m); // red: `secrets: inherit`
    expect(t).not.toMatch(/\b(RENOVATE_TOKEN|GH_TOKEN|GITHUB_TOKEN)\b/); // red: a token handed to Renovate (it must not be able to write)
  });
  it('triggers are schedule and workflow_dispatch only: never pull_request, pull_request_target, push or workflow_run', () => {
    expect(Object.keys(wf().on ?? {}).sort()).toEqual(['schedule', 'workflow_dispatch']); // red: any other trigger, or none
  });
  it('the schedule is one weekly cron (day-of-week set, day-of-month and month wild)', () => {
    const sched = wf().on?.schedule ?? [];
    expect(sched).toHaveLength(1); // red: two schedules, or none
    const f = String(sched[0]?.cron ?? '').trim().split(/\s+/);
    expect(f).toHaveLength(5);
    expect(f[2]).toBe('*');
    expect(f[3]).toBe('*');
    expect(f[4]).toMatch(/^[0-6]$|^(SUN|MON|TUE|WED|THU|FRI|SAT)$/i); // red: daily (`*`) or a list of days
  });
  it('the Renovate image is referenced by digest: renovate/renovate@sha256:<64 hex>, never a tag', () => {
    const refs = text().match(/renovate\/renovate\S*/g) ?? [];
    expect(refs.length, 'a Renovate image reference').toBeGreaterThan(0);
    for (const r of refs) expect(r, r).toMatch(/^renovate\/renovate@sha256:[0-9a-f]{64}$/); // red: :latest, :44, or a tag plus digest drift
  });
  it('it runs the lookup read-only: --platform=local and --dry-run=lookup', () => {
    const t = text();
    expect(t).toMatch(/--platform=local/); // red: a platform that opens PRs
    expect(t).toMatch(/--dry-run=lookup/); // red: no dry run, or `--dry-run=full`
    expect(t).not.toMatch(/--dry-run=(null|false|full|extract)\b/);
    expect(t).not.toMatch(/--platform=github/);
  });
  it('it reads the repo config and fails when an update is due (a run step exits non-zero on a proposed update)', () => {
    const r = runText();
    expect(r, 'a run step').not.toBe('');
    expect(r).toMatch(/\bexit 1\b|\|\|\s*exit\b|! *grep|grep -q|\btest\b|\[\[? /); // red: the Renovate exit code (0 on proposals) is the job's result, so a due update is a green run
    expect(r).not.toMatch(/\|\|\s*true\b|continue-on-error/); // red: failure swallowed
    expect(text()).not.toMatch(/continue-on-error:\s*true/);
  });
});
