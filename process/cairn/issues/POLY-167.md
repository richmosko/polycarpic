---
id: POLY-167
title: Build red: tools image base pin
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/backup/**, infra/ci/**, infra/compose/**, .github/workflows/**, renovate.json, tests/infra/**, tests/ci/**, tests/image/**, process/cairn/reviews/**, process/cairn/issues/POLY-167.md, docs/SECURITY/**, docs/INFRA/**]
labels: [ops, security, ci]
priority: null
pr: null
created: 2026-11-27
updated: 2026-11-27
---

The `build` workflow on `main` fails at "Trivy scan of tools" (run 46047894114, commit 61c5d206, 2026-11-27): CVE-2025-6020 (HIGH, linux-pam, fixed in 1.5.2-6+deb12u3) in `polycarpic-tools`. `infra/backup/tools.Dockerfile` pins `debian:bookworm-slim` by a digest that predates the fix and installs no upgrades on top. The gate held: nothing was signed or published and staging stays on 5275880. Until it is fixed no build of `main` succeeds, so nothing new reaches staging. The `siblings` job stops at its first failure, so the scans after the tools scan have not been seen on today's vulnerability data.

## Acceptance criteria

- [ ] The `build` workflow is green on `main` after the merge, every scan included, and staging deploys that build healthy.
- [ ] The tools image carries the fix: its Debian base is at the registry's current digest and Debian updates are applied at build. The scan is shown red on the old image and green on the new one.
- [ ] Every other image the build scans passes on current vulnerability data, or its fix is in this change.
- [ ] seceng states why no update arrived for the stale pin and what keeps a digest pin fresh from here (a rule in this change, or a named issue).

## Comments

### @team-lead — 2026-11-27

Feature started. Branch: `feature/poly-167-tools-image-base-pin`.

### @team-lead — 2026-11-27

Second criterion reworded, 2026-11-27. devops-167 measured that the registry's current `debian:bookworm-slim` digest (e67eeead…, built 2026-11-23) still carries libpam 1.5.2-6+deb12u2: the fix is in bookworm-security only, so no official digest of the tag carries it today. The fix is the digest bump plus `apt-get upgrade` in the tools image's final stage (seceng-167's R1 and R2).
