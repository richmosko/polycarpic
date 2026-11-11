// POLY-128 ruling R9 -- Playwright joins the existing `unit` job; no new top-level job.
import { describe, expect, it } from 'vitest';
import { steps, wf } from './helpers.ts';

const w = wf('ci.yml');
const runs = () => steps(w.jobs.unit!).map((s) => `${s.run ?? ''}`).join('\n');

describe('ci.yml: web e2e in the unit job (POLY-128 R9)', () => {
  it('job set is unchanged  [red if: an e2e/playwright job is added at top level]', () => {
    expect(Object.keys(w.jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'guard', 'image', 'lint', 'unit']);
  });
  it('unit runs `turbo run e2e` with --affected  [red if: the e2e step is missing or runs unaffected]', () => {
    expect(runs()).toMatch(/turbo run e2e[^\n]*--affected/);
  });
  it('unit installs Chromium for Playwright  [red if: no `playwright install ... chromium` step]', () => {
    expect(runs()).toMatch(/playwright install[^\n]*chromium/);
  });
  it('the Chromium install happens before the e2e run  [red if: order swapped]', () => {
    const r = runs();
    expect(r.search(/playwright install/)).toBeGreaterThanOrEqual(0);
    expect(r.search(/playwright install/)).toBeLessThan(r.search(/turbo run e2e/));
  });
  it('unit keeps its 15-minute timeout  [red if: raised to absorb e2e]', () => {
    expect(w.jobs.unit!['timeout-minutes']).toBe(15);
  });
});
