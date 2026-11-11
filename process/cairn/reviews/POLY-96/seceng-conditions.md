---
kind: finding
target: process/cairn/issues/POLY-96.md (architect folds into the gate-1 ruling)
---

# POLY-96 — seceng conditions for ci.yml / build.yml / release.yml

Sources read: POLY-96.md @ 31d62ab, ci.yml, Dockerfile, .dockerignore, INFRA §4.2–§4.4, SECURITY §8 (C-80–C-83), C-74.
Each condition is gate-4 checkable. "new" = no SECURITY control covers it today (SECURITY bump listed at the end).

## A. Action pinning (C-81)

- **S96-1 (C-81).** Every `uses:` in every workflow, and in any local composite action under `.github/` or `infra/ci/`, is `owner/repo[/path]@<40-hex>` with a `# vX.Y.Z` comment. `docker://` uses are `@sha256:<64-hex>`. The pin check fails on a tag, a branch, a short sha, or a `uses:` it cannot parse (fail closed — an unknown form is a failure, not a skip). It runs on every PR that touches `.github/workflows/**` or `infra/ci/**`, and its own test proves `@v4`, `@main`, `@abc1234` and a missing ref each fail.
- **S96-2 (C-81, new detail).** Tools downloaded in a `run:` step (Trivy, gitleaks, a CycloneDX generator, turbo if fetched) are pinned by version and verified by sha256 before execution; no `curl | sh`. No third-party path-filter action (the tj-actions/changed-files compromise, March 2025, is the class) — keep the in-house `git diff` changes step that ci.yml already uses.

## B. Permissions and token scope (C-81)

- **S96-3 (C-81).** Each workflow sets top-level `permissions: {}` (or `contents: read`) and widens per job only. Allowed widenings, nothing else:
  - ci.yml (all jobs): `contents: read`, `actions: read` (changes step). No `packages`, `id-token`, `attestations`, or any write.
  - build.yml build/push/attest job: `contents: read`, `packages: write`, `id-token: write`, `attestations: write`. Scan-only or SBOM-only jobs, if split out, get no write.
  - release.yml: `contents: write` (create the Release), `packages: read`, `attestations: read`. No `id-token`, no `packages: write`.
- **S96-4 (new).** Every `actions/checkout` sets `persist-credentials: false`, except a job that must push — and no job in this feature pushes to git (see S96-14).
- **S96-5 (C-81).** Only `GITHUB_TOKEN`. No PAT, no repository secret is referenced by ci.yml at all (`grep -n 'secrets\.' ci.yml` returns nothing). GitHub-hosted runners only, never `self-hosted` (new: a fork PR on a self-hosted runner is a host takeover).

## C. Pull requests from a fork (C-81)

