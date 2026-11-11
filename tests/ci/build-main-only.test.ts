// POLY-132 (fix-forward for POLY-96): build.yml's post-push steps only run on `main`, so the first real run was their first run.
// Run 42955852310 failed at the built-image check with "No such image": the build step pushes with no local copy and
// image.sh check asked the local Docker. These tests pin what can be pinned without a registry.
// Contract for "the digest is available to the check": EITHER a step between the push and the check pulls
// `${IMAGE}@${DIGEST}` (by digest, never by tag), OR `image.sh check <repo>@sha256:...` pulls it itself.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ci, ROOT, steps, wf, type Step } from './helpers.ts';

const job = wf('build.yml').jobs.build!;
const ss: Step[] = steps(job);
const txt = (s: Step) => `${s.uses ?? ''} ${s.run ?? ''}`;
const at = (re: RegExp) => ss.findIndex((s) => re.test(txt(s)));
const DIGEST = 'sha256:' + 'a'.repeat(64);

/** Run `image.sh check <ref>` with a docker stub that behaves like the runner: the image is NOT local until `docker pull <ref@sha256:..>` ran. */
function checkAgainstRegistryOnlyImage(): { code: number | null; stderr: string; pulled: string[] } {
  if (!existsSync(ci('image.sh'))) throw new Error('infra/ci/image.sh does not exist');
  const d = mkdtempSync(join(tmpdir(), 'chk-'));
  const bin = join(d, 'bin'); mkdirSync(bin);
  const state = join(d, 'pulled'); const log = join(d, 'pulls');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
case "$1" in
  pull) shift; for a in "$@"; do case "$a" in -*) ;; *) echo "$a" >> "${log}" ;; esac; done
        case "$*" in *@sha256:*) : > "${state}" ;; *) echo "pull by tag" >&2; exit 1 ;; esac ;;
  image) [ -e "${state}" ] || { echo "Error response from daemon: No such image" >&2; exit 1; }; printf 'node\\n' ;;
  run)   [ -e "${state}" ] || { echo "Unable to find image locally" >&2; exit 125; }; exit 0 ;;
  *) exit 0 ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const r = spawnSync('bash', [ci('image.sh'), 'check', `ghcr.io/richmosko/polycarpic@${DIGEST}`], {
    cwd: ROOT, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: d },
  });
  const pulled = existsSync(log) ? spawnSync('cat', [log], { encoding: 'utf8' }).stdout.trim().split('\n') : [];
  return { code: r.status, stderr: r.stderr ?? '', pulled };
}

describe('POLY-132: the built-image check cannot run without the pushed digest being available', () => {
  it('build.yml has push, check, scan, sbom steps in that order', () => {
    const [b, c, sc, sb] = [at(/build-push-action/), at(/image\.sh check/), at(/image\.sh scan/), at(/image\.sh sbom/)];
    for (const v of [b, c, sc, sb]) expect(v).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(c); expect(c).toBeLessThan(sc); expect(sc).toBeLessThan(sb);
  });
  it('availability: a digest pull sits between push and check, or image.sh check pulls the digest itself  [red if: the pull is removed (the 42955852310 failure)]', () => {
    const b = at(/build-push-action/), c = at(/image\.sh check/);
    const stepPulls = ss.slice(b + 1, c).some((s) => /docker pull\b[^\n]*@\$\{?DIGEST\}?|docker pull\b[^\n]*@sha256:/.test(s.run ?? ''));
    const r = checkAgainstRegistryOnlyImage();
    const scriptPulls = r.code === 0;
    expect(stepPulls || scriptPulls, `no pull step before the check and image.sh check failed against a registry-only image: ${r.stderr.trim()}`).toBe(true);
    if (scriptPulls) expect(r.pulled.some((p) => p.includes(`@${DIGEST}`)), 'pull must be by digest, never by tag').toBe(true);
  });
  it('a pull step, if used, takes the digest from the build step through env (never a tag)', () => {
    const b = at(/build-push-action/), c = at(/image\.sh check/);
    for (const s of ss.slice(b + 1, c)) if (/docker pull/.test(s.run ?? '')) {
      expect(s.run).not.toMatch(/:sha-|:latest|:main/);
      expect(s.env?.DIGEST ?? '').toMatch(/steps\.build\.outputs\.digest/);
    }
  });
  it('the registry login precedes every step that touches the registry (pull, check, scan, sbom)  [red if: login moved after]', () => {
    const l = at(/login-action/);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThan(at(/build-push-action/));
  });
});

