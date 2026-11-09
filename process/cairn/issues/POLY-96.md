---
id: POLY-96
title: CI: change filter, build, attest
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [.github/workflows/ci.yml, .github/workflows/build.yml, .github/workflows/release.yml, infra/ci/**]
labels: [ci, supply-chain]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

INFRA §4.2–§4.4: a changes step inside the job (no workflow-level paths:), one app aggregate required check, build.yml on push to main (one adapter-node image plus Caddy and tools images, Trivy, CycloneDX SBOM, provenance attestation, GHCR by digest), release.yml on a signed v1.* tag that never rebuilds, the action-pin check (C-81) and a weekly rebuild. Runs the RLS battery on packages/db changes.

## Acceptance criteria

- [ ] A docs-only PR starts no app job, yet app is green; the filter failing fails app closed.
- [ ] packages/* and apps/* changes run lint, types and Vitest on the affected packages (Turborepo graph); packages/db/** adds the DB battery; compose, Dockerfile and infra/** changes run lint and the image build.
- [ ] The digest in the release equals the one built for that commit; release.yml never rebuilds.
- [ ] An unpinned uses: fails the check; Trivy fails on fixable critical or high findings and on embedded secrets.
- [ ] Branch protection adds app (team-lead, user-approved).
