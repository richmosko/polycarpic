// POLY-100 T-real (ruling.md 3765f358, S38 a): the `deploy` key of infra/ci/changes.mjs gates the one real first-deploy step of the image job. Each row of the ruling's table has a path that sets it; every fault T-real
// would have caught is pinned by the path that held it; routes, components, the ledger package and tests leave it false; and every file the suite imports (the walk, as tests/ci does for the db battery) sets it.
// Red on a mutant dropping any row (each regex must be the only one matching some pinned path) and on an unlisted import.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TABLE, classify } from '../../infra/ci/changes.mjs';
import { ROOT } from './helpers.ts';

/** One path per row of the ruling, and the fault it pins. */
const ROWS: [string, string][] = [
  ['Dockerfile', 'F1 (the real tar)'],
  ['.dockerignore', 'the build context'],
  ['bin/polycarpic', 'the entrypoint'],
  ['infra/ops/lib/stack.py', 'F16 (`compose run` options)'],
  ['infra/ops/lib/release.py', 'G1 (the umask), the tool'],
  ['infra/ops/commands/deploy.py', 'the tool'],
  ['infra/deploy/compose-allow.json', 'the installed policy'],
  ['infra/compose/staging.yml', 'PLAID_ENV, the compose files'],
  ['infra/compose/edge.yml', 'the edge networks'],
  ['infra/caddy/Caddyfile', 'what the bundle holds'],
  ['infra/postgres/postgresql.prod.conf', 'what the bundle holds'],
  ['infra/backup/backup.sh', 'what the bundle holds'],
  ['infra/postgres-major', 'what the bundle holds'],
  ['infra/provision.sh', 'G1 (the directories), MAIL_FROM (the env files)'],
  ['infra/provision-check.sh', 'H23, H24'],
  ['infra/ci/image.sh', 'the images'],
  ['infra/ci/images-env.sh', 'images.env'],
  ['infra/ci/deploy-real-undo.sh', 'the undo the step leaves behind'],
  ['infra/ci/deploy-real-sweep.mjs', 'B9: the sweep that gates the kept log'],
  ['packages/config/src/check.ts', 'PLAID_ENV, MAIL_FROM: the settings contract'],
  ['packages/config/package.json', 'the settings contract'],
  ['packages/db/migrations/0001_init.sql', 'migrations'],
  ['packages/db/sql/roles.sql', 'migrations and roles'],
  ['packages/db/src/migrate.ts', 'the runner'],
  ['packages/db/src/journal.ts', 'the runner'],
  ['packages/db/src/connection.ts', 'the runner'],
  ['apps/migrate/src/cli.ts', 'startup code'],
  ['apps/web/src/main.ts', 'startup code'],
  ['apps/worker/src/startup.ts', 'startup code'],
  ['apps/auth/src/bind.ts', 'startup code'],
  ['apps/worker/src/jobs/index.ts', 'startup code'],
  ['apps/web/src/ops/health.ts', 'the health route'],
  ['apps/web/src/ops/public-health.ts', 'G15: the public health listener the first deploy waits on'],
  ['apps/web/src/ops/probe.ts', 'the probe'],
  ['tests/infra/deploy-real/first-deploy.test.ts', 'the test'],
  ['tests/infra/vitest.deploy-real.config.ts', "the suite's config"],
  ['infra/ci/changes.mjs', 'its trigger'],
  ['.github/workflows/ci.yml', 'its job'],
];

/** Paths that must NOT set the key (ruling: the rest of apps/ and packages/, lockfile and manifests, tests). */
const NEGATIVES = [
  'apps/web/src/routes/+page.svelte',
  'apps/web/src/lib/components/Button.svelte',
  'packages/ledger/src/entries.ts',
  'packages/config/src/check.test.ts',
  'apps/web/src/ops/health.test.ts',
  'pnpm-lock.yaml',
  'package.json',
  'docs/PRD/index.html',
  'process/cairn/issues/POLY-100.md',
];

