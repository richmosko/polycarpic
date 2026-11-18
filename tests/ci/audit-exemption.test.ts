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

describe('the audit exemption', () => {
  it('pnpm-workspace.yaml ignores exactly this one advisory  [red if: another GHSA is added or this one is dropped from the list]', () => {
    expect(parse(text).auditConfig).toEqual({ ignoreGhsas: [GHSA] });
  });

  it('the re-check date has not passed  [red if: today is after the date in the comment; remove the entry or move the date with a note in the issue]', () => {
    const m = text.match(/Re-check for a fixed release by (\d{4}-\d{2}-\d{2})/);
    expect(m, 'the re-check date comment is missing').not.toBeNull();
    const today = process.env.AUDIT_EXEMPTION_TODAY ?? new Date().toISOString().slice(0, 10); // the override exists to show the test fail
    expect(today <= m![1]!, `${GHSA} was to be re-checked by ${m![1]} (today ${today})`).toBe(true);
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