- **S96-6 (C-81).** ci.yml triggers on `pull_request` (and `workflow_dispatch`) only. No `pull_request_target`, no `workflow_run` that checks out PR code. A fork PR therefore runs with a read-only token and no secrets; the DB battery's Postgres password is generated per run (`openssl rand -hex 24`), passed through `::add-mask::`, and never echoed.
- **S96-7 (new — existing defect).** No `${{ github.event.* }}` / `${{ github.head_ref }}` expression is interpolated into a `run:` body; event data enters scripts only through `env:`. Today ci.yml's changes step does `HEAD_REF="${{ github.event.pull_request.head.ref }}"` inside `run:`. A branch name may contain `$(…)` and backticks (git allows them), so a PR branch named to inject runs arbitrary shell in the cairn job. Impact is bounded today (read-only token, no secrets), but the app job inherits the pattern and the DB/turbo steps will see more context. Fix in this loop (ci.yml is in `paths:`): move `HEAD_REF`, `BASE_SHA`, `PR_HEAD`, `REPO`, `event_name` to `env:` and reference `"$HEAD_REF"` in the script. Gate-4 check: `grep -nE '\$\{\{ *github\.(event|head_ref)' .github/workflows/*.yml` matches only `env:`/`with:`/`if:` lines, never a `run:` body.
- **S96-8.** No PR job pushes an image, requests `id-token`, or attests. A PR image build (compose/Dockerfile/infra paths) uses `push: false` and loads locally for Trivy.

## D. The `app` aggregate (fail closed)

- **S96-9.** `app` has `if: always()`, `needs:` every app job plus the changes job, and fails when any need is `failure` or `cancelled`, or when the changes job is anything but `success`. `skipped` is accepted only for a job the changes output turned off. Gate-4 check: a forced failure of the changes step leaves `app` red (criterion 1).

## E. Trivy, gitleaks, audit (C-80, C-82)

- **S96-10 (C-82).** Trivy on each image (app, Caddy, tools): `--scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`, by image digest. Trivy version pinned (S96-2); vulnerability DB fetched fresh each run, not from a cache a PR wrote. A `.trivyignore` entry carries a CVE id, an expiry date and an issue id; seceng reviews every entry; an expired entry fails the scan.
- **S96-11 (C-82).** gitleaks runs on every PR over the PR's commit range, **unconditionally** — not behind the changes filter (a secret pasted into docs/ or process/ is the likely case). Pinned binary per S96-2. Findings fail `app` (or a sibling required step that `app` needs).
- **S96-12 (C-80).** `pnpm install --frozen-lockfile` everywhere (ci.yml, build.yml, Dockerfile). Lifecycle scripts blocked except the explicit `onlyBuiltDependencies` allowlist — today no allowlist is present in package.json / pnpm-workspace.yaml, so gate 4 confirms pnpm 12's default refuses scripts and records the measurement. `pnpm audit --audit-level high` gates `app`. Not in this loop's code but noted: `minimumReleaseAge` (C-80) is not set in pnpm config — flag to lead, not a POLY-96 blocker unless the ruling takes it.
- **S96-13 (C-82).** CodeQL is listed in C-82 and INFRA §4.2. Either it lands here or the ruling files a follow-up with an id; it is not silently dropped.

## F. CI metrics (criterion 11)

- **S96-14 (new).** No CI job commits or pushes to the repository. Criterion 11 (`process/cairn/metrics/test-runs.jsonl`) is satisfied by CI publishing timings as an artifact / step summary that a local cairn step ingests — never by giving a PR job `contents: write`. Step summaries and the JSONL carry timings and test names only: no `env`, no `set -x` around a secret, no runner context dump.

## G. Build, SBOM, attestation, registry (C-82, C-83)

- **S96-15 (C-83, new detail — load-bearing).** build.yml triggers on `push: branches: [main]` and `schedule:` only; if `workflow_dispatch` is kept, the job carries `if: github.ref == 'refs/heads/main'`. **The weekly rebuild lives in build.yml itself**, never in a second file, so every attested image has signer workflow `.github/workflows/build.yml`.
  The gap: a push to any branch that edits build.yml to trigger on that branch runs *that branch's* build.yml with `packages: write` + `id-token: write`, and the resulting attestation still names `.github/workflows/build.yml` — `gh attestation verify --signer-workflow .github/workflows/build.yml` (C-83 as written) accepts it. Agents push feature branches to origin every loop. Therefore C-83's box check and release.yml's check both add `--source-ref refs/heads/main` (and `--deny-self-hosted-runners`). Gate-4 check: release.yml's verify call carries both flags; INFRA §4.4 and SECURITY C-83 are amended to match (POLY-100 builds the box side).
- **S96-16 (C-82).** Order inside the build job: build → push to GHCR by the sha tag → Trivy on the pushed digest → SBOM → attest. **Nothing is attested unless Trivy passed**; a failing image may sit in GHCR but carries no attestation, so no box runs it. The digest used everywhere comes from the build step's output (`steps.<id>.outputs.digest`), never from re-resolving a tag.
- **S96-17 (C-82).** CycloneDX SBOM generated from the pushed image digest (not the source tree), attached with `actions/attest-sbom` (or `attest` with the CycloneDX predicate) to the same subject digest, and uploaded so release.yml can attach it to the Release. Provenance with `actions/attest-build-provenance`, `subject-name: ghcr.io/richmosko/polycarpic[-caddy|-tools]`, `subject-digest` from the build output, `push-to-registry: true`. Same for Caddy and tools images.
- **S96-18 (C-83).** The image's `org.opencontainers.image.revision` is `${{ github.sha }}` (Dockerfile already refuses a non-40-hex `GIT_COMMIT`); Caddy and tools images carry the same label. Image references in compose, release body and the deploy path are `@sha256:` digests; tags are labels for humans only.
- **S96-19 (C-74).** No secret in any build arg, `ENV` or layer; build.yml passes only `GIT_COMMIT`. Base images `FROM …@sha256:` (the app Dockerfile does; Caddy and tools Dockerfiles must too). Caddy plugins built with xcaddy pinned by module version.

## H. Cache poisoning between PR and main

- **S96-20 (new).** The attested build in build.yml restores **no** cache: buildx `no-cache: true`, `pull: true`, no `cache-from: type=gha`, no `actions/cache` restore (pnpm store, `.turbo`, Trivy DB). The weekly rebuild likewise. Rationale: GitHub lets a PR run read the default branch's caches and any run on `main` that restores a cache entry trusts whoever wrote it; the attested image must be a function of the commit only. ci.yml may cache the pnpm store keyed by `hashFiles('pnpm-lock.yaml')` (frozen-lockfile re-verifies integrity hashes); it never caches `node_modules`, build outputs or `.turbo`. Turborepo remote cache stays off (INFRA §4.3). If the no-cache build busts the 15-minute budget, the architect re-rules with a measurement — not a silent switch to `type=gha`.

## I. release.yml (C-83 Signing)

- **S96-21 (C-83).** Trigger `push: tags: ['v1.*']` only. Steps, each fail closed:
  1. The tag is annotated and `git verify-tag` passes against a signer list from a repository **variable** the operator sets (not a file in the repo — anyone who can push could add a key). Variable missing ⇒ fail. This is a fail-fast mirror; the box's `/etc/polycarpic/allowed_signers` stays the authority.
  2. The tag's commit is reachable from `origin/main` (`git merge-base --is-ancestor`), so a feature-branch commit cannot be released.
  3. Look up the digest built for that commit: the newest successful build.yml run on `main` for `head_sha == tag commit`; with weekly rebuilds there can be several, the rule is "newest", stated in the ruling. Missing ⇒ fail, nothing deploys.
  4. `gh attestation verify oci://…@<digest> --repo richmosko/polycarpic --signer-workflow .github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners`, and the image's revision label equals the tag commit.
  5. Refuse if a Release for that tag already exists (no overwrite). Body is the one `digest: sha256:…` line plus the SBOM asset.
- **S96-22.** release.yml contains no `docker build`, `buildx`, `docker push` or `pnpm install` step; gate-4 check is a grep, plus criterion 3's digest equality.

## Not ours to do (user / lead)

- Tag ruleset blocking deletion and update of `v*` tags, and an environment restricting build.yml's push job to `main`, are repository settings — proposals for the lead to put to the user, not team actions. S96-15's `--source-ref` closes the hole without them.

## SECURITY bump this loop implies (§8, controls row C-80–83)

- C-81: add S96-4 (`persist-credentials: false`), S96-5 GitHub-hosted only, S96-7 (no event expressions in `run:`), S96-14 (CI never writes the repo), S96-20 (attested build restores no cache).
- C-82: add S96-16 (attest only after scan) and S96-11 (gitleaks unconditional).
- C-83: add `--source-ref refs/heads/main --deny-self-hosted-runners` to the verify line; weekly rebuild in build.yml; release.yml's checks as a fail-fast mirror. New threat row: T-64 variant "branch-built image attested as build.yml".
