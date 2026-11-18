// The CI dependency audit (`pnpm audit --audit-level high`) ignores one advisory, GHSA-fc5q-39xc-vjpf (picomatch ReDoS, no patched
// release), through auditConfig.ignoreGhsas in pnpm-workspace.yaml. The exemption is true only while picomatch is absent from the
// production install and only until the re-check date. Titles end with [red if: <mutation>].
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from './helpers.ts';

const GHSA = 'GHSA-fc5q-39xc-vjpf';
const text = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'poly-audit-exemption-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The override (used to show the date check fail) moves the clock forward only: the later of the real date and the override.
const effectiveToday = (override?: string): string => {
  const real = new Date().toISOString().slice(0, 10);
  return override && override > real ? override : real;
};

describe('the audit exemption', () => {
  it('pnpm-workspace.yaml ignores exactly this one advisory  [red if: another GHSA is added or this one is dropped from the list]', () => {
    expect(parse(text).auditConfig).toEqual({ ignoreGhsas: [GHSA] });
  });

  it('the re-check date has not passed  [red if: today is after the date in the comment; remove the entry or move the date with a note in the issue]', () => {
    const m = text.match(/Re-check for a fixed release by (\d{4}-\d{2}-\d{2})/);
    expect(m, 'the re-check date comment is missing').not.toBeNull();
    const today = effectiveToday(process.env.AUDIT_EXEMPTION_TODAY);
    expect(today <= m![1]!, `${GHSA} was to be re-checked by ${m![1]} (today ${today})`).toBe(true);
  });

  it('the override can move the clock forward only  [red if: a past AUDIT_EXEMPTION_TODAY silences the date check]', () => {
    const real = new Date().toISOString().slice(0, 10);
    expect(effectiveToday('2000-01-01')).toBe(real);
    expect(effectiveToday('2999-01-01')).toBe('2999-01-01');
    expect(effectiveToday(undefined)).toBe(real);
  });

  it('package.json carries no pnpm.auditConfig  [red if: a second ignore list is added where the test does not look]', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.pnpm?.auditConfig).toBeUndefined();
    expect(pkg.auditConfig).toBeUndefined();
  });

  it('ci.yml runs the audit exactly as `pnpm audit --audit-level high` and these guards under the same condition  [red if: the guard step is dropped, its condition narrows, or the audit command gains a flag]', () => {
    const ci = parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
    const jobs = Object.values<any>(ci.jobs).filter((j) => (j.steps ?? []).some((s: any) => /\bpnpm audit\b/.test(s.run ?? '')));
    expect(jobs.length).toBe(1);
    const steps: any[] = jobs[0].steps;
    const audits = steps.filter((s) => /\bpnpm audit\b/.test(s.run ?? ''));
    expect(audits.length).toBe(1);
    expect(audits[0].run.trim()).toBe('pnpm audit --audit-level high');
    const guards = steps.filter((s) => /audit-exemption\.test\.ts/.test(s.run ?? ''));
    expect(guards.length).toBe(1);
    expect(guards[0].if).toBe(audits[0].if);
    expect(guards[0].run).toMatch(/vitest run .*tests\/ci\/audit-exemption\.test\.ts/);
    expect(guards[0]['continue-on-error']).toBeUndefined();
  });

  it('the production install holds no picomatch  [red if: a production dependency pulls picomatch into the image]', () => {
    const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tests/layers/tsc/package.json'];
    for (const base of ['packages', 'apps']) {
      for (const d of readdirSync(join(ROOT, base), { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(ROOT, base, d.name, 'package.json'))) files.push(`${base}/${d.name}/package.json`);
      }
    }
    for (const f of files) {
      mkdirSync(dirname(join(scratch, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(scratch, f));
    }
    const r = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prod', '--prefer-offline'], { cwd: scratch, encoding: 'utf8', timeout: 240_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-1500)).toBe(0);
    const installed = readdirSync(join(scratch, 'node_modules', '.pnpm'));
    expect(installed.length).toBeGreaterThan(50); // not vacuous
    expect(installed.filter((n) => n.startsWith('picomatch@'))).toEqual([]);
  }, 300_000);
});
