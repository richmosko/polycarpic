// POLY-96 S96-7 guard (infra/ci/check-run-expr.mjs) and the job-report REPORT_ONLY split (record -> upload -> summary).
// check-run-expr contract: `node check-run-expr.mjs <dir|file>...`; 0 clean, 1 on an event/head_ref/inputs expression in a
// `run:` body (offender named), 2 on a bad path / no args.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { node, ROOT, steps, wf } from './helpers.ts';

const wfFile = (step: string) => {
  const d = mkdtempSync(join(tmpdir(), 'rx-'));
  writeFileSync(join(d, 'w.yml'), `jobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`);
  return d;
};
const chk = (step: string) => node('check-run-expr.mjs', { args: [wfFile(step)] });

describe('check-run-expr.mjs', () => {
  for (const expr of ['github.event.pull_request.title', 'github.head_ref', 'inputs.base', 'github.event.inputs.base']) {
    it(`\${{ ${expr} }} inside run: -> red  [red if: that expression class is not in the pattern]`, () => {
      const r = chk(`      - run: echo "\${{ ${expr} }}"`);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/job j/);
    });
  }
  it('same expression in env: passes  [red if: the guard scans env: too]', () => {
    const r = chk(`      - env:\n          T: \${{ github.event.pull_request.title }}\n        run: echo "$T"`);
    expect(r.code, r.stderr).toBe(0);
  });
  it('multi-line run: bodies are scanned', () => {
    expect(chk(`      - run: |\n          set -e\n          echo \${{ github.head_ref }}`).code).toBe(1);
  });
  it('safe expressions in run: (github.repository, github.sha) pass', () => {
    expect(chk(`      - run: echo \${{ github.repository }} \${{ github.sha }}`).code).toBe(0);
  });
  it('bad path and no args exit 2 (fail closed)', () => {
    expect(node('check-run-expr.mjs', { args: [join(tmpdir(), 'nope-poly96')] }).code).toBe(2);
    expect(node('check-run-expr.mjs').code).toBe(2);
  });
  it('the real .github/ is clean', () => {
    const r = node('check-run-expr.mjs', { args: [join(ROOT, '.github')] });
    expect(r.code, r.stderr).toBe(0);
  });
});

describe('job-report REPORT_ONLY split', () => {
  const go = (only: string) => {
    const d = mkdtempSync(join(tmpdir(), 'ro-'));
    const summary = join(d, 's.md'); writeFileSync(summary, '');
    const r = node('job-report.mjs', { env: { REPORT_ONLY: only, JOB_NAME: 'lint', JOB_START: '0', NOW: '500', JOB_STATUS: 'success', GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: d, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'b', GITHUB_RUN_ID: '7', CI_FULL_RUN: 'false' } });
    const jl = join(d, 'ci-test-runs.jsonl');
    return { r, summary: readFileSync(summary, 'utf8'), jsonl: existsSync(jl) ? readFileSync(jl, 'utf8') : '' };
  };
  it('jsonl writes only the record; summary writes only summary + warning; unset does both  [red if: the split leaks]', () => {
    const j = go('jsonl');
    expect(j.jsonl).toMatch(/"runner":"ci:lint"/);
    expect(j.summary).toBe('');
    expect(j.r.stdout).not.toMatch(/::warning/);
    const s = go('summary');
    expect(s.jsonl).toBe('');
    expect(s.summary).toMatch(/500\s*s/);
    expect(s.r.stdout).toMatch(/::warning title=budget::lint 500s > 120s/);
    const both = go('');
    expect(both.jsonl).not.toBe('');
    expect(both.summary).not.toBe('');
    for (const x of [j, s, both]) expect(x.r.code).toBe(0);
  });
  it('in each job: record step -> artifact upload -> summary step, summary last with if: always()  [red if: upload precedes the record or summary moves]', () => {
    const w = wf('ci.yml');
    for (const id of ['lint', 'unit', 'db', 'image']) {
      const ss = steps(w.jobs[id]!);
      const rec = ss.findIndex((s) => s.env?.REPORT_ONLY === 'jsonl');
      const up = ss.findIndex((s) => s.uses?.startsWith('actions/upload-artifact@'));
      const sum = ss.findIndex((s) => s.env?.REPORT_ONLY === 'summary');
      expect(rec, id).toBeGreaterThanOrEqual(0);
      expect(rec, id).toBeLessThan(up);
      expect(up, id).toBeLessThan(sum);
      expect(sum, id).toBe(ss.length - 1);
      for (const i of [rec, up, sum]) expect(ss[i]!.if, `${id}[${i}]`).toMatch(/always\(\)/);
    }
  });
});
