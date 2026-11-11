// POLY-95 R3 / R4 / criteria 4, 5: where the infra checks run (no new top-level CI job, POLY-96) and that the DB battery
// builds from the ONE Postgres FROM line. Static: reads ci.yml and the db harness source.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, steps, wf, type Step } from '../ci/helpers.ts';

const text = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '');
const ci = () => wf('ci.yml');
const runs = (job: string): Step[] => steps(ci().jobs[job]!);

describe('CI wiring (R3)', () => {
  it('no new top-level job: the job set is exactly the POLY-102 set', () => {
    expect(Object.keys(ci().jobs).sort()).toEqual(['app', 'cairn', 'changes', 'db', 'guard', 'image', 'lint', 'unit']); // red: a new job added
  });
  it('lint job runs the compose-policy lint over the repo, gated on image or ci', () => {
    const s = runs('lint').find((x) => /infra\/lint\/compose-policy\.mjs/.test(x.run ?? ''));
    expect(s, 'a lint step runs infra/lint/compose-policy.mjs').toBeDefined();
    expect(s!.run).toMatch(/--root\s+\./); // red: lint run without the repo root, or not at all
    expect(s!.if).toMatch(/outputs\.image == 'true'/);
    expect(s!.if).toMatch(/outputs\.ci == 'true'/);
  });
  it('lint job runs the tests/infra fixture suite with the infra config, gated on image or ci', () => {
    const s = runs('lint').find((x) => /tests\/infra\/vitest\.config\.ts/.test(x.run ?? ''));
    expect(s, 'a lint step runs the tests/infra suite').toBeDefined();
    expect(s!.if).toMatch(/outputs\.image == 'true'/);
    expect(s!.if).toMatch(/outputs\.ci == 'true'/);
  });
  it('image job runs the container tests (SHOW, archive, secret modes, Caddy curl) with the image config', () => {
    const s = runs('image').find((x) => /tests\/infra\/vitest\.image\.config\.ts/.test(x.run ?? ''));
    expect(s, 'an image step runs the image-config suite').toBeDefined(); // red: tests never run in CI
  });
  it('image job builds and Trivy-scans the Postgres and Caddy derivatives', () => {
    const body = runs('image').map((x) => x.run ?? '').join('\n');
    expect(body).toMatch(/infra\/postgres/);
    expect(body).toMatch(/infra\/caddy/);
    expect((body.match(/trivy|image\.sh scan/g) ?? []).length).toBeGreaterThanOrEqual(2); // red: derivatives built but not scanned
  });
  it('the workflow itself never retypes a postgres tag (R4)', () => {
    expect(text('.github/workflows/ci.yml')).not.toMatch(/postgres:\d/);
  });
});

describe('one place for the Postgres tag and digest (R4, criterion 4)', () => {
  it('infra/postgres/Dockerfile line 1 is FROM postgres:17.N@sha256:<64 hex>', () => {
    expect(text('infra/postgres/Dockerfile').split('\n')[0]).toMatch(/^FROM postgres:17\.\d+@sha256:[0-9a-f]{64}$/);
  });
  it('infra/postgres-major is the single line 17', () => {
    expect(text('infra/postgres-major')).toBe('17\n');
  });
  it('the age pin is from the base release\'s own signed sources: apt-get install of age=<version>, no curl/wget/add-apt', () => {
    const d = text('infra/postgres/Dockerfile');
    expect(d).toMatch(/apt-get install[^\n]*\bage=\S+/);
    expect(d).not.toMatch(/curl|wget|add-apt-repository|sources\.list|apt-key/); // red: a download or a new apt source
  });
  it('tests/db/docker/Dockerfile takes ARG PG_BASE / FROM ${PG_BASE}', () => {
    const d = text('tests/db/docker/Dockerfile');
    expect(d).toMatch(/^ARG PG_BASE$/m);
    expect(d).toMatch(/^FROM \$\{PG_BASE\}$/m);
    expect(d).not.toMatch(/postgres:\d/);
  });
  it('tests/db/helpers/pg.ts reads the FROM line, passes --build-arg, and names the cached image after the digest', () => {
    const h = text('tests/db/helpers/pg.ts');
    expect(h).toMatch(/infra[\s\S]{0,40}postgres[\s\S]{0,40}Dockerfile/); // red: still builds from a literal tag
    expect(h).toMatch(/--build-arg/);
    expect(h).toMatch(/PG_BASE=/);
    expect(h).not.toMatch(/export const IMAGE = 'polycarpic-pg17-pgtap:test'/); // a fixed tag reuses a stale build after a bump
  });
});
