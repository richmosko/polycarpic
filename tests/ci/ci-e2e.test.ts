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
  // POLY-86: a live apt download must not be a precondition of the required check.
  const e2e = () => steps(w.jobs.unit!).find((s) => s.name?.startsWith('Web e2e'))!;
  it('Chromium install is split from system deps, both bounded, deps non-fatal  [red if: `install --with-deps` returns, or the deps line loses `timeout` or `|| ...`, or install-deps runs without the launch probe]', () => {
    const r = e2e().run ?? '';
    expect(r).not.toMatch(/--with-deps/);
    expect(r).toMatch(/timeout \d+ [^\n]*playwright install chromium/);
    expect(r).toMatch(/timeout \d+ [^\n]*playwright install-deps chromium[^\n]*\\?\n?[^\n]*\|\|/);
    expect(r).toMatch(/if ! timeout \d+ [^\n]*node -e[^\n]*; then\n\s*timeout \d+ [^\n]*install-deps/);
  });
  it('the e2e step has its own timeout and still runs turbo e2e with no skip  [red if: timeout-minutes removed, or e2e made conditional on deps]', () => {
    expect(e2e()['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(e2e()['timeout-minutes']).toBeGreaterThan(0);
    expect(e2e().run).toMatch(/turbo run e2e --affected/);
    expect(e2e().run).not.toMatch(/--grep|--skip|test\.skip|exit 0\s*$/m);
  });
  it('the Playwright browser cache step precedes the e2e step  [red if: cache step removed or moved after]', () => {
    const names = steps(w.jobs.unit!).map((s) => s.name ?? '');
    expect(names.indexOf('Cache Playwright browsers')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Cache Playwright browsers')).toBeLessThan(names.findIndex((n) => n.startsWith('Web e2e')));
  });
});
