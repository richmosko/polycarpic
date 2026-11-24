// POLY-98 R11 (CI): where the polycarpic-ops tests run. No new job: the `provision` job gains one step (the ops unit tests) after the
// operator-tool tests, and its shellcheck step covers infra/ops/install.sh. The container test (tests/infra/provision/ops.test.ts) is
// picked up by the existing provision vitest config. Exact step wording is the pair agreed with devops-98 (test-plan.md, "Wiring pair").
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, steps, wf } from '../ci/helpers.ts';

const prov = () => steps(wf('ci.yml').jobs.provision!);
const idx = (re: RegExp) => prov().findIndex((s) => re.test(s.run ?? ''));

describe('CI wiring for POLY-98 (R11)', () => {
  it('the provision job runs the ops unit tests with the stdlib runner, in a step named for polycarpic-ops', () => {
    const i = idx(/python3 -m unittest discover -s tests\/infra\/ops -t tests\/infra\/ops/);
    expect(i, 'the ops unittest step').toBeGreaterThan(-1);
    expect(prov()[i]!.name).toMatch(/polycarpic-ops/i);
    expect(prov()[i]!.run!.trim()).toBe('python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops');
  });
  it('the ops step comes after the operator-tool step and before the vitest dry run', () => {
    const op = idx(/python3 -m unittest discover -s tests\/infra\/operator -t tests\/infra\/operator/);
    const ops = idx(/python3 -m unittest discover -s tests\/infra\/ops /);
    const vt = idx(/vitest run -c tests\/infra\/vitest\.provision\.config\.ts/);
    expect(op).toBeGreaterThan(-1);
    expect(ops).toBeGreaterThan(op);
    expect(vt).toBeGreaterThan(ops);
  });
  it('the job set and the budget are unchanged (no new job)', () => {
    expect(Object.keys(wf('ci.yml').jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'deploy-real', 'guard', 'image', 'lint', 'provision', 'unit']);
    expect(JSON.parse(readFileSync(join(ROOT, 'infra/ci/budgets.json'), 'utf8')).jobs.provision).toBe(200);
  });
  it('shellcheck covers infra/ops/install.sh alongside the three provisioning scripts', () => {
    const sc = prov().find((s) => /shellcheck/.test(s.run ?? ''));
    expect(sc, 'shellcheck step').toBeDefined();
    for (const f of ['infra/hetzner/create.sh', 'infra/provision.sh', 'infra/provision-check.sh', 'infra/ops/install.sh']) expect(sc!.run).toContain(f);
  });
  it('the container test sits where the provision vitest config selects it, the unit tests where unittest discovers them', () => {
    expect(existsSync(join(ROOT, 'tests/infra/provision/ops.test.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'tests/infra/ops/base.py'))).toBe(true);
    expect(readFileSync(join(ROOT, 'tests/infra/vitest.provision.config.ts'), 'utf8')).toContain('tests/infra/provision/*.test.ts');
  });
});
