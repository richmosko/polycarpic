// POLY-141 criterion 9, C14, C16, C19 -- the one anchor rule, infra/ci/anchor.mjs (ruling R4).
// Contract the builder implements (pinned here):
//   export const LEDGER: RegExp[]          the three ledger legs
//   export const PINNED_RULINGS: RegExp    today's five-ruling regex
//   export const LEDGER_TESTS: string[]    cairn test file names that read a ledger file
//   export async function decide(io): Promise<boolean>
//     io = { eventName, repo, headRef, prHead, prBase,            // strings
//            lookup(): object            // parsed `gh api` JSON; throws on exit!=0, timeout or bad JSON
//            hasCommit(sha): boolean, isAncestor(a, b): boolean,
//            diff(a, b): string[]        // `git diff --no-renames -z --name-only a b` split on NUL; throws on error
//            modes(a, b): string[]       // every old and new mode from `git diff --raw -z --no-renames a b`: exactly 2 per diff path;
//                                        // any other count (e.g. empty) is false (C22 tightening); throws on error }
//   decide() is false if any mode is 120000 (symlink) or 160000 (gitlink) (C22), or modes() throws.
//   CLI: env EVENT_NAME REPO HEAD_REF PR_HEAD PR_BASE (+ GH_TOKEN for gh); prints exactly one line
//        `ledger_only=true|false` to stdout, the reason to stderr, exit 0 (non-zero only on an internal crash).
//        `--ledger-tests` prints LEDGER_TESTS one per line.
// The CLI is run here against a real scratch git repo with a fake `gh` first on PATH.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ci, node, ROOT, wfText } from './helpers.ts';

const mod = async () => {
  if (!existsSync(ci('anchor.mjs'))) throw new Error('infra/ci/anchor.mjs does not exist');
  return import('../../infra/ci/anchor.mjs') as Promise<any>;
};
const src = () => (existsSync(ci('anchor.mjs')) ? readFileSync(ci('anchor.mjs'), 'utf8') : '');

const A = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const goodRun = () => ({ conclusion: 'success', event: 'pull_request', head_branch: 'feature/x', head_repository: { full_name: 'o/r' }, head_sha: A });
function fakeIo(over: Record<string, unknown> = {}) {
  return {
    eventName: 'pull_request', repo: 'o/r', headRef: 'feature/x', prHead: HEAD, prBase: BASE,
    lookup: () => ({ workflow_runs: [goodRun()] }),
    hasCommit: () => true,
    isAncestor: () => true,
    diff: () => ['process/STATE.md', 'process/cairn/issues/POLY-141.md'],
    modes: () => ['100644', '100644', '100644', '100644'],   // two per diff path (old, new); the default diff has two paths
    ...over,
  };
}

describe('anchor.mjs: constants (C19)', () => {
  it('LEDGER matches the three ledger legs and nothing else  [red if: a leg dropped or widened]', async () => {
    const { LEDGER } = await mod();
    const hit = (p: string) => (LEDGER as RegExp[]).some((re) => re.test(p));
    for (const p of ['process/cairn/issues/POLY-1.md', 'process/cairn/milestones/x.md', 'process/cairn/majors/x.md', 'process/cairn/archive/x.md', 'process/cairn/reviews/POLY-141/ruling.md', 'process/STATE.md', 'process/DECISIONS.md']) expect(hit(p), p).toBe(true);
    for (const p of ['process/WORKFLOW.md', 'process/TRACKER.md', 'process/cairn/config.yml', 'process/cairn/metrics/a.jsonl', 'process/STATE.md.bak', 'xprocess/STATE.md', 'scripts/cairn/a.py', 'docs/PRD/index.html']) expect(hit(p), p).toBe(false);
  });
  it('PINNED_RULINGS matches the five pinned rulings only', async () => {
    const { PINNED_RULINGS } = await mod();
    for (const id of ['POLY-6', 'POLY-10', 'POLY-26', 'POLY-48', 'POLY-51']) expect((PINNED_RULINGS as RegExp).test(`process/cairn/reviews/${id}/ruling.md`), id).toBe(true);
    expect((PINNED_RULINGS as RegExp).test('process/cairn/reviews/POLY-57/ruling.md')).toBe(false);
    expect((PINNED_RULINGS as RegExp).test('process/cairn/reviews/POLY-6/notes.md')).toBe(false);
  });
  it('LEDGER_TESTS is exactly the four ledger-dependent cairn tests (ruling addendum 2), and both exist on disk', async () => {
    const { LEDGER_TESTS } = await mod();
    expect([...LEDGER_TESTS].sort()).toEqual(['test_check_budgets.py', 'test_dashboard_roster.py', 'test_ruling_archive_records.py', 'test_state_releases_bound.py']);
    for (const t of LEDGER_TESTS) expect(existsSync(join(ROOT, 'tests', 'workflow', t)) || existsSync(join(ROOT, 'scripts', 'cairn', 'tests', t)), t).toBe(true);
  });
  it('the tracker leg of LEDGER and PINNED_RULINGS equal the EXCLUDE and PINNED_RULINGS literals kept in ci.yml  [red if: either drifts]', async () => {
    const { LEDGER, PINNED_RULINGS } = await mod();
    const yml = wfText('ci.yml');
    const ex = /EXCLUDE='([^']*)'/.exec(yml);
    const pin = /PINNED_RULINGS='([^']*)'/.exec(yml);
    expect(ex, 'EXCLUDE literal in ci.yml').not.toBeNull();
    expect(pin, 'PINNED_RULINGS literal in ci.yml').not.toBeNull();
    expect((LEDGER as RegExp[]).map((r) => r.source)).toContain(new RegExp(ex![1]!).source);
    expect((PINNED_RULINGS as RegExp).source).toBe(new RegExp(pin![1]!).source);
  });
  it('ci.yml holds no `merge-base --is-ancestor` (one implementation)  [red while the shell block remains]', () => {
    expect(wfText('ci.yml')).not.toContain('merge-base --is-ancestor');
  });
});

