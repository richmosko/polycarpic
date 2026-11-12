// POLY-128 ruling R9 -- Playwright joins the existing `unit` job; no new top-level job.
import { describe, expect, it } from 'vitest';
import { steps, wf } from './helpers.ts';

const w = wf('ci.yml');
// Rule (POLY-136 ruling item 5): every `exit` is followed by a nonzero integer literal, except exactly one `exit 0` on the
// affected-only line, which comes before the browser install. Nothing but whitespace after the last `fi`; no `||` on turbo.
function exitViolations(run: string): string[] {
  const out: string[] = [];
  const lines = run.split('\n').filter((l) => !/^\s*#/.test(l));
  const install = lines.findIndex((l) => l.includes('playwright install chromium'));
  let zero = 0;
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\b(exit|return)\b(.*)/g)) {
      const lit = /^\s+([0-9]+)\b/.exec(m[2] ?? '');
      if (m[1] === 'return' || !lit) out.push(`line ${i}: ${m[1]} without a nonzero literal`);
      else if (Number(lit[1]) === 0) {
        zero += 1;
        const ok = l.includes("grep -q '@poly/web' affected.txt") && install >= 0 && i < install && /; then echo "[^"]*"; exit 0; fi\s*$/.test(l);
        if (!ok) out.push(`line ${i}: exit 0 outside the affected-only skip`);
      }
    }
    if (/turbo run e2e/.test(l) && /\|\|/.test(l)) out.push(`line ${i}: turbo run e2e carries ||`);
  });
  if (zero > 1) out.push('more than one exit 0');
  const lastFi = lines.map((l) => /^\s*fi\s*$/.test(l)).lastIndexOf(true);
  if (lastFi >= 0 && lines.slice(lastFi + 1).some((l) => l.trim() !== '')) out.push('commands after the last fi');
  return out;
}
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
  it('Chromium install is split from system deps, both bounded, deps non-fatal  [red if: `install --with-deps` returns, or the deps line loses `timeout` or `|| ...`, or install-deps runs without the launch probe, or a plain `timeout` loses `-k`]', () => {
    const r = e2e().run ?? '';
    expect(r).not.toMatch(/--with-deps/);
    expect(r).toMatch(/timeout -k \d+ \d+ [^\n]*playwright install chromium/);
    expect(r).toMatch(/timeout -k \d+ \d+ [^\n]*playwright install-deps chromium[^\n]*\\?\n?[^\n]*\|\|/);
    expect(r).toMatch(/if ! timeout -k \d+ \d+ [^\n]*node -e[^\n]*; then\n\s*timeout -k \d+ \d+ [^\n]*install-deps/);
  });
  it('a second probe after install-deps fails the step  [red if: the post-install-deps probe or its `exit 1` is removed]', () => {
    const r = e2e().run ?? '';
    expect(r).toMatch(/install-deps[\s\S]*?\n\s*timeout -k \d+ \d+ [^\n]*node -e[^\n]*\|\| \{[^\n]*exit 1; \}\n\s*fi/);
  });
  it('the real step passes the exit rule  [red if: the step gains an exit that is not the affected-only skip or a nonzero failure]', () => {
    expect(exitViolations(e2e().run ?? '')).toEqual([]);
  });
  // POLY-136 item 5: one rule, shown red on each mutation of the real step (the old two regexes missed most of them).
  const mutate = (name: string, f: (r: string) => string) =>
    it(`exit rule is red on: ${name}  [red if: exitViolations stops flagging it]`, () => {
      const r = e2e().run ?? '';
      const m = f(r);
      expect(m).not.toBe(r);
      expect(exitViolations(m).length).toBeGreaterThan(0);
    });
  mutate('a mid-line `; exit 0; fi` after the install', (r) => r.replace('playwright install chromium', 'playwright install chromium; if true; then exit 0; fi'));
  mutate('a bare `exit`', (r) => r.replace('exit 1; }', 'exit; }'));
  mutate('`exit $X`', (r) => r.replace('exit 1; }', 'exit $X; }'));
  mutate('`exit 0 # note` at the end', (r) => `${r.trimEnd()}\nexit 0 # note\n`);
  mutate('a second `exit 0` in place of the probe failure', (r) => r.replace('exit 1; }', 'exit 0; }'));
  mutate('`turbo run e2e || true`', (r) => r.replace('turbo run e2e --affected', 'turbo run e2e --affected || true'));
  mutate('a `return`', (r) => r.replace('exit 1; }', 'return 0; }'));
  mutate('an early `exit 0` on a line before the affected check', (r) => `exit 0\n${r}`);
  mutate('the affected-only skip moved after the browser install', (r) => {
    const l = r.split('\n');
    const i = l.findIndex((x) => x.includes("grep -q '@poly/web'"));
    const [skip] = l.splice(i, 1);
    l.splice(l.findIndex((x) => x.includes('playwright install chromium')) + 1, 0, skip!);
    return l.join('\n');
  });
  mutate('commands after the last `fi`', (r) => `${r.trimEnd()}\necho done\n`);
  it('the e2e step has its own timeout and still runs turbo e2e with no skip  [red if: timeout-minutes removed, or e2e made conditional on deps]', () => {
    expect(e2e()['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(e2e()['timeout-minutes']).toBeGreaterThan(0);
    expect(e2e().run).toMatch(/turbo run e2e --affected/);
    expect(e2e().run).not.toMatch(/--grep|--skip|test\.skip/);
  });
  it('the Playwright browser cache step precedes the e2e step  [red if: cache step removed or moved after]', () => {
    const names = steps(w.jobs.unit!).map((s) => s.name ?? '');
    expect(names.indexOf('Cache Playwright browsers')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Cache Playwright browsers')).toBeLessThan(names.findIndex((n) => n.startsWith('Web e2e')));
  });
});
