// POLY-101 B2 (ruling process/cairn/reviews/POLY-101/ruling.md §3, §6 V3; seceng build condition (e)): infra/ci/auth-row.mjs, the
// proof that the auth row's files RAN. Contract: `auth-row.mjs lint|db`; env VITEST_JSON (vitest's JSON report) and, for `db`,
// DB_AUTH exactly `true` (check) or `false` (exit 0); exit 0 green, 1 red, the reason on stderr; the repo root is two levels above
// the script, with no override. The script is copied into a temporary root, so each case controls the three source files it reads.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ci, ROOT } from './helpers.ts';

const LINT = 'packages/auth/src/boundaries.test.ts';
const RP = 'tests/db/auth-route-policy.test.ts';
const POOL = 'tests/db/auth-routing-pool.test.ts';
const SOURCES = [LINT, RP, POOL];
// Floors are measured counts (vitest, tests-red). Raising a suite does not need an edit here; lowering a floor does.
const FLOOR: Record<string, number> = { [LINT]: 9, [RP]: 26, [POOL]: 19 };

const LIVE = 'every HTTP route of the instance is in AUTH_ROUTES and every entry is live, naming the path  [red if: a plugin or version adds a route unclassified, or the map keeps a dead entry]';
const MODES = ['route policy, real-domain mode', 'route policy, private-ca mode'];
const CONTROL = 'route policy control: a synthetic plugin (POLY-101)';
const CONTROL_TITLES = [
  'the predicate names both synthetic routes against AUTH_ROUTES, and nothing once both are listed  [red if: the predicate filters on isAction, or names nothing]',
  'both synthetic routes answer 404 while unlisted, and each of the two refusals holds on its own  [red if: the hook lets an unlisted path through, or the handler passes a path no template matches]',
];
const REQUIRED: [string, string][] = [...MODES.map((m): [string, string] => [m, LIVE]), ...CONTROL_TITLES.map((t): [string, string] => [CONTROL, t])];

