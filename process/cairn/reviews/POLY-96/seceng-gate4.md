
# POLY-96 gate 4: seceng section (S96-1..22, Addendum 1 A1–A5)

Reviewed head cbcb54e, code 5c5ffff (5c5ffff..cbcb54e touches only POLY-96.md). Runs: 42953489577 (zeros base), 42953687382 (full), 42954075715 (docs-only). The read-only checks are in `temp/gate4.sh` in the seceng-96 worktree.

| axis | result | evidence |
|---|---|---|
| S96-1 pins (C-81) | pass | `check-pins.mjs .github infra/ci` rc 0 locally @5c5ffff and in guard on run 42953687382 |
| S96-2 fetched tools pinned + sha256 | pass | Trivy 0.76.2 (`install-trivy.sh`, "trivy.tgz: OK" in run log); gitleaks 8.30.1 sha256-checked in guard; changes filter is in-house git diff |
| S96-3 permissions per job | pass | build.yml/release.yml top-level `{}`; ci.yml top `contents/actions: read`, every new job `contents: read`; build: +packages/id-token/attestations write; release verify: read-only; publish: `contents: write` only @5c5ffff |
| S96-4 persist-credentials:false | pass | every checkout in the 3 files (awk scan, 0 misses) @5c5ffff |
| S96-5 GITHUB_TOKEN only, hosted runners | pass | no `secrets.`, no `self-hosted` in any workflow @5c5ffff |
| S96-6 fork-PR posture | pass | ci.yml on `pull_request` + `workflow_dispatch` only; no `pull_request_target`/`workflow_run` trigger @5c5ffff |
| S96-7 no event expr in run: | pass | `check-run-expr.mjs` rc 0; independent awk scan: zero `${{` inside any run body in all 3 files; cairn's HEAD_REF now via env @5c5ffff |
| S96-8 PR image local only | pass | ci.yml `image` job: `image.sh build` (docker build, no push), no write/id-token @5c5ffff |
| S96-9 app fails closed | pass | run 42953489577: changes=failure → app=failure; 42954075715 docs-only: app=success with lint/unit/db/image skipped |
| S96-10 Trivy thresholds + .trivyignore | pass | `image.sh scan`: vuln,secret / CRITICAL,HIGH / ignore-unfixed / exit-code 1; ignorefile entry needs expires+issue, expired fails; scan green on run 42953687382 |
| S96-11 gitleaks unconditional | pass | guard has no `if`; "no leaks found" on run 42953687382; ran on docs-only run 42954075715 |
| S96-12 frozen lockfile, scripts blocked, audit | pass | `strict_dep_builds=false` only on 3 ci.yml install steps; run log "Ignored build scripts: esbuild…" (not executed); my fixture measurement (scripts never run either way); `pnpm audit --audit-level high` in lint |
| S96-13 CodeQL | routed | not built; follow-up id still open (O4, lead) |
| S96-14 CI never writes repo | pass | no write scope in ci.yml; timings as artifacts `ci-test-runs-<job>` |
| S96-15 main-only builds, --source-ref | pass (CI side) | every build.yml job `if: github.ref == 'refs/heads/main'`; weekly in build.yml; `release-lookup.sh` verify carries `--source-ref refs/heads/main --deny-self-hosted-runners`; box side is POLY-100's |
| S96-16 attest only after scan, one digest | pass | build.yml order: push → check → Trivy → SBOM → provenance → SBOM attest, all from `steps.build.outputs.digest` (A5) |
| S96-17 SBOM + provenance | pass (static) | Trivy CycloneDX from the pushed digest; attest-build-provenance + attest-sbom, push-to-registry. Real run is post-merge (ruling §6) |
| S96-18 revision label, by-digest refs | pass | build-arg GIT_COMMIT=github.sha; release-lookup checks label == commit and resolves by digest only |
| S96-19 no secret in build | pass | only GIT_COMMIT crosses; Trivy secret scanner green |
| S96-20 no cache in attested build | pass | build-push `no-cache: true`, `pull: true`; no cache-from/type=gha/actions/cache in build.yml or release.yml; PR store cache keyed by lockfile hash |
| S96-21 release checks | pass (static + stub tests) | annotated + `git verify-tag` against `vars.RELEASE_SIGNERS` (empty → fail), ancestor of origin/main, newest successful main run, label, attestation, refuses existing Release; dispatch cannot reach `publish` |
| S96-22 release never builds | pass | no build/buildx/push/install/packages:write in release.yml |
| A1 apt trust | pass | Dockerfile: `apt-get update && upgrade` only; no source, key or insecure flag (grep empty); run log "4 upgraded, 0 newly installed" |
| A2 unique tag, no shared tag before attest | pass | only tag pushed is `sha-<sha>-<run_id>`; no shared tag exists at all |
| A3 weekly scans prod release | pass (static) | `release-scan` job, schedule-only, scan-only, no-op without a v1.* Release |
| A4 no package manager, non-root | pass | `image.sh check` on built image, green in run 42953687382 and before scan in build.yml |

Non-blocking notes:
- N1. `release-lookup.sh` verifies the provenance attestation but not the SBOM attestation. C-82 needs the SBOM on the release, and it is attached as an asset. Confirm the SBOM attestation in the post-merge check (§6), or add `gh attestation verify --predicate-type https://cyclonedx.org/bom` on a later loop.
- N2. Post-merge (ruling §6, lead): the real build.yml run, the GHCR digest, `gh attestation verify … --source-ref refs/heads/main --deny-self-hosted-runners` from the lead's machine, and the release dry run all remain open.
- N3. `RELEASE_SIGNERS` repository variable must be set by the user before the first v1.* tag; until then a tag release fails closed (intended).
- N4. POLY-100 must take A2 and `--source-ref` on the box side; until it does, C-83's box check is design only.

Verdict: **pass** on every condition except S96-13 (routed). Nothing blocks the ship.