describe('POLY-132: other main-only steps that no PR run reaches', () => {
  it('check, scan and sbom are all given the digest form ${IMAGE}@${DIGEST}, never a tag  [red if: a step is pointed at the tag]', () => {
    for (const sub of ['check', 'scan', 'sbom']) {
      const s = ss.find((x) => new RegExp(`image\\.sh ${sub}\\b`).test(x.run ?? ''))!;
      expect(s.run, sub).toMatch(new RegExp(`image\\.sh ${sub} "\\$\\{IMAGE\\}@\\$\\{DIGEST\\}"`));
      expect(s.env?.DIGEST, sub).toMatch(/steps\.build\.outputs\.digest/);
    }
  });
  it('scan and sbom carry registry credentials for Trivy (TRIVY_USERNAME and TRIVY_PASSWORD)  [red if: either is dropped]', () => {
    for (const sub of ['scan', 'sbom']) {
      const s = ss.find((x) => new RegExp(`image\\.sh ${sub}\\b`).test(x.run ?? ''))!;
      expect(Object.keys(s.env ?? {}), sub).toEqual(expect.arrayContaining(['TRIVY_USERNAME', 'TRIVY_PASSWORD']));
    }
  });
  it('Trivy is installed before the scan and the SBOM', () => {
    const t = at(/install-trivy/);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(at(/image\.sh scan/));
    expect(t).toBeLessThan(at(/image\.sh sbom/));
  });
  it('the SBOM file the attestation and artifact read is the file image.sh sbom writes  [red if: the names drift]', () => {
    const sbom = ss.find((x) => /image\.sh sbom/.test(x.run ?? ''))!;
    const out = sbom.env?.SBOM_OUT ?? 'sbom.cdx.json'; // image.sh default
    const att = ss.find((x) => /attest-sbom/.test(x.uses ?? ''))!;
    expect(String(att.with?.['sbom-path'])).toBe(out);
    const up = ss.find((x) => /upload-artifact/.test(x.uses ?? ''))!;
    expect(String(up.with?.path)).toContain(out);
  });
  it('attestation subject-name is the bare repository (no tag, no digest), subject-digest is the build output', () => {
    for (const re of [/attest-build-provenance/, /attest-sbom/]) {
      const a = ss.find((x) => re.test(x.uses ?? ''))!;
      expect(String(a.with?.['subject-name']), String(re)).toMatch(/^\$\{\{\s*env\.IMAGE\s*\}\}$/);
      expect(String(a.with?.['subject-digest'])).toMatch(/steps\.build\.outputs\.digest/);
    }
  });
  it('both attestations come after scan AND check, and digest.txt is only written after both attestations', () => {
    const [c, sc, p, a, rec] = [at(/image\.sh check/), at(/image\.sh scan/), at(/attest-build-provenance/), at(/attest-sbom/), at(/digest\.txt/)];
    expect(Math.max(c, sc)).toBeLessThan(Math.min(p, a));
    expect(rec).toBeGreaterThan(Math.max(p, a));
  });
  it('the build step is the only source of the digest: no other step defines DIGEST from a lookup (docker inspect, crane, tag resolve)', () => {
    for (const s of ss) expect(s.run ?? '').not.toMatch(/DIGEST=\$\(|docker (buildx )?imagetools inspect|crane digest|manifest inspect/);
  });
});
