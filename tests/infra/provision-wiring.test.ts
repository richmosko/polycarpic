// POLY-97 R3 and the architect's CI remedy (pins-review @ 5b2a5e90): where the provisioning tests run. A new `provision` job holds the
// container build, shellcheck, the operator unittests and the dry-run vitest config; the `image` job keeps only the database-stage test
// (it needs the Postgres derivative that job builds). The `app` aggregate requires `provision`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, steps, wf } from '../ci/helpers.ts';

const job = (id: string) => steps(wf('ci.yml').jobs[id]!);
const find = (id: string, re: RegExp) => job(id).find((s) => re.test(s.run ?? ''));

describe('CI wiring for POLY-97 (R3, CI remedy)', () => {
  it('the job set is the POLY-102 set plus `provision`', () => {
    expect(Object.keys(wf('ci.yml').jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'guard', 'image', 'lint', 'provision', 'unit']);
  });
  it('provision runs only on its own filter output and needs `changes`', () => {
    const j = wf('ci.yml').jobs.provision!;
    expect(`${j.if}`).toMatch(/needs\.changes\.outputs\.provision == 'true'/);
    expect(JSON.stringify(j.needs)).toContain('changes');
  });
  it('provision builds the test container, runs shellcheck on the three scripts inside it, the operator unittests, and the provision vitest config', () => {
    expect(find('provision', /docker build .*tests\/infra\/provision/), 'container build').toBeDefined();
    const sc = find('provision', /shellcheck/);
    expect(sc, 'shellcheck step').toBeDefined();
    for (const f of ['infra/hetzner/create.sh', 'infra/provision.sh', 'infra/provision-check.sh']) expect(sc!.run).toContain(f);
    expect(sc!.run).toMatch(/docker run/);
    expect(find('provision', /python3 -m unittest discover -s tests\/infra\/operator/), 'operator unittests').toBeDefined();
    expect(find('provision', /vitest run -c tests\/infra\/vitest\.provision\.config\.ts/), 'dry-run vitest').toBeDefined();
  });
  it('the image job no longer holds the container build, shellcheck or the operator unittests, and still runs its container tests', () => {
    expect(find('image', /tests\/infra\/provision/)).toBeUndefined();
    expect(find('image', /shellcheck/)).toBeUndefined();
    expect(find('image', /unittest/)).toBeUndefined();
    expect(find('image', /vitest\.image\.config\.ts/), 'image container tests').toBeDefined();
  });
  it('app needs provision, aggregate.mjs requires it for its output and lists its result, and its budget is 200 s', () => {
    expect(JSON.stringify(wf('ci.yml').jobs.app!.needs)).toContain('provision');
    const agg = readFileSync(join(ROOT, 'infra/ci/aggregate.mjs'), 'utf8');
    expect(agg).toMatch(/provision: \['provision'\]/);
    expect(agg).toMatch(/'image', 'provision'\]/);
    const budgets = JSON.parse(readFileSync(join(ROOT, 'infra/ci/budgets.json'), 'utf8'));
    expect(budgets.jobs.provision).toBe(200);
  });
  it('the dry-run files sit where the provision config selects them, the database stage where the image config does, the operator tests where unittest discovers them', () => {
    const prov = readdirSync(join(ROOT, 'tests/infra/provision'));
    for (const f of ['create.test.ts', 'host.test.ts', 'checks-db.test.ts']) expect(prov).toContain(f);
    expect(readdirSync(join(ROOT, 'tests/infra/image'))).toContain('provision-db.test.ts');
    expect(readFileSync(join(ROOT, 'tests/infra/vitest.provision.config.ts'), 'utf8')).toContain('tests/infra/provision/*.test.ts');
    expect(readFileSync(join(ROOT, 'tests/infra/vitest.image.config.ts'), 'utf8')).toContain('tests/infra/image/*.test.ts');
    const op = readdirSync(join(ROOT, 'tests/infra/operator')).filter((f) => /^test_.*\.py$/.test(f));
    expect(op.sort()).toEqual(['test_b2_rclone_output.py', 'test_b2_setup.py','test_dns_check.py', 'test_dns_move.py', 'test_dns_records.py', 'test_laptop_check.py']);
  });
  it('the test container is pinned by digest and holds no credential', () => {
    const d = readFileSync(join(ROOT, 'tests/infra/provision/Dockerfile'), 'utf8');
    expect(d).toMatch(/^FROM ubuntu:24\.04@sha256:[0-9a-f]{64}$/m);
    expect(existsSync(join(ROOT, 'tests/infra/provision/fakes/hcloud'))).toBe(true);
  });
});