describe('anchor.mjs: source pins (R4 algorithm, C16, C14 S3)', () => {
  it('lists paths NUL-separated: `--no-renames -z` and a split on \\0 (S1); modes from `--raw -z` (S5)', () => {
    const s = src();
    expect(s).toMatch(/--no-renames['"`, ]+-z/);
    expect(s).toMatch(/split\((['"])\\0\1\)/);
    expect(s).toContain('--raw');
    expect(s).toContain('120000');
    expect(s).toContain('160000');
  });
  it('builds the query with encodeURIComponent(HEAD_REF), runs gh/git through spawnSync argv arrays, never a shell (S3)', () => {
    const s = src();
    expect(s).toContain('encodeURIComponent');
    expect(s).toContain('spawnSync');
    expect(s).not.toMatch(/\bexecSync\b|\bexec\(|shell:\s*true|\bexecFileSync\b.*shell/);
    expect(s).not.toMatch(/`[^`]*\$\{[^}]*(headRef|HEAD_REF)[^}]*\}[^`]*`\s*,\s*\{[^}]*shell/);
  });
  it('checks every sha against ^[0-9a-f]{40}$ before git sees it (S3)', () => {
    expect(src()).toContain('[0-9a-f]{40}');
  });
  it('asks for successful pull_request runs of ci.yml on the branch, one run, 30 s timeout, --no-renames diff', () => {
    const s = src();
    expect(s).toContain('actions/workflows/ci.yml/runs');
    expect(s).toContain('event=pull_request');
    expect(s).toContain('status=success');
    expect(s).toContain('per_page=1');
    expect(s).toMatch(/30[_]?000/);
    expect(s).toContain('--no-renames');
    expect(s).toContain('merge-base');
    expect(s).toContain('--is-ancestor');
    expect(s).toContain('cat-file');
  });
  it('imports Node built-ins only', () => {
    const s = src();
    expect(s.length, 'anchor.mjs is empty or absent').toBeGreaterThan(0);
    for (const m of s.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(m[1], m[1]).toMatch(/^node:/);
  });
});

describe('decide(): fails closed (C14)', () => {
  it('a ledger-only diff from a sound anchor is true', async () => {
    const { decide } = await mod();
    expect(await decide(fakeIo())).toBe(true);
  });
  it('passes the anchor sha and PR head to the checks  [red if: ancestry or diff asked about the wrong commits]', async () => {
    const { decide } = await mod();
    const calls: string[] = [];
    await decide(fakeIo({
      hasCommit: (s: string) => (calls.push(`has ${s}`), true),
      isAncestor: (a: string, b: string) => (calls.push(`anc ${a} ${b}`), true),
      diff: (a: string, b: string) => (calls.push(`diff ${a} ${b}`), ['process/STATE.md']),
    }));
    expect(calls).toContain(`has ${A}`);
    expect(calls).toContain(`anc ${A} ${HEAD}`);
    expect(calls).toContain(`anc ${BASE} ${A}`);
    expect(calls).toContain(`diff ${A} ${HEAD}`);
  });
  const throws = () => { throw new Error('boom'); };
  const bad: [string, Record<string, unknown>][] = [
    ['a non-PR event', { eventName: 'workflow_dispatch' }],
    ['a push event', { eventName: 'push' }],
    ['a lookup error (gh non-zero / timeout / bad JSON)', { lookup: throws }],
    ['no run', { lookup: () => ({ workflow_runs: [] }) }],
    ['a missing workflow_runs', { lookup: () => ({}) }],
    ['a null lookup', { lookup: () => null }],
    ['a failed conclusion', { lookup: () => ({ workflow_runs: [{ ...goodRun(), conclusion: 'failure' }] }) }],
    ['a non-PR run', { lookup: () => ({ workflow_runs: [{ ...goodRun(), event: 'push' }] }) }],
    ['a fork run', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_repository: { full_name: 'fork/r' } }] }) }],
    ['a missing head_repository', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_repository: undefined }] }) }],
    ['a branch mismatch', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_branch: 'feature/other' }] }) }],
    ['a short sha', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_sha: 'abc123' }] }) }],
    ['an uppercase sha', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_sha: 'A'.repeat(40) }] }) }],
    ['a sha with a trailing option', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_sha: `${A} --x` }] }) }],
    ['a missing head_sha', { lookup: () => ({ workflow_runs: [{ ...goodRun(), head_sha: undefined }] }) }],
    ['a commit absent from the clone', { hasCommit: () => false }],
    ['anchor not an ancestor of HEAD', { isAncestor: (a: string) => a !== A }],
    ['base not an ancestor of the anchor (merge from main / rebase)', { isAncestor: (a: string) => a !== BASE }],
    ['an ancestry check that throws', { isAncestor: throws }],
    ['a diff error', { diff: throws }],
    ['a symlink in the diff (mode 120000, new side)', { modes: () => ['000000', '120000', '100644', '100644'] }],
    ['a symlink in the diff (mode 120000, old side)', { modes: () => ['120000', '100644', '100644', '100644'] }],
    ['a gitlink in the diff (mode 160000)', { modes: () => ['000000', '160000', '100644', '100644'] }],
    ['a modes lookup that throws', { modes: throws }],
    ['an empty modes list for a non-empty diff (a blinded symlink check)', { modes: () => [] }],
    ['fewer than two modes per path (3 for 2 paths)', { modes: () => ['100644', '100644', '100644'] }],
    ['one mode per path (2 for 2 paths)', { modes: () => ['100644', '100644'] }],
    ['more than two modes per path (5 for 2 paths)', { modes: () => ['100644', '100644', '100644', '100644', '100644'] }],
    ['a non-array modes result', { modes: () => null }],
    ['an empty diff', { diff: () => [] }],
    ['a path outside the ledger', { diff: () => ['process/STATE.md', 'packages/db/src/x.ts'] }],
    ['a WORKFLOW.md path', { diff: () => ['process/WORKFLOW.md'] }],
    ['a pinned ruling among ledger paths', { diff: () => ['process/cairn/issues/POLY-1.md', 'process/cairn/reviews/POLY-6/ruling.md'] }],
  ];
  for (const [name, over] of bad) {
    it(`${name} gives false  [red if: this failure branch returns true]`, async () => {
      const { decide } = await mod();
      expect(await decide(fakeIo(over))).toBe(false);
    });
  }
  it('does not call diff when the anchor is disqualified  [red if: the ancestry gate is skipped]', async () => {
    const { decide } = await mod();
    let diffed = false;
    await decide(fakeIo({ isAncestor: () => false, diff: () => ((diffed = true), ['process/STATE.md']) }));
    expect(diffed).toBe(false);
  });
});

