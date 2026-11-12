// POLY-96 criteria 8, 9, 11 -- infra/ci/job-report.mjs + infra/ci/budgets.json (ruling §3).
// Contract (env only, no args): JOB_NAME, JOB_START (epoch s), NOW (epoch s, test override of the clock),
//   JOB_STATUS (success|failure), TURBO_RUNS_DIR (dir of turbo --summarize json; absent/empty is fine),
//   BUDGETS_FILE (default infra/ci/budgets.json), GITHUB_STEP_SUMMARY (file), RUNNER_TEMP (dir),
//   GITHUB_SHA, GITHUB_REF_NAME, GITHUB_RUN_ID, CI_FULL_RUN ("true" on a full-run dispatch).
// budgets.json: {"jobs": {"lint":120,"db":180}, "packageTest": 120}.
// Turbo summary: {"tasks":[{"taskId":"@poly/db#test","task":"test","package":"@poly/db","execution":{"startTime":ms,"endTime":ms,"exitCode":0}}]}.
// Always exits 0 (criterion 9: a warning, never a failure). Writes one JSON line to $RUNNER_TEMP/ci-test-runs.jsonl.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ci, node, ROOT } from './helpers.ts';

function scene(opts: { job: string; secs: number; tasks?: { pkg: string; secs: number; task?: string }[]; full?: boolean; status?: string; budgets?: object }) {
  const d = mkdtempSync(join(tmpdir(), 'report-'));
  const runs = join(d, 'runs'); mkdirSync(runs);
  const tasks = (opts.tasks ?? []).map((t) => ({ taskId: `${t.pkg}#${t.task ?? 'test'}`, task: t.task ?? 'test', package: t.pkg, execution: { startTime: 1_000, endTime: 1_000 + t.secs * 1000, exitCode: 0 } }));
  writeFileSync(join(runs, 'r.json'), JSON.stringify({ tasks }));
  const budgets = join(d, 'budgets.json');
  writeFileSync(budgets, JSON.stringify(opts.budgets ?? { jobs: { lint: 120, db: 180 }, packageTest: 120 }));
  const summary = join(d, 'summary.md'); writeFileSync(summary, '');
  const start = 1_700_000_000;
  const r = node('job-report.mjs', {
    env: {
      JOB_NAME: opts.job, JOB_START: String(start), NOW: String(start + opts.secs), JOB_STATUS: opts.status ?? 'success',
      TURBO_RUNS_DIR: runs, BUDGETS_FILE: budgets, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: d,
      GITHUB_SHA: 'c'.repeat(40), GITHUB_REF_NAME: 'feature/x', GITHUB_RUN_ID: '4242', CI_FULL_RUN: opts.full ? 'true' : 'false',
    },
  });
  const jl = join(d, 'ci-test-runs.jsonl');
  return { r, summary: readFileSync(summary, 'utf8'), line: existsSync(jl) ? (JSON.parse(readFileSync(jl, 'utf8').trim().split('\n').pop()!) as Record<string, unknown>) : null };
}

