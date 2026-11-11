// POLY-96 shared helpers. The CLI contracts the tests pin for infra/ci/* are documented in each test file's header.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ci = (f: string) => join(ROOT, 'infra', 'ci', f);
export const wfPath = (f: string) => join(ROOT, '.github', 'workflows', f);
// A missing workflow reads as empty so its tests go red one by one (each `exists` test names the file).
export const wfText = (f: string) => (existsSync(wfPath(f)) ? readFileSync(wfPath(f), 'utf8') : '');

export type Step = { name?: string; id?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
export type Job = {
  name?: string; needs?: string | string[]; if?: string; 'runs-on'?: string; 'timeout-minutes'?: number;
  permissions?: Record<string, string>; steps?: Step[]; services?: unknown; outputs?: Record<string, string>;
};
export type Workflow = { on: Record<string, unknown>; permissions?: Record<string, string> | string; concurrency?: Record<string, unknown>; jobs: Record<string, Job> };
export const wf = (f: string): Workflow => (parse(wfText(f)) as Workflow | null) ?? { on: {}, jobs: {} };
export const needsOf = (j: Job): string[] => (j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs]);
export const steps = (j: Job): Step[] => j.steps ?? [];
export const runBodies = (w: Workflow): string[] => Object.values(w.jobs).flatMap((j) => steps(j).flatMap((s) => (s.run ? [s.run] : [])));

export type Res = { code: number | null; stdout: string; stderr: string };
export function node(script: string, o: { input?: string; env?: Record<string, string>; args?: string[]; cwd?: string } = {}): Res {
  // A missing script must be red for the right reason, never a vacuous pass of a "exits non-zero" test.
  if (!existsSync(ci(script))) throw new Error(`infra/ci/${script} does not exist`);
  const r = spawnSync('node', [ci(script), ...(o.args ?? [])], {
    input: o.input ?? '', cwd: o.cwd ?? ROOT, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(o.env ?? {}) },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
