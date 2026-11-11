---
id: POLY-132
title: build.yml first-run fixes
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [.github/workflows/build.yml, .github/workflows/release.yml, .github/workflows/ci.yml, infra/ci/**, tests/**, Dockerfile, docs/INFRA/**, docs/SECURITY/**, process/cairn/issues/POLY-132.md, process/cairn/reviews/POLY-132/**, package.json, pnpm-lock.yaml]
labels: [ci, bug, supply-chain]
priority: P1
pr: null
created: 2026-11-10
updated: 2026-11-10
---

Fix-forward for POLY-96 (ruling `process/cairn/reviews/POLY-96/ruling.md` §6: a failure on the first push to `main` is fixed forward, not reverted). The first build.yml run on `main` (42955852310 @ cb79dcb) pushed the image and then failed at the built-image check with `No such image`: the build step pushes straight to the registry and leaves no local copy, and `infra/ci/image.sh check` asks the local Docker for the digest. Nothing was scanned or attested. The steps after the check (Trivy on the pushed digest, SBOM, provenance and SBOM attestations) have never run for real; any further first-run failure in build.yml or in release.yml's dry run is fixed under this issue, not a new one. The ruling, Addendum 1 and seceng conditions S96-1..22 and A1–A5 stand unchanged; this issue changes no rule.

## Acceptance criteria

- [ ] build.yml's built-image check runs against the pushed digest on a real run on `main` and passes; the check, the scan, the SBOM and both attestations all refer to the one digest from the build step (A5). — confirmed by the lead after merge
- [x] A `tests/ci` test turns red if the built-image check in build.yml can run without the pushed digest being available to it. — tests/ci/build-main-only.test.ts: availability: a digest pull sits between push and check, or image.sh check pulls the digest itself (red until d9be8c0 added the pull); plus the same file's digest-form, Trivy-credential, SBOM-name and attestation-order pins
- [x] Before the PR, every build.yml step after the push that can run outside `main` (check, scan, SBOM) has been run against the already-pushed digest `sha256:16dcd6359bcde68498b5d83e583e3aad8d96525155b2906316bcf8ecb524b97a`, with commands and results recorded, so the next run on `main` is not their first. — @devops-engineer comment of 2026-11-10 ("Criterion 3, run off main against the pushed digest sha256:16dcd635..."): check, scan and SBOM run against it; re-run after the isolation change recorded in the second @devops-engineer comment
- [ ] A build.yml run on `main` is green end to end; `sha-<commit>-<run_id>` exists in GHCR. — confirmed by the lead after merge
- [ ] `gh attestation verify oci://ghcr.io/richmosko/polycarpic@<digest> --repo richmosko/polycarpic --signer-workflow richmosko/polycarpic/.github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners` passes from the lead's machine, and the SBOM attestation is present on the same digest. — confirmed by the lead after merge
- [ ] `gh workflow run release.yml -f commit=<that commit>` (dry run) prints the same digest as build.yml's summary (POLY-96 criterion 3, real-run half). — confirmed by the lead after merge
- [x] The container that `infra/ci/image.sh check` starts has no network and receives no environment, volume, added capability or host namespace, for a local tag and for a registry digest alike (seceng review of d9be8c0: the check runs a shell inside a not-yet-scanned image, in the job that can mint attestation tokens). — tests/ci/image-check-isolation.test.ts: no network: --network none; no environment and no volume reaches the container; no privilege escalation (mutation: adding -e/-v turned it red)
- [x] The design docs gain no status, changelog or "Changes in" text from this issue (user rule, 2026-11-11). — diff check: `git diff main...HEAD --name-only` lists no path under docs/ (branch changes only image.sh, tests/ci, the issue files, review notes and STATE)

## Comments

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-132-build-yml-first-run-fixes`. No new ruling: POLY-96's ruling and Addendum 1 are the contract. Gates: qa red → devops green → architect + seceng verdict on the diff. build.yml runs only on `main`, so the last three criteria are confirmed by the lead after merge.

### @devops-engineer — 2026-11-10

Fix: image.sh check <repo>@sha256:... now runs docker pull -q on the digest first (never a tag), because build.yml pushes without a local copy. tests/ci 161/161.
Criterion 3, run off main against the pushed digest sha256:16dcd635...b97a (pulled with the lead's gh token): (1) removed it from the local daemon, then bash infra/ci/image.sh check <ref>: exit 0 from empty (pull + User=node + no npm/npx/corepack/pnpm/yarn on PATH + no /usr/local/lib/node_modules); (2) image.sh scan <ref> with the pinned Trivy 0.76.2 container as the trivy binary: exit 0, no fixable CRITICAL/HIGH, no secrets; (3) image.sh sbom <ref>: exit 0, CycloneDX file 241 KB; (4) actionlint 1.7.12 over all workflows: clean.
NOT exercised (main only): the GHCR push itself, TRIVY_USERNAME/PASSWORD registry auth on the runner (locally Trivy read the daemon copy), actions/attest-build-provenance and actions/attest-sbom, upload of digest.txt+sbom artifact, release.yml dry run (needs a successful build run to exist).

### @architect — 2026-11-10

**Verdict (architect) on the diff 75c406e..d9be8c0: PASS. No ruling change.** POLY-96 ruling, Addendum 1, S96-1..22 and A1–A5 stand. `tests/ci` 161/161 locally (`pnpm exec vitest run -c tests/ci/vitest.config.ts`).

| axis | result | evidence |
|---|---|---|
| A4 checked on the built image | pass | `image.sh check` runs `docker pull -q` only for a `*@sha256:*` ref, then inspects and runs that ref; never pulls a tag. build.yml passes `"${IMAGE}@${DIGEST}"` with `DIGEST` = `steps.build.outputs.digest`. The PR `image` job (`polycarpic:ci`, a local tag) does not pull. |
| A5 one digest | pass | the pull is content-addressed by the build-step digest, so it fetches the same subject and resolves nothing new; check, scan, SBOM and both attests take that one env value; `build-main-only.test.ts` pins this order and the absence of any other digest lookup |
| Registry credentials for the pull | pass (structural); real run after merge | `docker/login-action` runs before the build step and writes the runner's Docker config for the rest of the job, so the later `docker pull` is authenticated; test "login precedes every registry step" |
| S96-20 no cache | pass | a pull by digest is a fetch of the attested subject, not a build cache: no `cache-from`, no `actions/cache`; buildx stays `no-cache: true`, `pull: true` |
| Criterion 2 (red test) | pass | e6d350a red, d9be8c0 green; the docker stub refuses a pull by tag and an inspect before the pull |
| Criterion 3 (off-main rehearsal) | pass | devops comment: check, scan and SBOM run on `sha256:16dcd635…b97a` from an empty daemon, all exit 0; actionlint clean |

Side effect, benign: after the check's pull, Trivy (`image.sh scan`, then `sbom`) can read the daemon copy of the same digest before going to the registry, so the scan does not depend on `TRIVY_USERNAME`/`TRIVY_PASSWORD` working on the runner `(unmeasured)`. The subject is identical either way.

Post-merge (lead; criteria 1, 4–6): build.yml green on `main` end to end, `gh attestation verify … --source-ref refs/heads/main --deny-self-hosted-runners`, the SBOM attestation present, and the release.yml dry run printing the same digest. Seceng-96's section has not reached me; it lands beside this verdict as `process/cairn/reviews/POLY-132/seceng.md` when it does.

### @team-lead — 2026-11-10

Scope note: the check-container isolation criterion was added after the architect's verdict at af04897, from seceng's review of d9be8c0 (`process/cairn/reviews/POLY-132/seceng.md`). It rides this issue because every build.yml change needs its own merge to prove on `main`. Also noted from the architect: once the check has pulled the digest, Trivy may scan the local copy, so a green run on `main` does not prove Trivy's own registry login; it matters only if the pull is ever removed.
### @devops-engineer — 2026-11-10

image.sh check now runs the container with --network none --cap-drop ALL --security-opt no-new-privileges; no -e, -v, --mount or --privileged (it never had any). tests/ci 169/169. Re-run after the change: check against the pushed digest sha256:16dcd635...b97a exit 0; check against a fresh local polycarpic:ci build exit 0.