describe('job-report.mjs', () => {
  it('step summary shows job wall-clock and per-package test time (criterion 8)  [red if: either table omitted]', () => {
    const { r, summary } = scene({ job: 'unit', secs: 95, tasks: [{ pkg: '@poly/db', secs: 12 }, { pkg: '@poly/ledger', secs: 7 }] });
    expect(r.code, r.stderr).toBe(0);
    expect(summary).toMatch(/unit/);
    expect(summary).toMatch(/95\s*s/);
    expect(summary).toMatch(/@poly\/db/);
    expect(summary).toMatch(/12(\.0+)?\s*s/);
    expect(summary).toMatch(/@poly\/ledger/);
  });
  it('job over budget -> ::warning, exit 0 (criterion 9)  [red if: it exits non-zero or stays silent]', () => {
    const { r } = scene({ job: 'lint', secs: 200 });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^::warning title=budget::lint 200s > 120s/m);
  });
  it('job within budget -> no warning', () => {
    expect(scene({ job: 'lint', secs: 119 }).r.stdout).not.toMatch(/::warning/);
  });
  it('db budget is its own (180 s): 150 s is fine, 181 s warns', () => {
    expect(scene({ job: 'db', secs: 150 }).r.stdout).not.toMatch(/::warning/);
    expect(scene({ job: 'db', secs: 181 }).r.stdout).toMatch(/::warning title=budget::db 181s > 180s/);
  });
  it('a package test task over 120 s warns naming the package  [red if: package budget not applied]', () => {
    const { r } = scene({ job: 'unit', secs: 100, tasks: [{ pkg: '@poly/slow', secs: 130 }, { pkg: '@poly/fast', secs: 3 }] });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/::warning title=budget::.*@poly\/slow/);
    expect(r.stdout).not.toMatch(/::warning[^\n]*@poly\/fast/);
  });
  it('a job with no budget (unit, image) reports but never warns on its total', () => {
    expect(scene({ job: 'image', secs: 900 }).r.stdout).not.toMatch(/::warning/);
  });
  it('missing turbo summary dir still writes the wall-clock and exits 0', () => {
    const d = mkdtempSync(join(tmpdir(), 'report-'));
    const summary = join(d, 's.md'); writeFileSync(summary, '');
    const r = node('job-report.mjs', { env: { JOB_NAME: 'db', JOB_START: '100', NOW: '160', TURBO_RUNS_DIR: join(d, 'none'), GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: d, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'b', GITHUB_RUN_ID: '1', CI_FULL_RUN: 'false', JOB_STATUS: 'success' } });
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(summary, 'utf8')).toMatch(/60\s*s/);
  });
  it('JSONL line follows the test-runs.jsonl schema with who=ci, runner=ci:<job> (criterion 11 CI half)', () => {
    const { line } = scene({ job: 'unit', secs: 95 });
    expect(line).not.toBeNull();
    const l = line!;
    const KNOWN = ['ts', 'who', 'gate', 'full', 'runner', 'sha', 'branch', 'seconds', 'harness_ms', 'jobs', 'files', 'tests', 'skipped', 'ok', 'failures', 'errors', 'session', 'cmd'];
    for (const k of Object.keys(l)) expect(KNOWN, `unknown key ${k}`).toContain(k);
    for (const k of ['ts', 'who', 'full', 'runner', 'sha', 'branch', 'seconds', 'ok', 'session']) expect(l, `missing ${k}`).toHaveProperty(k);
    expect(l.who).toBe('ci');
    expect(l.runner).toBe('ci:unit');
    expect(l.sha).toBe('c'.repeat(40));
    expect(l.branch).toBe('feature/x');
    expect(l.seconds).toBe(95);
    expect(l.ok).toBe(true);
    expect(l.session).toBe('4242');
    expect(l.full).toBe(false);
  });
  it('full is true only on a full-run dispatch; ok follows JOB_STATUS  [red if: full hard-coded or ok always true]', () => {
    expect(scene({ job: 'unit', secs: 1, full: true }).line!.full).toBe(true);
    const f = scene({ job: 'unit', secs: 1, status: 'failure' }).line!;
    expect(f.ok).toBe(false);
  });
  it('the JSONL line carries no env or context dump (S96-14)', () => {
    const { line } = scene({ job: 'unit', secs: 1 });
    expect(JSON.stringify(line)).not.toMatch(/GITHUB_|TOKEN|PATH/);
  });
});

describe('budgets.json', () => {
  it('holds the ruled budgets: lint 120, db 100 (POLY-141 C13: still a warning, no failing ratchet), package test 120; unit and image have none', () => {
    const b = JSON.parse(readFileSync(ci('budgets.json'), 'utf8')) as { jobs: Record<string, number>; packageTest: number };
    expect(b.jobs.lint).toBe(120);
    expect(b.jobs.db).toBe(100);
    expect(b.packageTest).toBe(120);
    expect(b.jobs.unit).toBeUndefined();
    expect(b.jobs.image).toBeUndefined();
  });
});