type A = { ancestorTitles: string[]; title: string; fullName: string; status: string };
const row = (describeName: string, title: string, status = 'passed'): A => ({ ancestorTitles: [describeName], title, fullName: `${describeName} ${title}`, status });
const filler = (n: number): A[] => Array.from({ length: n }, (_, i) => row('other', `case ${i}`));
/** A passing result list for one file, exactly `n` long. RP carries the required titles. */
const passing = (file: string, n = FLOOR[file]!): A[] => (file === RP ? [...REQUIRED.map(([d, t]) => row(d, t)), ...filler(n - REQUIRED.length)] : filler(n));
type Results = Record<string, A[]>;
const good = (mode: 'lint' | 'db'): Results =>
  mode === 'lint' ? { [LINT]: passing(LINT) } : { [RP]: passing(RP), [POOL]: passing(POOL), 'tests/db/checks.test.ts': [row('checks', 'another file of the battery', 'skipped')] };

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tree(sources: Record<string, string | null> = {}): string {
  const script = ci('auth-row.mjs');
  if (!existsSync(script)) throw new Error('infra/ci/auth-row.mjs does not exist');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'auth-row-')));
  roots.push(root);
  mkdirSync(join(root, 'infra/ci'), { recursive: true });
  copyFileSync(script, join(root, 'infra/ci/auth-row.mjs'));
  for (const f of SOURCES) {
    // The default is the REAL source, so every green case also shows the scan has no false positive on today's files.
    const text = f in sources ? sources[f] : readFileSync(join(ROOT, f), 'utf8');
    if (text === null || text === undefined) continue;
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}
type Opt = { env?: Record<string, string>; args?: string[]; sources?: Record<string, string | null>; raw?: string | null; at?: (root: string, file: string) => string; list?: [string, A[]][] };
function run(mode: string, results: Results, o: Opt = {}) {
  const root = tree(o.sources);
  const report = join(root, 'report.json');
  const list = o.list ?? Object.entries(results);
  const json = JSON.stringify({ success: true, testResults: list.map(([f, a]) => ({ name: (o.at ?? ((r, x) => join(r, x)))(root, f), status: 'passed', assertionResults: a })) });
  if (o.raw !== null) writeFileSync(report, o.raw ?? json);
  const env = { VITEST_JSON: report, ...(mode === 'db' ? { DB_AUTH: 'true' } : {}), ...(o.env ?? {}) };
  const r = spawnSync('node', [join(root, 'infra/ci/auth-row.mjs'), ...(o.args ?? [mode])], { cwd: tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** Red means exit 1 AND the named reason: a crash for another cause is not a pass. */
const red = (r: ReturnType<typeof run>, ...reasons: (string | RegExp)[]) => {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  for (const x of reasons) expect(r.stderr).toMatch(typeof x === 'string' ? new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : x);
  expect(r.stderr, 'a stack trace is a crash, not a refusal').not.toMatch(/^\s+at .+:\d+:\d+/m);
};
const green = (r: ReturnType<typeof run>) => expect(r.code, r.stderr).toBe(0);
const change = (res: Results, file: string, i: number, patch: Partial<A>): Results => ({ ...res, [file]: res[file]!.map((a, k) => (k === i ? { ...a, ...patch } : a)) });

describe('auth-row.mjs: green on a good report', () => {
  it('lint: boundaries.test.ts passed at its floor -> 0, one line naming the file and counts (V8)', () => {
    const r = run('lint', good('lint'));
    green(r);
    expect(r.stdout).toContain(`auth-row: ${LINT} 9 passed (floor 9)`);
  });
  it('db: RP and POOL passed at their floors -> 0, a line each; a skip in another battery file is not this row\'s business', () => {
    const r = run('db', good('db'));
    green(r);
    expect(r.stdout).toContain(`auth-row: ${RP} 26 passed (floor 26)`);
    expect(r.stdout).toContain(`auth-row: ${POOL} 19 passed (floor 19)`);
  });
  it('above the floor stays green', () => { green(run('db', { ...good('db'), [POOL]: passing(POOL, 30) })); });
  it('DB_AUTH=false -> 0 and the report is not read', () => {
    const r = run('db', {}, { env: { DB_AUTH: 'false' }, raw: null });
    green(r);
    expect(r.stdout).toContain('db_auth false');
  });
});

describe('auth-row.mjs: ran is not skipped', () => {
  for (const [mode, file] of [['lint', LINT], ['db', RP], ['db', POOL]] as const) {
    for (const status of ['skipped', 'todo', 'pending', 'failed', 'disabled']) {
      it(`${file}: one assertion ${status} (above the floor otherwise) -> red`, () => {
        const res = { ...good(mode), [file]: [...passing(file), row('other', 'extra', status)] };
        red(run(mode, res), file, status);
      });
    }
    it(`${file}: one passing test below the floor -> red`, () => {
      const res = { ...good(mode), [file]: passing(file).slice(0, -1) };
      red(run(mode, res), file, String(FLOOR[file]));
    });
    it(`${file}: emptied -> red`, () => { red(run(mode, { ...good(mode), [file]: [] }), file); });
    it(`${file}: absent from the report (renamed or filtered out) -> red`, () => {
      const res = { ...good(mode) };
      delete res[file];
      red(run(mode, res), file);
    });
    it(`${file}: twice in the report -> red`, () => {
      red(run(mode, {}, { list: [...Object.entries(good(mode)), [file, passing(file)]] }), file);
    });
  }
  it('a skipped required title (it.skip on the live-route test) -> red even with the floor met by other tests', () => {
    const res = good('db');
    res[RP] = [...res[RP]!.map((a, i) => (i === 0 ? { ...a, status: 'skipped' } : a)), row('other', 'one more')];
    red(run('db', res), RP, 'skipped');
  });
  it('the files are matched by exact repo-relative path: a worktree copy of each does not count', () => {
    red(run('db', good('db'), { at: (r, f) => join(r, '.claude/worktrees/x', f) }), RP);
    red(run('lint', good('lint'), { at: (r, f) => join(r, 'vendor', f) }), LINT);
  });
  it('a report path outside the root with the same tail does not count', () => {
    red(run('lint', good('lint'), { at: (_r, f) => join('/home/runner/other', f) }), LINT);
  });
});

describe('auth-row.mjs: required titles', () => {
  const without = (i: number) => {
    const res = good('db');
    res[RP] = [...res[RP]!.filter((_, k) => k !== i), row('other', 'filler for the floor')];
    return res;
  };
  REQUIRED.forEach(([d, t], i) => {
    it(`missing "${d}" > "${t.slice(0, 60)}..." -> red (floor still met)`, () => { red(run('db', without(i)), RP, d, t.slice(0, 60)); });
  });
  it('one TLS mode only, run twice -> red (the other mode never ran)', () => {
    const res = change(good('db'), RP, 1, { ancestorTitles: [MODES[0]!] });
    red(run('db', res), MODES[1]!);
  });
  it('a required title that is only a prefix match -> red', () => {
    red(run('db', change(good('db'), RP, 0, { title: LIVE.split('  [')[0]! })), RP, LIVE.slice(0, 60));
  });
  it('the required titles are the ones RP declares  [red if: RP is retitled without the script]', () => {
    const src = readFileSync(join(ROOT, RP), 'utf8').replaceAll("\\'", "'");
    for (const t of [LIVE, ...CONTROL_TITLES, CONTROL]) expect(src).toContain(t);
    expect(src).toContain("describe.each(modes)('route policy, %s mode'");
  });
});

describe('auth-row.mjs: a failing test reported as passed (seceng, vitest JSON)', () => {
  const planted: [string, string][] = [
    ['it.fails', "it.fails('x', () => {});"],
    ['test.fails', "test.fails('x', () => {});"],
    ['describe.fails', "describe.fails('x', () => {});"],
    ['it.concurrent.fails', "it.concurrent.fails('x', () => {});"],
    ['it.fails.each', "it.fails.each([1])('x %s', () => {});"],
    ['it.fails on a new line', "it\n  .fails('x', () => {});"],
    ['.fails after a call in the chain (runIf)', "it.runIf(true).fails('x', () => {});"],
    ['.fails after a call in the chain (skipIf)', "test.skipIf(process.env.NEVER === '1').fails('x', () => {});"],
    ['a fails: option', "it('x', { fails: true }, () => {});"],
    ['a fails: option on describe, spaced', "describe('x', { timeout: 1, fails : true }, () => {});"],
  ];
  for (const [mode, file] of [['lint', LINT], ['db', RP], ['db', POOL]] as const) {
    for (const [name, code] of planted) {
      it(`${file}: ${name} in the source -> red with a good report`, () => {
        const text = `${readFileSync(join(ROOT, file), 'utf8')}\n${code}\n`;
        red(run(mode, good(mode), { sources: { [file]: text } }), file, /fails/);
      });
    }
    it(`${file}: source missing -> red`, () => { red(run(mode, good(mode), { sources: { [file]: null } }), file); });
  }
});

describe('auth-row.mjs: fails closed', () => {
  for (const mode of ['lint', 'db'] as const) {
    it(`${mode}: report file missing -> red`, () => { red(run(mode, {}, { raw: null }), /report\.json|VITEST_JSON/); });
    it(`${mode}: VITEST_JSON empty -> red`, () => { red(run(mode, good(mode), { env: { VITEST_JSON: '' } }), 'VITEST_JSON'); });
    for (const [name, raw] of [['empty', ''], ['not JSON', '{nope'], ['no testResults', '{}'], ['testResults not an array', '{"testResults":{}}'], ['null', 'null']]) {
      it(`${mode}: report ${name} -> red`, () => { red(run(mode, {}, { raw }), /report|VITEST_JSON/); });
    }
  }
  for (const v of ['', 'TRUE', 'yes', '1', 'false ', 'False']) {
    it(`DB_AUTH=${JSON.stringify(v)} -> red even with a good report`, () => { red(run('db', good('db'), { env: { DB_AUTH: v } }), 'DB_AUTH'); });
  }
  it('DB_AUTH unset -> red', () => {
    const root = tree();
    const r = spawnSync('node', [join(root, 'infra/ci/auth-row.mjs'), 'db'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', VITEST_JSON: join(root, 'none.json') } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/DB_AUTH/);
  });
  for (const args of [[], ['unit'], ['LINT'], ['db', 'lint']]) {
    it(`arguments ${JSON.stringify(args)} -> red`, () => {
      const r = run('db', good('db'), { args });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/lint\|db|usage/i);
    });
  }
});

describe('auth-row.mjs: its table', () => {
  it('ROWS names the three files by exact path, with the measured floors  [red if: a floor is lowered or a file dropped]', async () => {
    const m = (await import(ci('auth-row.mjs'))) as { ROWS: Record<string, { file: string; floor: number }[]> };
    expect(Object.fromEntries(Object.entries(m.ROWS).map(([k, v]) => [k, v.map((x) => [x.file, x.floor])]))).toEqual({ lint: [[LINT, 9]], db: [[RP, 26], [POOL, 19]] });
  });
  it('imports node built-ins only', () => {
    const src = readFileSync(ci('auth-row.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((x) => x[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i).toMatch(/^node:/);
  });
});
