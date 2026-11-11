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

- [ ] build.yml's built-image check runs against the pushed digest on a real run on `main` and passes; the check, the scan, the SBOM and both attestations all refer to the one digest from the build step (A5).
- [ ] A `tests/ci` test turns red if the built-image check in build.yml can run without the pushed digest being available to it.
- [ ] Before the PR, every build.yml step after the push that can run outside `main` (check, scan, SBOM) has been run against the already-pushed digest `sha256:16dcd6359bcde68498b5d83e583e3aad8d96525155b2906316bcf8ecb524b97a`, with commands and results recorded, so the next run on `main` is not their first.
- [ ] A build.yml run on `main` is green end to end; `sha-<commit>-<run_id>` exists in GHCR.
- [ ] `gh attestation verify oci://ghcr.io/richmosko/polycarpic@<digest> --repo richmosko/polycarpic --signer-workflow richmosko/polycarpic/.github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners` passes from the lead's machine, and the SBOM attestation is present on the same digest.
- [ ] `gh workflow run release.yml -f commit=<that commit>` (dry run) prints the same digest as build.yml's summary (POLY-96 criterion 3, real-run half).
- [ ] The design docs gain no status, changelog or "Changes in" text from this issue (user rule, 2026-11-11).

## Comments

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-132-build-yml-first-run-fixes`. No new ruling: POLY-96's ruling and Addendum 1 are the contract. Gates: qa red → devops green → architect + seceng verdict on the diff. build.yml runs only on `main`, so the last three criteria are confirmed by the lead after merge.

### @devops-engineer — 2026-11-10

Fix: image.sh check <repo>@sha256:... now runs docker pull -q on the digest first (never a tag), because build.yml pushes without a local copy. tests/ci 161/161.
Criterion 3, run off main against the pushed digest sha256:16dcd635...b97a (pulled with the lead's gh token): (1) removed it from the local daemon, then bash infra/ci/image.sh check <ref>: exit 0 from empty (pull + User=node + no npm/npx/corepack/pnpm/yarn on PATH + no /usr/local/lib/node_modules); (2) image.sh scan <ref> with the pinned Trivy 0.76.2 container as the trivy binary: exit 0, no fixable CRITICAL/HIGH, no secrets; (3) image.sh sbom <ref>: exit 0, CycloneDX file 241 KB; (4) actionlint 1.7.12 over all workflows: clean.
NOT exercised (main only): the GHCR push itself, TRIVY_USERNAME/PASSWORD registry auth on the runner (locally Trivy read the daemon copy), actions/attest-build-provenance and actions/attest-sbom, upload of digest.txt+sbom artifact, release.yml dry run (needs a successful build run to exist).