// ---- CLI against a real scratch repo and a fake gh -----------------------------------------------------------------
const G = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...G } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd: string, files: Record<string, string>, msg: string): string {
  for (const [p, c] of Object.entries(files)) {
    const f = join(cwd, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
    git(cwd, 'add', p);
  }
  git(cwd, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'anchor-'));
  const dir = join(root, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  const base = commit(dir, { 'README.md': 'x', 'packages/db/x.ts': 'export {};\n' }, 'base');
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const body = join(bin, 'out.json');
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh\nif [ -n "$FAKE_GH_EXIT" ]; then echo "gh: failed" >&2; exit "$FAKE_GH_EXIT"; fi\ncat "${body}"\n`);
  chmodSync(gh, 0o755);
  const gate = (sha: string) => writeFileSync(body, JSON.stringify({ workflow_runs: [{ ...goodRun(), head_sha: sha }] }));
  const cli = (head: string, prBase: string, env: Record<string, string> = {}) =>
    node('anchor.mjs', { cwd: dir, env: { PATH: `${bin}:${process.env.PATH ?? ''}`, ...G, GH_TOKEN: 'x', EVENT_NAME: 'pull_request', REPO: 'o/r', HEAD_REF: 'feature/x', PR_HEAD: head, PR_BASE: prBase, ...env } });
  return { dir, body, base, gate, cli };
}
const lines = (s: string) => s.split('\n').filter(Boolean);

describe('anchor.mjs CLI: real repo, fake gh (criterion 9, C14, C16)', () => {
  it('prints exactly `ledger_only=true` for ledger-only commits after a green anchor, exit 0', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's', 'process/cairn/issues/POLY-9.md': 'i', 'process/DECISIONS.md': 'd' }, 'bookkeeping');
    s.gate(a);
    const r = s.cli(head, s.base);
    expect(r.code).toBe(0);
    expect(lines(r.stdout)).toEqual(['ledger_only=true']);
  });
  it('false when a code path changed after the anchor', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's', 'packages/db/y.ts': 'export const z = 1;\n' }, 'mixed');
    s.gate(a);
    const r = s.cli(head, s.base);
    expect(r.code).toBe(0);
    expect(lines(r.stdout)).toEqual(['ledger_only=false']);
  });
  it('false when a rename moves a code path into the ledger (the diff passes --no-renames)  [red if: renames are detected, hiding the source path]', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/moved.ts': 'export const moved = 1;\n'.repeat(20) }, 'code');
    mkdirSync(join(s.dir, 'process/cairn/issues'), { recursive: true });
    git(s.dir, 'mv', 'packages/db/moved.ts', 'process/cairn/issues/moved.md');
    git(s.dir, 'commit', '-q', '-m', 'rename into ledger');
    s.gate(a);
    const r = s.cli(git(s.dir, 'rev-parse', 'HEAD'), s.base);
    expect(lines(r.stdout)).toEqual(['ledger_only=false']);
  });
  it('false after a merge from main (PR base is no longer an ancestor of the anchor)', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    git(s.dir, 'checkout', '-q', 'main');
    const m = commit(s.dir, { 'README.md': 'moved on' }, 'main moves');
    git(s.dir, 'checkout', '-q', 'feature/x');
    git(s.dir, 'merge', '-q', '--no-edit', 'main');
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'bookkeeping');
    s.gate(a);
    expect(lines(s.cli(head, m).stdout)).toEqual(['ledger_only=false']);
  });
  it('false when the anchor is not in the clone', () => {
    const s = scratch();
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'bookkeeping');
    s.gate('d'.repeat(40));
    expect(lines(s.cli(head, s.base).stdout)).toEqual(['ledger_only=false']);
  });
  it('false when the anchor is not an ancestor of HEAD (a rebase)', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    git(s.dir, 'reset', '-q', '--hard', s.base);
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'rebased bookkeeping');
    s.gate(a);
    expect(lines(s.cli(head, s.base).stdout)).toEqual(['ledger_only=false']);
  });
  it('false and exit 0 when gh fails  [red if: a failed lookup adds a skip or turns the step red]', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'bookkeeping');
    s.gate(a);
    const r = s.cli(head, s.base, { FAKE_GH_EXIT: '1' });
    expect(r.code).toBe(0);
    expect(lines(r.stdout)).toEqual(['ledger_only=false']);
  });
  it('false and exit 0 when gh prints bad JSON', () => {
    const s = scratch();
    commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'bookkeeping');
    writeFileSync(s.body, '{not json');
    const r = s.cli(head, s.base);
    expect(r.code).toBe(0);
    expect(lines(r.stdout)).toEqual(['ledger_only=false']);
  });
  it('false for a workflow_dispatch event even with a sound anchor', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's' }, 'bookkeeping');
    s.gate(a);
    expect(lines(s.cli(head, s.base, { EVENT_NAME: 'workflow_dispatch' }).stdout)).toEqual(['ledger_only=false']);
  });
  it('--ledger-tests prints LEDGER_TESTS one per line', () => {
    const r = node('anchor.mjs', { args: ['--ledger-tests'] });
    expect(r.code).toBe(0);
    expect(lines(r.stdout).sort()).toEqual(['test_check_budgets.py', 'test_dashboard_roster.py', 'test_ruling_archive_records.py', 'test_state_releases_bound.py']);
  });
});

describe('anchor.mjs CLI: hostile names, symlinks and gitlinks (C16 S1, C22 S5)', () => {
  it('a ledger-only diff plus a code path with a non-ASCII name (quoted by default git) is false', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/STATE.md': 's', 'packages/db/sql/café.sql': 'select 1;\n' }, 'mixed');
    s.gate(a);
    expect(lines(s.cli(head, s.base).stdout)).toEqual(['ledger_only=false']);
  });
  it('a ledger-only diff with a non-ASCII ledger name is still true: names reach the matcher literal, not quoted  [red if: git quotePath output is matched]', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    const head = commit(s.dir, { 'process/cairn/issues/café.md': 'i' }, 'ledger');
    s.gate(a);
    expect(lines(s.cli(head, s.base).stdout)).toEqual(['ledger_only=true']);
  });
  it('a symlink under the ledger is false (mode 120000)  [red if: modes are not checked]', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    mkdirSync(join(s.dir, 'process/cairn/issues'), { recursive: true });
    symlinkSync('../../../packages/db/y.ts', join(s.dir, 'process/cairn/issues/link.md'));
    git(s.dir, 'add', 'process/cairn/issues/link.md');
    git(s.dir, 'commit', '-q', '-m', 'symlink');
    s.gate(a);
    expect(lines(s.cli(git(s.dir, 'rev-parse', 'HEAD'), s.base).stdout)).toEqual(['ledger_only=false']);
  });
  it('a gitlink under the ledger is false (mode 160000)', () => {
    const s = scratch();
    const a = commit(s.dir, { 'packages/db/y.ts': 'export {};\n' }, 'code');
    git(s.dir, 'update-index', '--add', '--cacheinfo', `160000,${a},process/cairn/issues/sub`);
    git(s.dir, 'commit', '-q', '-m', 'gitlink');
    s.gate(a);
    expect(lines(s.cli(git(s.dir, 'rev-parse', 'HEAD'), s.base).stdout)).toEqual(['ledger_only=false']);
  });
  it('the real tree holds no symlink or gitlink (so the C22 rule never changes a real decision today)', () => {
    const r = spawnSync('git', ['ls-files', '-s'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter((l) => /^(120000|160000) /.test(l))).toEqual([]);
  });
});

// C23 (seceng S6): nothing a runner executes is discovered under a LEDGER path.
describe('C23: no test discovery reaches a ledger path', () => {
  const globRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?') + '$');
  const PROBES = ['process/cairn/issues/x.test.ts', 'process/cairn/reviews/POLY-1/x.test.ts', 'process/STATE.test.ts', 'process/cairn/issues/test_x.py'];
  it('the matcher can fail: **/*.test.ts matches a ledger-directory probe (control)', () => {
    expect(PROBES.some((p) => globRe('**/*.test.ts').test(p))).toBe(true);
    expect(PROBES.some((p) => globRe('tests/ci/**/*.test.ts').test(p))).toBe(false);
  });
  it('no vitest include in the repo matches a ledger probe', () => {
    const files = ['apps/web/vitest.config.ts', 'tests/ci/vitest.config.ts', 'tests/config/vitest.config.ts', 'tests/db/vitest.config.ts', 'tests/infra/vitest.config.ts', 'tests/infra/vitest.image.config.ts'];
    const globs = files.flatMap((f) => [...readFileSync(join(ROOT, f), 'utf8').matchAll(/include:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]!)));
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) for (const p of PROBES) expect(globRe(g).test(p), `${g} vs ${p}`).toBe(false);
  });
  it('run_tests.py discovers only scripts/cairn/tests and tests/workflow; pnpm-workspace.yaml globs stay out of process/', () => {
    const rt = readFileSync(join(ROOT, 'scripts/cairn/run_tests.py'), 'utf8');
    expect(rt).toMatch(/^TESTS_DIR = SCRIPT_DIR \/ "tests"$/m);
    expect(rt).toMatch(/^WORKFLOW_TESTS_DIR = SCRIPT_DIR\.parent\.parent \/ "tests" \/ "workflow"$/m);
    const roots = /def _discovery_roots\(\)[\s\S]*?return roots/.exec(rt)?.[0] ?? '';
    expect(roots).not.toMatch(/process/);
    const ws = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n').filter((l) => /^\s+-\s+\S/.test(l) && !l.includes(':'));
    for (const l of ws) expect(l, l).not.toMatch(/process\//);
  });
});

describe('changes.mjs --none (C15)', () => {
  it('prints every key false: TABLE keys plus the four area keys, nothing else, exit 0  [red while --none is absent]', () => {
    const r = node('changes.mjs', { args: ['--none'] });
    expect(r.code).toBe(0);
    expect(lines(r.stdout).sort()).toEqual(['ci=false', 'db=false', 'e2e=false', 'db_auth=false', 'db_migrate=false', 'db_ops=false', 'db_tenancy=false', 'image=false', 'layers=false', 'node=false']);
  });
});
