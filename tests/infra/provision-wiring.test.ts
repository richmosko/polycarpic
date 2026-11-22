// POLY-97 R3: where the provisioning tests run. No new job, no filter change: three added steps in the existing `image` job,
// each gated on the `image` key, and the vitest dry run is picked up by the existing image config (tests/infra/image/*.test.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, steps, wf } from '../ci/helpers.ts';

const image = () => steps(wf('ci.yml').jobs.image!);
const find = (re: RegExp) => image().find((s) => re.test(s.run ?? ''));

describe('CI wiring for POLY-97 (R3)', () => {
  it('the job set is unchanged (no new job)', () => {
    expect(Object.keys(wf('ci.yml').jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'guard', 'image', 'lint', 'unit']);
  });
  it('the image job builds the provisioning test container, gated on the image key', () => {
    const s = find(/docker build .*tests\/infra\/provision/);
    expect(s, 'a step builds tests/infra/provision').toBeDefined();
    expect(s!.if).toMatch(/outputs\.image == 'true'/);
  });
  it('the image job runs shellcheck on the three scripts inside that container', () => {
    const s = find(/shellcheck/);
    expect(s, 'a shellcheck step').toBeDefined();
    for (const f of ['infra/hetzner/create.sh', 'infra/provision.sh', 'infra/provision-check.sh']) expect(s!.run).toContain(f);
    expect(s!.run).toMatch(/docker run/);
    expect(s!.if).toMatch(/outputs\.image == 'true'/);
  });
  it('the image job runs the operator unittests with python3 -m unittest discover', () => {
    const s = find(/python3 -m unittest discover -s tests\/infra\/operator/);
    expect(s, 'an operator unittest step').toBeDefined();
    expect(s!.if).toMatch(/outputs\.image == 'true'/);
  });
  it('the dry-run vitest files sit where the image config selects them, and the operator tests where unittest discovers them', () => {
    const img = readdirSync(join(ROOT, 'tests/infra/image'));
    for (const f of ['provision.test.ts', 'provision-create.test.ts', 'provision-db.test.ts']) expect(img).toContain(f);
    const op = readdirSync(join(ROOT, 'tests/infra/operator')).filter((f) => /^test_.*\.py$/.test(f));
    expect(op.sort()).toEqual(['test_b2_setup.py', 'test_dns_check.py', 'test_dns_move.py', 'test_dns_records.py', 'test_laptop_check.py']);
    const cfg = readFileSync(join(ROOT, 'tests/infra/vitest.image.config.ts'), 'utf8');
    expect(cfg).toContain("tests/infra/image/*.test.ts");
  });
  it('the test container is pinned by digest and holds no credential', () => {
    const d = readFileSync(join(ROOT, 'tests/infra/provision/Dockerfile'), 'utf8');
    expect(d).toMatch(/^FROM ubuntu:24\.04@sha256:[0-9a-f]{64}$/m);
    expect(existsSync(join(ROOT, 'tests/infra/provision/fakes/hcloud'))).toBe(true);
  });
});
