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
  it('changes runs always, fails closed (set -euo pipefail), full history, feeds changes.mjs, exposes five outputs', () => {
    const j = w.jobs.changes!;
    expect(j.if).toBeUndefined();
    expect(needsOf(j)).toEqual([]);
    const co = steps(j).find((s) => s.uses?.startsWith('actions/checkout@'))!;
    expect(co.with?.['fetch-depth']).toBe(0);
    expect(runOf(j)).toMatch(/set -euo pipefail/);
    expect(runOf(j)).toMatch(/infra\/ci\/changes\.mjs/);
    expect(runOf(j)).toMatch(/\^\[0-9a-f\]\{40\}\$/); // dispatch base validated as 40-hex
    expect(Object.keys(j.outputs ?? {}).sort()).toEqual(['ci', 'db', 'image', 'layers', 'node']);
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