describe('the `deploy` key (ruling 3765f358)', () => {
  it('the key exists in TABLE', () => {
    expect(Object.keys(TABLE)).toContain('deploy');
  });

  for (const [p, why] of ROWS) {
    it(`${p} sets deploy  (${why})`, () => {
      expect(classify([p]).deploy, p).toBe(true);
    });
  }

  for (const p of NEGATIVES) {
    it(`${p} leaves deploy false`, () => {
      expect(classify([p]).deploy, p).toBe(false);
    });
  }

  it('every row is needed: dropping any one regex loses a pinned path that no other regex matches  [red if: a row is dropped]', () => {
    const res: RegExp[] = (TABLE as any).deploy ?? [];
    expect(res.length).toBeGreaterThan(0);
    const paths = ROWS.map(([p]) => p);
    res.forEach((re, i) => {
      const others = res.filter((_, j) => j !== i);
      const lost = paths.filter((p) => re.test(p) && !others.some((o) => o.test(p)));
      expect(lost.length, `no pinned path needs ${re}: the row is unpinned or redundant`).toBeGreaterThan(0);
    });
  });
});

// ---- the suite's own import closure sets the key (S38 a) ----
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(ts|mjs|js)$/.test(n) ? [p] : [];
}) : []);
const spec = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const withExt = (p: string): string | null => [p, `${p}.ts`, join(p, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;

// POLY-162: the step is ON, by the `deploy` key and by nothing else. The step is the last of `image` before the always() steps; the undo runs always and only then; no token reaches it; nothing pulls after it (ruling.md "Job", S38).
type Step = { name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string>; 'continue-on-error'?: unknown };
describe('T-real is on, gated by the deploy key alone (ruling "Job", S38 b/c/e; POLY-162)', () => {
  // POLY_CI_YML: a copy of ci.yml to read instead (how a mutant is shown red without editing the workflow; unset in CI)
  const doc = parse(readFileSync(process.env.POLY_CI_YML ?? join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as { permissions?: Record<string, string>; jobs: Record<string, { permissions?: Record<string, string>; steps: Step[] }> };
  const steps = doc.jobs.image!.steps;
  const iReal = steps.findIndex((s) => (s.run ?? '').includes('vitest.deploy-real.config.ts'));
  const real = steps[iReal];
  const DEPLOY_ON = "needs.changes.outputs.deploy == 'true'";

  it('exactly one step of the image job runs the deploy-real config, and nothing else in any workflow does  [red if: the step is absent or duplicated]', () => {
    expect(steps.filter((s) => (s.run ?? '').includes('vitest.deploy-real.config.ts')).length).toBe(1);
    for (const f of ['build.yml', 'release.yml', 'renovate-check.yml']) expect(readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8'), f).not.toContain('deploy-real');
    for (const [id, j] of Object.entries(doc.jobs)) if (id !== 'image') expect(JSON.stringify(j.steps), `job ${id}`).not.toContain('vitest.deploy-real.config.ts');
  });

  it(`the step's condition is exactly \`${DEPLOY_ON}\`: no constant, no always(), no other key  [red if: it is forced on or off, or widened]`, () => {
    expect(real?.if).toBe(DEPLOY_ON);
    expect(real?.['continue-on-error'], 'a red real deploy must fail the job').toBeUndefined();
  });

  it('it comes after the backup suite and is the last step that is not an always() step  [red if: another real step follows it]', () => {
    const iBackup = steps.findIndex((s) => (s.run ?? '').includes('vitest.backup.config.ts'));
    expect(iBackup).toBeGreaterThanOrEqual(0);
    expect(iReal).toBeGreaterThan(iBackup);
    const after = steps.slice(iReal + 1);
    expect(after.length).toBeGreaterThan(0);
    for (const s of after) expect(s.if ?? '', `step "${s.name}" after the real deploy is not an always() step`).toMatch(/^always\(\)/);
  });

  it('no token reaches it (S38 e): the checkout persists no credentials, the step and the job set no GH_TOKEN or GITHUB_TOKEN, permissions are contents: read and nothing more  [red if: a token is added]', () => {
    expect(JSON.stringify(real?.env ?? {})).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|secrets\./);
    // B8: a workflow-level or job-level env reaches every step of the job too
    expect(JSON.stringify((doc as { env?: unknown }).env ?? {}), 'workflow env').not.toMatch(/GH_TOKEN|GITHUB_TOKEN|secrets\./);
    expect(JSON.stringify((doc.jobs.image as { env?: unknown }).env ?? {}), 'image job env').not.toMatch(/GH_TOKEN|GITHUB_TOKEN|secrets\./);
    expect(real?.run ?? '').not.toMatch(/GH_TOKEN|GITHUB_TOKEN|\bgh\s|secrets\./);
    expect(doc.jobs.image!.permissions).toEqual({ contents: 'read' });
    const checkout = steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(steps.some((s) => /(GH_TOKEN|GITHUB_TOKEN)/.test(JSON.stringify(s.env ?? {}))), 'a step of the image job carries a token').toBe(false);
  });

  it('the undo runs always, only when the key is on, executes infra/ci/deploy-real-undo.sh, and sits after the real deploy  [red if: the undo is missing, conditional on success, or before it]', () => {
    const iUndo = steps.findIndex((s) => /(bash|sh|sudo)\s+(\.\/)?infra\/ci\/deploy-real-undo\.sh/.test(s.run ?? ''));
    expect(iUndo, 'no step runs the undo').toBeGreaterThan(iReal);
    expect(steps[iUndo]!.if).toBe(`always() && ${DEPLOY_ON}`);
  });

  it('nothing after the real deploy pulls, logs in or checks out; the kept log is the step\'s own output alone, never /etc/polycarpic, state or a saved render (S38 b, c)  [red if: a later pull, or a wider artifact path]', () => {
    for (const s of steps.slice(iReal + 1)) {
      expect(s.uses ?? '', s.name).not.toMatch(/^actions\/checkout|docker\/login|setup-/);
      expect(s.run ?? '', s.name).not.toMatch(/docker (pull|login)|\bgh\s|\bcurl\b|apt-get install/);
    }
    const up = steps.slice(iReal + 1).filter((s) => (s.uses ?? '').startsWith('actions/upload-artifact') && s.with?.name === 'deploy-real-log');
    expect(up.length, 'the real deploy\'s log is not kept').toBe(1);
    expect(up[0]!.if).toContain(`always() && ${DEPLOY_ON}`); // B9 adds the sweep's outcome, pinned in its own case
    const p = String(up[0]!.with?.path);
    expect(p).toContain('deploy-real');
    expect(p).not.toMatch(/etc\/polycarpic|\/var\/lib|state|\*|render|\/opt/);
    expect(p.replace(/\$\{\{[^}]*\}\}/g, 'X').trim().split(/\s+/).length, 'one path').toBe(1);
  });

  it('B1: `CI` and the step summary reach the suite through sudo, and every part refuses to skip when CI is true  [red if: sudo drops CI, so a missing tool is a green skip]', () => {
    const run = real?.run ?? '';
    const kept = /--preserve-env=([^\s]+)/.exec(run)?.[1]?.split(',') ?? [];
    expect(kept, 'sudo --preserve-env names CI').toContain('CI');
    expect(kept, 'and the step summary the harness appends to').toContain('GITHUB_STEP_SUMMARY');
    for (const f of ['1-first-deploy', '2-rollback', '3-sweep']) {
      const t = readFileSync(join(ROOT, 'tests', 'infra', 'deploy-real', `${f}.test.ts`), 'utf8');
      expect(t, `${f} throws in CI when a tool is missing`).toMatch(/if \(gap\.length && IN_CI\) throw new Error/);
    }
    expect(readFileSync(join(ROOT, 'tests', 'infra', 'deploy-real', 'harness.ts'), 'utf8')).toMatch(/export const IN_CI = process\.env\.CI === 'true'/);
  });

  it('B9: the step\'s own output joins the kept log by appending (tee -a), never overwriting the harness\'s lines  [red if: plain tee]', () => {
    expect(real?.run ?? '').toMatch(/\btee -a\b/);
    expect(real?.run ?? '').not.toMatch(/\btee (?!-a)[^-\s]/);
  });

  it('B9: the sweep runs always (under the key), before the undo, and the upload needs its outcome == success; the kept path is its output, never a file the harness or tee writes  [red if: no sweep, a sweep after the undo, or an upload not tied to it]', () => {
    const iSweep = steps.findIndex((s) => /deploy-real-sweep\.mjs/.test(s.run ?? ''));
    expect(iSweep, 'no step runs infra/ci/deploy-real-sweep.mjs').toBeGreaterThan(iReal);
    const sweepStep = steps[iSweep] as Step & { id?: string };
    expect(sweepStep.if).toBe(`always() && ${DEPLOY_ON}`);
    expect(sweepStep.id, 'the sweep step has an id for the upload to name').toMatch(/^[a-z][a-z0-9_-]*$/);
    const iUndo = steps.findIndex((s) => /(bash|sh|sudo)\s+(\.\/)?infra\/ci\/deploy-real-undo\.sh/.test(s.run ?? ''));
    expect(iSweep, 'the undo deletes the secret list the sweep reads: sweep first').toBeLessThan(iUndo);
    expect(sweepStep.run ?? '').toMatch(/--secrets\s/);
    const up = steps.find((s) => (s.uses ?? '').startsWith('actions/upload-artifact') && s.with?.name === 'deploy-real-log')!;
    expect(up.if, 'the upload needs the sweep to have succeeded').toBe(`always() && ${DEPLOY_ON} && steps.${sweepStep.id}.outcome == 'success'`);
    expect(up.if).not.toMatch(/!= 'failure'|failure\(\)|success\(\)/);
    const out = /--out\s+(\S+)/.exec(sweepStep.run ?? '')?.[1];
    expect(out, 'the sweep writes one named output').toBeTruthy();
    expect(String(up.with?.path), 'the upload is exactly the sweep\'s output').toBe(out);
    for (const s of steps) if (s !== real) expect(s.run ?? '', s.name).not.toMatch(/tee\s+(-a\s+)?\S*deploy-real\/(log|harness)/);
  });

  it('the step keeps its failure: it pipes through tee under pipefail, so the vitest exit code is the step\'s  [red if: the pipe hides the exit code]', () => {
    expect(real?.run ?? '').toMatch(/set -o pipefail/);
  });
});

describe('the suite does not import what the key cannot see', () => {
  const roots = [...walk(join(ROOT, 'tests', 'infra', 'deploy-real')), join(ROOT, 'tests', 'infra', 'vitest.deploy-real.config.ts')].filter((f) => existsSync(f));
  const closure = (): string[] => {
    const seen = new Set<string>();
    const todo = [...roots];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!/\.(ts|mjs|js)$/.test(f)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(spec)) {
        if (!m[1]!.startsWith('.')) continue; // node: builtins and packages
        const r = withExt(resolve(dirname(f), m[1]!));
        if (r && !r.includes('/node_modules/')) todo.push(r);
      }
    }
    return [...seen].map((f) => relative(ROOT, f)).sort();
  };

  it('the walk is not vacuous: the suite exists and reaches its own files  [red if: the suite is absent or the specifier regex is wrong]', () => {
    const rel = closure();
    expect(rel.length, 'tests/infra/deploy-real is absent').toBeGreaterThan(1);
    expect(rel.some((f) => f.startsWith('tests/infra/deploy-real/'))).toBe(true);
  });

  it('every file in the closure sets deploy  [red if: the suite imports a helper the key does not cover]', () => {
    expect(closure().filter((p) => !classify([p]).deploy)).toEqual([]);
  });
});
