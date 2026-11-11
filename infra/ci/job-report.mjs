// POLY-96 job report (criteria 8, 9, 11; ruling §3). Env-only. Always exits 0: over budget is a warning, never a failure.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const e = process.env;
// REPORT_ONLY=jsonl|summary splits the work in two steps (the artifact upload sits between them); unset does both.
const only = e.REPORT_ONLY ?? '';
const doSummary = only !== 'jsonl';
const doJsonl = only !== 'summary';
const job = e.JOB_NAME ?? 'unknown';
const now = Number(e.NOW ?? Math.floor(Date.now() / 1000));
const secs = Math.max(0, now - Number(e.JOB_START ?? now));
const budgetsFile = e.BUDGETS_FILE ?? join(dirname(fileURLToPath(import.meta.url)), 'budgets.json');
let budgets = { jobs: {}, packageTest: Infinity };
try { budgets = JSON.parse(readFileSync(budgetsFile, 'utf8')); } catch { /* report without budgets */ }

const tasks = [];
const dir = e.TURBO_RUNS_DIR;
if (dir && existsSync(dir)) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const t of s.tasks ?? []) {
        if (t.task === 'test' && t.execution?.endTime != null) tasks.push({ pkg: t.package, secs: (t.execution.endTime - t.execution.startTime) / 1000 });
      }
    } catch { /* unreadable summary: skip */ }
  }
}

const lines = [`### ${job}`, '', '| | seconds |', '|---|---|', `| job wall-clock (${e.JOB_STATUS ?? '?'}) | ${secs} s |`];
if (tasks.length) {
  lines.push('', '| package test | seconds |', '|---|---|');
  for (const t of tasks) lines.push(`| ${t.pkg} | ${t.secs.toFixed(1)} s |`);
}
if (doSummary && e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n');

const b = budgets.jobs?.[job];
if (doSummary && b !== undefined && secs > b) console.log(`::warning title=budget::${job} ${secs}s > ${b}s`);
for (const t of tasks) if (doSummary && t.secs > budgets.packageTest) console.log(`::warning title=budget::${t.pkg} test ${t.secs.toFixed(0)}s > ${budgets.packageTest}s`);

if (doJsonl && e.RUNNER_TEMP) {
  const line = {
    ts: new Date(now * 1000).toISOString(), who: 'ci', full: e.CI_FULL_RUN === 'true', runner: `ci:${job}`,
    sha: e.GITHUB_SHA, branch: e.GITHUB_REF_NAME, seconds: secs, ok: e.JOB_STATUS === 'success', session: e.GITHUB_RUN_ID,
  };
  appendFileSync(join(e.RUNNER_TEMP, 'ci-test-runs.jsonl'), JSON.stringify(line) + '\n');
}
