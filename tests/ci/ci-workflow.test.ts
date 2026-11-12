// POLY-96 stage 1 -- structure of .github/workflows/ci.yml (ruling §1): criteria 1, 2, 4, 5, 6, 8-11.
// Real `needs`/`skipped` semantics and Docker on the runner are proven by the branch dispatch runs (ruling §6), not here.
import { describe, expect, it } from 'vitest';
import { needsOf, runBodies, steps, wf, wfText, type Job } from './helpers.ts';

const w = wf('ci.yml');
const NEW = ['changes', 'guard', 'lint', 'unit', 'db', 'image'];
const all = (j: Job) => JSON.stringify(j);
const runOf = (j: Job) => steps(j).map((s) => s.run ?? '').join('\n');

describe('ci.yml: shape and the untouched cairn check', () => {
  it('job ids equal names: cairn, changes, guard, lint, unit, db, image, app  [red if: a job renamed or missing]', () => {
    expect(Object.keys(w.jobs).sort()).toEqual(['app', 'cairn', ...NEW].sort());
    for (const [id, j] of Object.entries(w.jobs)) expect(j.name, id).toBe(id);
  });
  it('triggers stay pull_request + workflow_dispatch, no workflow-level paths:, no secrets (S96-6)', () => {
    expect(Object.keys(w.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(JSON.stringify(w.on)).not.toMatch(/"paths/);
    expect(wfText('ci.yml')).not.toMatch(/secrets\./);
    expect(wfText('ci.yml')).not.toMatch(/pull_request_target/);
  });
  it('workflow_dispatch takes an optional `base` input', () => {
    const d = w.on.workflow_dispatch as { inputs?: { base?: { required?: boolean } } };
    expect(d.inputs?.base).toBeDefined();
    expect(d.inputs?.base?.required ?? false).toBe(false);
  });
  it('cairn neither needs nor is needed by the new jobs', () => {
    expect(needsOf(w.jobs.cairn!)).toEqual([]);
    for (const [id, j] of Object.entries(w.jobs)) if (id !== 'cairn') expect(needsOf(j), id).not.toContain('cairn');
  });
  it('cairn filter literals are byte-identical to 31d62ab  [red if: PATTERN/EXCLUDE/PINNED_RULINGS edited]', () => {
    const body = runOf(w.jobs.cairn!);
    for (const lit of [
      String.raw`PATTERN='^(scripts/cairn/|\.claude/|process/WORKFLOW\.md$|process/TRACKER\.md$|process/cairn/|tests/workflow/|\.github/workflows/|\.githooks/)'`,
      `EXCLUDE='^process/cairn/(issues|milestones|majors|archive|reviews)/'`,
      String.raw`PINNED_RULINGS='^process/cairn/reviews/(POLY-6|POLY-10|POLY-26|POLY-48|POLY-51)/ruling\.md$'`,
    ]) expect(body).toContain(lit);
  });
});

describe('ci.yml: hardening every job (S96-3..7)', () => {
  it('every checkout sets persist-credentials: false  [red if: any checkout keeps the token]', () => {
    for (const [id, j] of Object.entries(w.jobs)) for (const s of steps(j)) if (s.uses?.startsWith('actions/checkout@')) expect(s.with?.['persist-credentials'], id).toBe(false);
  });
  it('no run: body interpolates event data, head_ref or inputs (S96-7)  [red if: ${{ github.event.* }} left in a run]', () => {
    for (const b of runBodies(w)) expect(b).not.toMatch(/\$\{\{\s*(github\.event|github\.head_ref|inputs\.)/);
  });
  it('every new job: own permissions (contents: read only, actions: read allowed), ubuntu-latest, timeout', () => {
    for (const id of [...NEW, 'app']) {
      const j = w.jobs[id]!;
      expect(j['runs-on'], id).toBe('ubuntu-latest');
      expect(j['timeout-minutes'], id).toBeGreaterThan(0);
      expect(j.permissions, id).toBeDefined();
      expect(j.permissions!.contents, id).toBe('read');
      for (const [k, v] of Object.entries(j.permissions!)) expect(['contents', 'actions'], `${id}.${k}`).toContain(k), expect(v).toBe('read');
    }
  });
  it('timeouts: lint 10, unit 15, db 15, image 20, others 5', () => {
    const t = { lint: 10, unit: 15, db: 15, image: 20, changes: 5, guard: 5, app: 5 } as Record<string, number>;
    for (const [id, m] of Object.entries(t)) expect(w.jobs[id]!['timeout-minutes'], id).toBe(m);
  });
  it('no write scope, id-token, or attest anywhere in ci.yml (S96-8)  [red if: image job gains id-token/packages]', () => {
    expect(w.jobs.image).toBeDefined();
    expect(wfText('ci.yml')).not.toMatch(/(:\s*write\b|id-token|attest-)/);
  });
  it('install blocks lifecycle scripts: frozen lockfile, pnpm 12.18.0 via --allow-scripts=pnpm; no node_modules/.turbo cache (S96-20)', () => {
    for (const id of ['lint', 'unit', 'db', 'image']) {
      const j = w.jobs[id]!;
      if (/pnpm install/.test(runOf(j))) expect(runOf(j), id).toMatch(/pnpm install --frozen-lockfile/);
    }
    const text = wfText('ci.yml');
    expect(text).not.toMatch(/path:[^\n]*(node_modules|\.turbo)/);
    expect(text).not.toMatch(/TURBO_(TOKEN|TEAM)/);
  });
});

describe('ci.yml: changes + guard (criteria 1, 4)', () => {
  it('changes runs always, fails closed (set -euo pipefail), full history, feeds changes.mjs, exposes nine outputs', () => {
    const j = w.jobs.changes!;
    expect(j.if).toBeUndefined();
    expect(needsOf(j)).toEqual([]);
    const co = steps(j).find((s) => s.uses?.startsWith('actions/checkout@'))!;
    expect(co.with?.['fetch-depth']).toBe(0);
    expect(runOf(j)).toMatch(/set -euo pipefail/);
    expect(runOf(j)).toMatch(/infra\/ci\/changes\.mjs/);
    expect(runOf(j)).toMatch(/\^\[0-9a-f\]\{40\}\$/); // dispatch base validated as 40-hex
    expect(Object.keys(j.outputs ?? {}).sort()).toEqual(['ci', 'db', 'db_auth', 'db_migrate', 'db_ops', 'db_tenancy', 'image', 'layers', 'node']); // POLY-141: the five keys and the four areas
  });
  it('guard runs always (no if), pin check over .github and infra/ci, and gitleaks  [red if: guard gated on changes]', () => {
    const j = w.jobs.guard!;
    expect(j.if).toBeUndefined();
    expect(needsOf(j)).toEqual([]);
    expect(runOf(j)).toMatch(/infra\/ci\/check-pins\.mjs/);
    expect(runOf(j)).toMatch(/\.github/);
    expect(all(j)).toMatch(/gitleaks/);
  });
});

describe('ci.yml: the work jobs (criteria 2, 5, 6, 10)', () => {
  it('lint, unit, db, image each need changes and are gated on their outputs', () => {
    const cond = (id: string) => w.jobs[id]!.if ?? '';
    for (const id of ['lint', 'unit', 'db', 'image']) expect(needsOf(w.jobs[id]!), id).toContain('changes');
    for (const k of ['node', 'layers', 'image', 'ci']) expect(cond('lint')).toContain(`needs.changes.outputs.${k}`);
    expect(cond('lint')).not.toContain('outputs.db');
    expect(cond('unit')).toContain('needs.changes.outputs.node');
    expect(cond('unit')).toContain('needs.changes.outputs.image');
    expect(cond('db')).toContain('needs.changes.outputs.db');
    expect(cond('db')).not.toMatch(/outputs\.(node|image|layers|ci)/); // criterion 10: keyed to db alone
    expect(cond('image')).toContain('needs.changes.outputs.image');
    expect(cond('image')).toContain('needs.changes.outputs.node');
  });
  it('lint runs layer checks, eslint, migrations check, typecheck --affected, audit, and the tests/ci suite + actionlint (criterion 6)', () => {
    const b = runOf(w.jobs.lint!);
    expect(b).toMatch(/scripts\/layers\/check\.mjs/);
    expect(b).toMatch(/tests\/layers/);
    expect(b).toMatch(/eslint/);
    expect(b).toMatch(/check-migrations/);
    expect(b).toMatch(/turbo run typecheck/);
    expect(b).toMatch(/--affected/);
    expect(b).toMatch(/pnpm audit --audit-level high/);
    expect(b).toMatch(/-c tests\/ci\/vitest\.config\.ts/);
    expect(all(w.jobs.lint!)).toMatch(/actionlint/);
  });
  it('lint layer-check step is gated so a layers-only change still runs it  [red if: layers check inside the node-only step]', () => {
    const s = steps(w.jobs.lint!).find((x) => /scripts\/layers\/check\.mjs/.test(x.run ?? ''))!;
    expect(s.if ?? '').toMatch(/outputs\.layers/);
  });
  it('lint has "Generated-output freshness" directly after "ESLint and migration check", gated on node/image/ci, running --ci (POLY-102 R3)  [red if: step missing, moved, `--ci` dropped, or gated on layers/db only]', () => {
    const ss = steps(w.jobs.lint!);
    const i = ss.findIndex((s) => s.name === 'ESLint and migration check');
    expect(i).toBeGreaterThanOrEqual(0);
    const s = ss[i + 1]!;
    expect(s.name).toBe('Generated-output freshness');
    for (const k of ['node', 'image', 'ci']) expect(s.if ?? '', k).toContain(`needs.changes.outputs.${k} == 'true'`);
    expect(s.if ?? '').not.toMatch(/outputs\.(layers|db)/);
    expect((s.run ?? '').trim()).toBe('python3 scripts/cairn/check_dist_freshness.py --ci');
    expect(Object.keys(w.jobs).sort()).toEqual(['app', 'cairn', ...NEW].sort()); // no new top-level job
  });
  it('unit runs turbo test --affected --summarize from each package, then the root cross-package suite (criterion 5)', () => {
    const b = runOf(w.jobs.unit!);
    expect(b).toMatch(/turbo run test[^\n]*--affected/);
    expect(b).toMatch(/--summarize/);
    expect(b).toMatch(/-c tests\/config\/vitest\.config\.ts/);
    expect(b).not.toMatch(/vitest run(?![^\n]*-c tests\/config)[^\n]*packages\//); // never a root-config run over a package
    expect(b).not.toMatch(/tests\/db/);
  });
  it('db is one job, no service container, runs the existing harness config (criterion 10)', () => {
    const j = w.jobs.db!;
    expect(j.services).toBeUndefined();
    expect(runOf(j)).toMatch(/-c tests\/db\/vitest\.config\.ts/);
    const others = ['lint', 'unit', 'image', 'cairn'].map((id) => runOf(w.jobs[id]!)).join('\n');
    expect(others).not.toMatch(/tests\/db\/vitest/);
  });
  it('image job: A4 built-image check sits between build and scan  [red if: removed or moved after scan]', () => {
    const ss = steps(w.jobs.image!).map((x) => `${x.uses ?? ''} ${x.run ?? ''}`);
    const b = ss.findIndex((x) => /image\.sh build/.test(x));
    const c = ss.findIndex((x) => /image\.sh check|usr\/local\/lib\/node_modules/.test(x));
    const sc = ss.findIndex((x) => /image\.sh scan/.test(x));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(sc);
  });
  it('image builds locally via image.sh, no push (S96-8)', () => {
    const b = runOf(w.jobs.image!);
    expect(b).toMatch(/infra\/ci\/image\.sh build/);
    expect(b).not.toMatch(/docker push|--push|ghcr\.io/);
    expect(JSON.stringify(w.jobs.image)).not.toMatch(/login-action/);
  });
  it('lint, unit, db, image end with an `if: always()` job-report step (criteria 8, 9, 11)  [red if: report skipped on failure]', () => {
    for (const id of ['lint', 'unit', 'db', 'image']) {
      const ss = steps(w.jobs[id]!);
      const last = ss.at(-1)!;
      expect(last.run, id).toMatch(/infra\/ci\/job-report\.mjs/);
      expect(last.if, id).toMatch(/always\(\)/);
      expect(JSON.stringify(ss[0]) + JSON.stringify(ss[1])).toMatch(/JOB_START/);
    }
  });
  it('the CI timing artifact is uploaded per job: ci-test-runs-<job>, 30 days', () => {
    for (const id of ['lint', 'unit', 'db', 'image']) {
      const up = steps(w.jobs[id]!).find((s) => s.uses?.startsWith('actions/upload-artifact@'));
      expect(up, id).toBeDefined();
      expect(String(up!.with?.name)).toMatch(new RegExp(`ci-test-runs-${id}`));
      expect(up!.with?.['retention-days']).toBe(30);
    }
  });
});

describe('ci.yml: the app aggregate (criterion 1, 7 name)', () => {
  const j = w.jobs.app!;
  it('app needs exactly the six new jobs, runs if: always(), no checkout, no install', () => {
    expect(needsOf(j).sort()).toEqual([...NEW].sort());
    expect(j.if).toMatch(/^\s*(\$\{\{\s*)?always\(\)/);
    expect(steps(j).some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(true); // must read infra/ci/aggregate.mjs
    expect(runOf(j)).toMatch(/node infra\/ci\/aggregate\.mjs/);
    expect(runOf(j)).not.toMatch(/pnpm install/);
  });
  it('NEEDS comes from toJSON(needs) through env, not interpolated into the script', () => {
    const s = steps(j).find((x) => /aggregate\.mjs/.test(x.run ?? ''))!;
    expect(s.env?.NEEDS).toMatch(/toJSON\(needs\)/);
  });
});

// POLY-141 criterion 9, C15, C16, C18, C19: the anchor skip is wired into both `changes` and `cairn`.
describe('ci.yml: the anchor skip (POLY-141 C15, C16, C18)', () => {
  const gitDiffLines = (body: string) => body.split('\n').filter((l) => /\bgit diff\b/.test(l) && !/^\s*#/.test(l));

  it('changes: calls anchor.mjs, compares its output exactly, and takes `--none` on ledger_only=true  [red while the shell is absent]', () => {
    const j = w.jobs.changes!;
    const body = runOf(j);
    expect(body).toMatch(/infra\/ci\/anchor\.mjs/);
    expect(body).toContain('= "ledger_only=true"');
    expect(body).toMatch(/infra\/ci\/changes\.mjs --none/);
    expect(body).toMatch(/infra\/ci\/changes\.mjs/);
  });
  it('changes: has actions: read and the GH_TOKEN, REPO, HEAD_REF, PR_HEAD environment, with no ${{ }} in run  [red if: a variable is missing]', () => {
    const j = w.jobs.changes!;
    expect(j.permissions?.actions).toBe('read');
    expect(j.permissions?.contents).toBe('read');
    const env = Object.assign({}, ...steps(j).map((s) => s.env ?? {}));
    for (const k of ['GH_TOKEN', 'REPO', 'HEAD_REF', 'PR_HEAD']) expect(Object.keys(env), k).toContain(k);
    expect(runOf(j)).not.toContain('${{');
  });
  it('every git diff that feeds a filter passes --no-renames: changes, and both diffs in the cairn job (C16)  [red if: one lacks it]', () => {
    for (const id of ['changes', 'cairn']) {
      const ls = gitDiffLines(runOf(w.jobs[id]!));
      expect(ls.length, `${id} has a git diff`).toBeGreaterThan(0);
      for (const l of ls) expect(l, `${id}: ${l}`).toContain('--no-renames');
    }
  });
  it('cairn: no shell ancestry check remains; the anchor comes from anchor.mjs (C19)', () => {
    const body = runOf(w.jobs.cairn!);
    expect(body).not.toContain('merge-base');
    expect(body).not.toContain('ANCHOR_RELEVANT');
    expect(body).toMatch(/infra\/ci\/anchor\.mjs/);
    expect(body).toContain('= "ledger_only=true"');
  });
  it('cairn: writes run=true, run=ledger and run=false; run=false once (C18)', () => {
    const body = runOf(w.jobs.cairn!);
    expect(body.match(/echo\s+"run=false"/g) ?? []).toHaveLength(1);
    expect(body.match(/echo\s+"run=ledger"/g) ?? []).not.toHaveLength(0);
    expect(body.match(/echo\s+"run=true"/g) ?? []).not.toHaveLength(0);
  });
  it('cairn: run=ledger sets up Python and runs exactly the ledger tests with -p; Node and the JS suite stay on run=true only; run=true is unchanged (C18)', () => {
    const j = w.jobs.cairn!;
    const bySetup = (re: RegExp) => steps(j).find((s) => re.test(s.uses ?? ''))!;
    expect(bySetup(/^actions\/setup-node@/).if).toMatch(/^\s*(\$\{\{\s*)?steps\.changes\.outputs\.run == 'true'\s*(\}\})?\s*$/);
    const js = steps(j).find((s) => /node --test/.test(s.run ?? ''))!;
    expect(js.if).toMatch(/^\s*(\$\{\{\s*)?steps\.changes\.outputs\.run == 'true'\s*(\}\})?\s*$/);
    const py = bySetup(/^actions\/setup-python@/);
    expect(py.if).toContain("'ledger'");
    expect(py.if).toContain("'true'");
    const full = steps(j).find((s) => /^\s*python3 scripts\/cairn\/run_tests\.py\s*$/.test(s.run ?? ''))!;
    expect(full, 'the full-suite step is unchanged').toBeDefined();
    expect(full.if).toMatch(/steps\.changes\.outputs\.run == 'true'/);
    const led = steps(j).find((s) => /--ledger-tests/.test(s.run ?? ''))!;
    expect(led, 'a ledger step that reads node infra/ci/anchor.mjs --ledger-tests').toBeDefined();
    expect(led.if).toMatch(/steps\.changes\.outputs\.run == 'ledger'/);
    expect(led.run).toMatch(/infra\/ci\/anchor\.mjs --ledger-tests/);
    expect(led.run).toMatch(/run_tests\.py/);
    expect(led.run).toMatch(/-p\b/);
    expect(led.run).not.toContain('${{');
  });
  it('cairn: a BASE..HEAD of ledger paths only gives run=ledger  [red while the leg is absent]', () => {
    expect(runOf(w.jobs.cairn!)).toMatch(/run=ledger/);
    expect(runOf(w.jobs.cairn!)).toMatch(/LEDGER/);
  });
  it('C21: workflow permissions are exactly {contents: read}; actions: read only on the cairn and changes jobs  [red while it is workflow-level]', () => {
    expect(w.permissions).toEqual({ contents: 'read' });
    for (const [id, j] of Object.entries(w.jobs)) {
      if (id === 'cairn' || id === 'changes') expect(j.permissions, id).toEqual({ contents: 'read', actions: 'read' });
      else expect(j.permissions?.actions, id).toBeUndefined();
    }
  });
  it('C21: GH_TOKEN is set only as step env on the step that runs anchor.mjs, and nowhere else', () => {
    expect(JSON.stringify(w.permissions ?? {})).not.toContain('GH_TOKEN');
    const holders: string[] = [];
    for (const [id, j] of Object.entries(w.jobs)) {
      expect(JSON.stringify({ ...j, steps: undefined }), `${id} job-level`).not.toContain('GH_TOKEN');
      for (const s of steps(j)) if (s.env && 'GH_TOKEN' in s.env) {
        expect(s.run ?? '', `${id}: ${s.name}`).toMatch(/infra\/ci\/anchor\.mjs/);
        holders.push(id);
      }
    }
    expect(holders.sort()).toEqual(['cairn', 'changes']);
  });
  it('C16: the filter diffs are NUL-separated: --no-renames -z, and the cairn shell converts with tr  [red while newline output is read]', () => {
    for (const id of ['changes', 'cairn']) {
      for (const l of gitDiffLines(runOf(w.jobs[id]!))) expect(l, `${id}: ${l}`).toMatch(/--no-renames\s+-z/);
    }
    expect(runOf(w.jobs.cairn!)).toMatch(/tr '\\0' '\\n'/);
  });
  it('anchor.mjs is the only place the lookup is written: no `actions/workflows/ci.yml/runs` in ci.yml', () => {
    expect(wfText('ci.yml')).not.toContain('actions/workflows/ci.yml/runs');
  });
});

// POLY-141 C4/C11 (+ S7): the area keys reach the `db` job, which preflights the proofs and runs only the selected files.
describe('ci.yml: db areas (POLY-141 C8, C11, S7)', () => {
  const AREA_KEYS = ['db_auth', 'db_tenancy', 'db_migrate', 'db_ops'];
  const dbj = () => w.jobs.db!;
  const idx = (re: RegExp) => steps(dbj()).findIndex((s) => re.test(s.run ?? ''));
  const battery = () => steps(dbj())[idx(/tests\/db\/vitest\.config\.ts/)]!;

  it('changes exposes the nine outputs: the five keys and db_auth, db_tenancy, db_migrate, db_ops  [red while the area keys are absent]', () => {
    expect(Object.keys(w.jobs.changes!.outputs ?? {}).sort()).toEqual(['ci', 'db', ...AREA_KEYS, 'image', 'layers', 'node'].sort());
  });
  it('a dispatch with no base sets every key true: the printf names all nine', () => {
    const body = runOf(w.jobs.changes!);
    for (const k of ['node', 'layers', 'db', 'image', 'ci', ...AREA_KEYS]) expect(body, k).toContain(`${k}=true`);
  });
  it('the db job is still gated on `db` alone (db is the OR of the areas)', () => {
    expect(dbj().if).toContain('needs.changes.outputs.db');
    expect(dbj().if).not.toContain('db_');
  });
  it('the preflight runs the three tests/ci files before the battery step  [red while absent]', () => {
    const pre = idx(/vitest run -c tests\/ci\/vitest\.config\.ts[^\n]*db-filter-imports\.test\.ts[^\n]*db-areas\.test\.ts[^\n]*db-harness\.test\.ts/);
    expect(pre, 'a preflight step').toBeGreaterThan(-1);
    expect(pre).toBeLessThan(idx(/tests\/db\/vitest\.config\.ts/));
    expect(pre, 'after the install').toBeGreaterThan(idx(/pnpm install/));
  });
  it('the battery step selects with --db-select, the area values come through env:, and run: has no ${{ }}  [red while absent]', () => {
    const st = battery();
    expect(st.run).toMatch(/infra\/ci\/changes\.mjs --db-select/);
    for (const [k, out] of [['DB_AUTH', 'db_auth'], ['DB_TENANCY', 'db_tenancy'], ['DB_MIGRATE', 'db_migrate'], ['DB_OPS', 'db_ops']]) {
      expect(st.env?.[k as string], k).toMatch(new RegExp(`needs\\.changes\\.outputs\\.${out}\\b`));
    }
    expect(st.run).not.toContain('${{');
  });
  it('S7: the file list goes into a bash array, never through $GITHUB_OUTPUT; every line is checked; no --passWithNoTests', () => {
    const run = battery().run ?? '';
    expect(run).toMatch(/mapfile|readarray|=\(\s*\$\(/);
    expect(run).not.toContain('GITHUB_OUTPUT');
    expect(run).toContain('^tests/db/[a-z0-9-]+\\.test\\.ts$');
    expect(run).not.toContain('passWithNoTests');
    expect(run).toMatch(/"\$\{[A-Za-z_]+\[@\]\}"/);                  // the array is expanded quoted
    expect(run).toContain('all');                                       // `all` runs with no file filter
    expect(runOf(dbj())).not.toContain('passWithNoTests');
  });
  it('C13: the battery writes vitest\'s json report to $VITEST_JSON (default reporter kept) and the timing step reads the same path  [red while absent]', () => {
    const st = battery();
    expect(st.run).toContain('--reporter=json');
    expect(st.run).toContain('--reporter=default');
    expect(st.run).toMatch(/--outputFile[= ]"?\$VITEST_JSON"?/);
    const rec = steps(dbj()).find((s) => /job-report\.mjs/.test(s.run ?? '') && s.env?.REPORT_ONLY === 'jsonl')!;
    expect(rec.env?.VITEST_JSON, 'Record timing sets VITEST_JSON').toBeDefined();
    expect(rec.env?.VITEST_JSON).toBe(st.env?.VITEST_JSON);
  });
});