// POLY-141 C13 (criterion 7): per-file seconds for the db battery. With VITEST_JSON (path to vitest's json reporter output)
// set and JOB_NAME=db, REPORT_ONLY=jsonl writes one `ci:db:file` line per test file next to the job line.
// Line: {...common job-line fields, runner:'ci:db:file', file:'tests/db/x.test.ts', project:'db-parallel'|'db-serial', area, seconds, ok}.
// Vitest json: {testResults:[{name: <absolute path>, startTime: ms, endTime: ms, status: 'passed'|'failed'}]}.
describe('job-report.mjs: per-file timing for the db battery (POLY-141 C13)', () => {
  const FILES: [string, number, string][] = [
    ['tests/db/auth-session.test.ts', 4.5, 'passed'], ['tests/db/tenancy.test.ts', 3.25, 'passed'],
    ['tests/db/runner.test.ts', 12, 'failed'], ['tests/db/ops-status.test.ts', 1, 'passed'],
  ];
  function dbScene(o: { json?: string | null; job?: string; only?: string }) {
    const d = mkdtempSync(join(tmpdir(), 'report-file-'));
    const jsonPath = join(d, 'vitest.json');
    const body = o.json === undefined ? JSON.stringify({ testResults: FILES.map(([f, sec, status], i) => ({ name: join(ROOT, f), startTime: 1_000 + i * 50, endTime: 1_000 + i * 50 + sec * 1000, status, assertionResults: [] })) }) : o.json;
    if (body !== null) writeFileSync(jsonPath, body);
    const summary = join(d, 's.md'); writeFileSync(summary, '');
    const r = node('job-report.mjs', {
      env: { JOB_NAME: o.job ?? 'db', JOB_START: '100', NOW: '160', JOB_STATUS: 'success', GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: d, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'b', GITHUB_RUN_ID: '1', CI_FULL_RUN: 'false', REPORT_ONLY: o.only ?? 'jsonl', VITEST_JSON: jsonPath, TURBO_RUNS_DIR: join(d, 'none') },
    });
    const jl = join(d, 'ci-test-runs.jsonl');
    const lines = existsSync(jl) ? readFileSync(jl, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : [];
    return { r, lines, files: lines.filter((l) => l.runner === 'ci:db:file'), jobLines: lines.filter((l) => l.runner === 'ci:db') };
  }

  it('one ci:db:file line per test file, next to exactly one ci:db job line, exit 0  [red while the JSON is ignored]', () => {
    const { r, files, jobLines } = dbScene({});
    expect(r.code, r.stderr).toBe(0);
    expect(jobLines).toHaveLength(1);
    expect(files.map((l) => l.file).sort()).toEqual(FILES.map((f) => f[0]).sort());
  });
  it('each line carries file, project, area, seconds and ok from the JSON, the SERIAL list and the area map', () => {
    const { files } = dbScene({});
    const by = Object.fromEntries(files.map((l) => [l.file, l]));
    expect(by['tests/db/auth-session.test.ts']).toMatchObject({ project: 'db-parallel', area: 'auth', seconds: 4.5, ok: true, who: 'ci' });
    expect(by['tests/db/tenancy.test.ts']).toMatchObject({ project: 'db-parallel', area: 'tenancy', seconds: 3.25, ok: true });
    expect(by['tests/db/runner.test.ts']).toMatchObject({ project: 'db-serial', area: 'migrate', seconds: 12, ok: false });
    expect(by['tests/db/ops-status.test.ts']).toMatchObject({ project: 'db-parallel', area: 'ops', seconds: 1, ok: true });
  });
  it('the file lines share the job line\'s sha, branch and session, and carry no env dump', () => {
    const { files } = dbScene({});
    for (const l of files) {
      expect(l).toMatchObject({ sha: 'a'.repeat(40), branch: 'b', session: '1', runner: 'ci:db:file' });
      expect(JSON.stringify(l)).not.toMatch(/GITHUB_|TOKEN|PATH|VITEST_JSON/);
    }
  });
  it('REPORT_ONLY=summary writes no file lines (they belong to the jsonl step)', () => {
    expect(dbScene({ only: 'summary' }).files).toEqual([]);
  });
  it('another job (unit) with VITEST_JSON set writes no file lines', () => {
    expect(dbScene({ job: 'unit' }).files).toEqual([]);
  });
  for (const [name, json] of [['a missing file', null], ['unparseable JSON', '{not json'], ['JSON with no testResults', '{}'], ['an empty file', '']] as [string, string | null][]) {
    it(`${name} -> only the job line, exit 0  [red if: a missing or broken report fails the step]`, () => {
      const { r, files, jobLines } = dbScene({ json });
      expect(r.code, r.stderr).toBe(0);
      expect(files).toEqual([]);
      expect(jobLines).toHaveLength(1);
    });
  }
  it('the ratchet stays a warning: a file over any number never makes the report exit non-zero', () => {
    const slow = JSON.stringify({ testResults: [{ name: join(ROOT, 'tests/db/runner.test.ts'), startTime: 0, endTime: 900_000, status: 'passed' }] });
    expect(dbScene({ json: slow }).r.code).toBe(0);
  });
});
