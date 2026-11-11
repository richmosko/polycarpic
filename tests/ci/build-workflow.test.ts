// POLY-96 stage 2 -- .github/workflows/build.yml and infra/ci/image.sh (ruling §4): criteria 2 (image build), 4 (Trivy).
// Real GHCR push, attestation and Trivy against a real image are post-merge / manual evidence (ruling §6).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ci, steps, wf, wfText, type Job } from './helpers.ts';

const w = wf('build.yml');
const text = wfText('build.yml');
const idx = (j: Job, re: RegExp) => steps(j).findIndex((s) => re.test(`${s.uses ?? ''} ${s.run ?? ''}`));

describe('build.yml', () => {
  it('.github/workflows/build.yml exists', () => { expect(text).not.toBe(''); });
  it('triggers: push to main, weekly schedule, dispatch -- nothing else; top-level permissions {}', () => {
    expect(Object.keys(w.on).sort()).toEqual(['push', 'schedule', 'workflow_dispatch']);
    expect((w.on.push as { branches: string[] }).branches).toEqual(['main']);
    expect(w.permissions).toEqual({});
  });
  it('every job is guarded by github.ref == refs/heads/main (S96-15)  [red if: a job lacks the ref guard]', () => {
    expect(Object.keys(w.jobs).length).toBeGreaterThan(0);
    for (const [id, j] of Object.entries(w.jobs)) expect(j.if ?? '', id).toContain("github.ref == 'refs/heads/main'");
  });
  it('no cache anywhere: no actions/cache, no cache-from/to, buildx no-cache (S96-20)', () => {
    expect(text).not.toMatch(/actions\/cache|cache-from|cache-to/);
    expect(text).toMatch(/no-cache/);
  });
  it('concurrency does not cancel in-progress builds', () => {
    expect(w.concurrency).toBeDefined();
    expect(JSON.stringify(w.concurrency ?? {})).not.toMatch(/"cancel-in-progress":true/);
  });
});

describe('build.yml: build job', () => {
  const j = w.jobs.build!;
  it('exists, push+dispatch only, with exactly the ruled permissions', () => {
    expect(j).toBeDefined();
    expect(j.if).toMatch(/github\.event_name != 'schedule'/);
    expect(j.permissions).toEqual({ contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' });
  });
  it('order: build+push -> trivy scan -> SBOM -> provenance attest -> sbom attest  [red if: attest before scan, S96-16]', () => {
    const b = idx(j, /image\.sh build|build-push-action/);
    const sc = idx(j, /image\.sh scan/);
    const sbom = idx(j, /cyclonedx|sbom/i);
    const prov = idx(j, /attest-build-provenance/);
    const asbom = idx(j, /attest-sbom/);
    for (const [n, v] of Object.entries({ b, sc, sbom, prov, asbom })) expect(v, n).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(sc);
    expect(sc).toBeLessThan(prov);
    expect(sc).toBeLessThan(asbom);
    expect(sbom).toBeLessThan(asbom);
    expect(prov).toBeLessThan(asbom + 1);
  });
  it('provenance attests the build step digest and pushes to registry; sbom attest on the same digest', () => {
    const prov = steps(j).find((s) => /attest-build-provenance/.test(s.uses ?? ''))!;
    expect(prov.with?.['push-to-registry']).toBe(true);
    expect(String(prov.with?.['subject-digest'])).toMatch(/steps\.[\w-]+\.outputs\.digest/);
    const sb = steps(j).find((s) => /attest-sbom/.test(s.uses ?? ''))!;
    expect(String(sb.with?.['subject-digest'])).toBe(String(prov.with?.['subject-digest']));
  });
  it('digest is uploaded as artifact image-<commit> and written to the step summary (release reads it)', () => {
    const up = steps(j).find((s) => s.uses?.startsWith('actions/upload-artifact@'))!;
    expect(String(up.with?.name)).toMatch(/^image-\$\{\{\s*github\.sha\s*\}\}$/);
    expect(JSON.stringify(j)).toMatch(/digest\.txt/);
    expect(JSON.stringify(j)).toMatch(/GITHUB_STEP_SUMMARY/);
  });
  it('only GIT_COMMIT crosses into the build (S96-18/19); install blocks scripts (C-80)', () => {
    const args = JSON.stringify(steps(j).map((s) => s.with?.['build-args'] ?? s.env ?? ''));
    expect(args).toMatch(/GIT_COMMIT/);
    expect(args).not.toMatch(/secrets\.|NPM_TOKEN|GITHUB_TOKEN/);
  });
});

describe('build.yml: weekly-scan job (scan-only)', () => {
  const j = w.jobs['weekly-scan']!;
  it('schedule only, read-only permissions, no build/push/attest', () => {
    expect(j).toBeDefined();
    expect(j.if).toMatch(/github\.event_name == 'schedule'/);
    expect(j.permissions).toEqual({ contents: 'read', packages: 'read', actions: 'read' });
    const body = JSON.stringify(j);
    expect(body).not.toMatch(/image\.sh build|build-push-action|docker push|attest|buildx/);
    expect(body).toMatch(/image\.sh scan/);
  });
  it('packages: write and id-token: write exist only in the build job', () => {
    expect(Object.keys(w.jobs)).toContain('build');
    for (const [id, other] of Object.entries(w.jobs)) if (id !== 'build') expect(JSON.stringify(other.permissions ?? {}), id).not.toMatch(/write/);
  });
});

describe('infra/ci/image.sh (criterion 4: Trivy)', () => {
  const sh = () => readFileSync(ci('image.sh'), 'utf8');
  it('exists with build and scan subcommands, strict mode', () => {
    expect(sh()).toMatch(/set -euo pipefail/);
    expect(sh()).toMatch(/\bbuild\)/);
    expect(sh()).toMatch(/\bscan\)/);
  });
  it('trivy fails on fixable CRITICAL/HIGH and embedded secrets  [red if: --ignore-unfixed/--exit-code/secret scanner dropped]', () => {
    const s = sh();
    expect(s).toMatch(/--scanners vuln,secret/);
    expect(s).toMatch(/--severity CRITICAL,HIGH/);
    expect(s).toMatch(/--ignore-unfixed/);
    expect(s).toMatch(/--exit-code 1/);
  });
  it('build passes GIT_COMMIT and forbids cache reuse; bash syntax valid', () => {
    expect(sh()).toMatch(/GIT_COMMIT/);
    expect(sh()).toMatch(/--no-cache|--pull/);
  });
});
