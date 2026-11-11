# POLY-96 — gate 1 ruling (architect)

Source: INFRA v1.3 §4.2–§4.4, issue criteria 1–11 @ 31d62ab. Builder: devops-engineer; tests: qa-engineer; supply-chain conditions: seceng-96's S96-1..22 (§7), folded.
Every claim below is a design rule unless tagged `(unmeasured)`; the unmeasured ones do not gate the build, they are what the stage evidence (§6) measures.

## Decided (lead + user, recorded)

- D1. Three stages, a commit gate after each: (1) the `app` check in ci.yml — criteria 1, 2, 4 (pin check), 5, 6, 8–11; (2) build.yml — criteria 2 (image build on push) and 4 (Trivy); (3) release.yml — criterion 3.
- D2. Criteria 8–11 are in the issue as of 31d62ab.
- D3. Criterion 7 (branch protection adds `app`) is the lead's action with the user's approval. Nobody on the team changes repository settings.
- D4. build.yml and release.yml cannot be fully proven from a PR; §6 says what is accepted before merge and what is confirmed after.

## 1. The seam — ci.yml

One workflow file, two independent check families. **`cairn` keeps its id, name, steps, top-level `on:`, `permissions:` and `concurrency:`**; its only edits are S96-7 (event data moves from `run:` into `env:`, behaviour identical, the `PATTERN`/`EXCLUDE`/`PINNED_RULINGS` literals byte-identical) and S96-4 (`persist-credentials: false`). The new jobs sit beside it and never `needs:` it, and it never `needs:` them. `app` is the only new name branch protection will ever see.

| job id = name | needs | runs when | does |
|---|---|---|---|
| `changes` | — | always | the filter (§2); outputs below; fails closed |
| `guard` | — | always, no `if` | (a) `node infra/ci/check-pins.mjs` over `.github/` and `infra/ci/` (S96-1: `owner/repo[/path]@<40-hex>` + `# vX.Y.Z`; `docker://…@sha256:<64-hex>`; local `./` ok; tag, branch, short sha, missing ref or any unparseable `uses:` → red); (b) the S96-7 check — no `${{ github.event.* }}` / `${{ github.head_ref }}` inside a `run:` body; (c) gitleaks over the PR commit range (S96-11, unconditional; pinned binary verified by sha256, S96-2). Always-on so none of the three can be skipped by a mis-wired filter. |
| `lint` | changes | `node \|\| layers \|\| image \|\| ci` | install; `node scripts/layers/check.mjs` + the `tests/layers` suite when `node \|\| layers`; `eslint` + `check-migrations` + `turbo run typecheck [--affected]` + `pnpm audit --audit-level high` (S96-12) when `node \|\| image`; the `tests/ci` suite + actionlint when `ci` |
| `unit` | changes | `node \|\| image` | `turbo run test --affected --summarize` (each package's own `vitest run` from its own dir, criterion 5); then the root cross-package suite `vitest run -c tests/config/vitest.config.ts` (config, image, log) |
| `db` | changes | `db` | one job, one Postgres per run: `vitest run -c tests/db/vitest.config.ts` through the existing `global-setup.ts` Docker path (same harness as local, POLY-84's RLS battery included, criterion 10). No service container: the harness already owns the one container. |
| `image` | changes | `image \|\| node` | `infra/ci/image.sh build` (load locally; no push, no `id-token`, no attest — S96-8; GIT_COMMIT = head sha). Stage 2 adds `image.sh scan` on the local image here, the same script build.yml calls. |
| `app` | the other six new jobs | `if: always()` | `node infra/ci/aggregate.mjs` with `NEEDS: ${{ toJSON(needs) }}` |

`app` aggregation, failing closed (criterion 1): red unless **all** of — `changes.result == success`; `guard.result == success`; every other job's result ∈ {`success`, `skipped`}; **and** for each output that is `true`, the job keyed to it is `success`, not `skipped` (catches a mis-wired `if:` — a skipped job whose output said run is red). Any unknown result string (`cancelled`, `failure`, missing key) is red. Docs-only PR: `changes`, `guard`, `app` run; the rest skip; `app` green.

Every new job declares its own `permissions: { contents: read }` (`actions: read` only where the API is called; S96-3), `runs-on: ubuntu-latest` (GitHub-hosted only, S96-5), `timeout-minutes` (lint 10, unit 15, db 15, image 20, others 5), and checks out with `persist-credentials: false` (S96-4). ci.yml references no `secrets.`; triggers stay `pull_request` + `workflow_dispatch` (S96-6). Install: `npm i -g --allow-scripts=pnpm pnpm@12.18.0` then `pnpm install --frozen-lockfile` (lifecycle scripts blocked, C-80); pnpm store cached by `hashFiles('pnpm-lock.yaml')`, in ci.yml only; never `node_modules`, `.turbo` or build outputs (S96-20). Turbo remote cache off. `onlyBuiltDependencies` is absent today, so gate 4 records pnpm 12's default refusing lifecycle scripts as a measurement (S96-12).

## 2. The change filter

Plain git + one Node script, no third-party filter action. `changes` checks out with `fetch-depth: 0`, computes `git diff --name-only <base> HEAD` (`set -euo pipefail`; a git error is a red job, never `false` outputs), pipes the list to `node infra/ci/changes.mjs`, which prints `key=true|false` lines to `$GITHUB_OUTPUT`. The mapping lives in `infra/ci/changes.mjs` as one table so the tests read the same table the job runs.

| output | true when any changed path matches |
|---|---|
| `node` | `packages/**`, `apps/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig*.json`, `eslint.config.js`, `.npmrc`, `tests/config/**`, `tests/image/**`, `tests/log/**` |
| `layers` | `layers.json`, `docs/ARCH/index.html`, `scripts/layers/**`, `tests/layers/**`, `eslint.config.js`, `packages/*/package.json`, `apps/*/package.json` (criterion 6: runs on an otherwise docs-only PR) |
| `db` | `packages/db/**`, `tests/db/**` — nothing else (criterion 10, see Open O2) |
| `image` | `Dockerfile*`, `.dockerignore`, `compose*.yml`, `Caddyfile*`, `infra/**` except `infra/ci/**`, `bin/**` |
| `ci` | `.github/workflows/**`, `infra/ci/**`, `tests/ci/**` |

Everything else (docs/**, process/**, *.md, prototype/**, spikes/**) sets nothing. Base: `pull_request` → `github.event.pull_request.base.sha`. `workflow_dispatch` gains one optional input `base`: empty → every output `true` (full run, the weekly-style check); set → must match `^[0-9a-f]{40}$` (validated in shell, passed via `env:`, never interpolated into `run:`, S96-7) and the filter runs on `base..HEAD` — this is how a real run proves criterion 1 and fail-closed from the branch (§6). `TURBO_SCM_BASE` is set to the same base so `--affected` and the filter agree; on a full run `--affected` is dropped. Turbo treating a root-file change as "all packages affected" is relied on `(unmeasured)`.

## 3. Timings, budgets, metrics (criteria 8, 9, 11)

`infra/ci/job-report.mjs`, last step of `lint`/`unit`/`db`/`image` with `if: always()`: reads the job start epoch (first step writes it to `$GITHUB_ENV`) and, where present, `.turbo/runs/*.json` from `--summarize`; writes to `$GITHUB_STEP_SUMMARY` one table — job wall-clock, then per-package task durations; emits `::warning title=budget::<job> <n>s > <b>s` when over, never a non-zero exit. Budgets live in `infra/ci/budgets.json`: `lint` job 120 s (lint + types), each package's `test` task 120 s, `db` job 180 s; `image` and `unit` job totals report with no budget. Today's figures are baseline-only: `tests/db` ≈ 45 s locally; CI figures `(unmeasured)` until the stage-1 dispatch run.

Criterion 11 — **split; the ingest half needs a lead decision.** The CI half is in this issue: `job-report.mjs` also writes one line per job to `$RUNNER_TEMP/ci-test-runs.jsonl` in the existing `test-runs.jsonl` schema (`who: "ci"`, `runner: "ci:<job>"`, `full` true only on a full-run dispatch, `sha`, `branch`, `seconds`, `ok`, counts where known, `session: <run_id>`), uploaded as artifact `ci-test-runs-<job>` (retention 30 d). Timings and test names only — no env, no context dump (S96-14). CI does **not** write the `metrics` branch or any ref: that needs `contents: write` on a PR-triggered workflow (C-81, S96-14), and `metrics` is unprotected. The ingest — `gh run download` into the metrics worktree at `/finish-feature`, plus `loop_stats.py` computing `suite_seconds_added` per `runner` so CI full runs never diff against local cairn full runs — touches `scripts/cairn/` and `.claude/skills/`, outside `paths:` and the tooling suite's trigger. Recommendation: a follow-up issue under the cairn-tooling umbrella; criterion 11 is ticked here on the artifact half only if the lead re-words it, otherwise it stays open on POLY-96 until the follow-up lands.

## 4. build.yml (stage 2)

`on: push: branches [main]`, `schedule` (weekly), `workflow_dispatch`; **every job carries `if: github.ref == 'refs/heads/main'`** (S96-15). The weekly run lives in this file, never in a second one. Top-level `permissions: {}`. No cache is restored anywhere in this file: buildx `no-cache: true`, `pull: true`, no `cache-from`, no `actions/cache`, Trivy DB fetched fresh (S96-20). Concurrency group per sha, no cancel.

Job `build` (push and dispatch, not schedule; `contents: read`, `packages: write`, `id-token: write`, `attestations: write`). Order (S96-16, superseding my scan-before-push draft): `image.sh build` + push `ghcr.io/richmosko/polycarpic:sha-<commit>` → digest from the build step's output, never re-resolved from a tag → `image.sh scan` on that digest (Trivy `--scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`; each `.trivyignore` entry carries CVE id + expiry + issue id, and an expired entry fails, S96-10) → CycloneDX SBOM from the pushed digest → `actions/attest-build-provenance` (`subject-digest` from the build output, `push-to-registry: true`) → `actions/attest-sbom` on the same digest → `digest.txt` + SBOM uploaded as artifact `image-<commit>`, digest written to the step summary. **Nothing is attested unless Trivy passed**; a failed image may sit in GHCR unattested and no verifier accepts it. Only `GIT_COMMIT=${{ github.sha }}` crosses into the build (S96-18, S96-19).

Job `weekly-scan` (schedule only; `contents: read`, `packages: read`, `actions: read`): Trivy on the newest attested main digest. **Scan-only: no rebuild, no push, no attest.** Every `FROM` is pinned by digest, so a rebuild picks up no base-image patch; patches arrive as digest-bump PRs. This keeps one attested digest per commit in the normal case. It deviates from INFRA §4.3's "rebuild from main"; devops corrects that row in stage 2. The restore-drill reminder stays with POLY-100.

Caddy and tools images: no Dockerfile for either exists. `image.sh` takes an image name; build.yml holds a one-entry list; POLY-95/POLY-97 add entries (each `FROM …@sha256:`, xcaddy plugins by module version, same revision label — S96-18, S96-19). The description is narrowed accordingly.

## 5. release.yml (stage 3)

`on: push: tags ['v1.*']` (S96-21), plus `workflow_dispatch` with input `commit` (40-hex, via `env:`) that is **dry-run only**: a deviation from S96-21's "tags only", for the post-merge evidence in §6, held to least privilege by splitting the jobs. Top-level `permissions: {}`.

- Job `verify` (`contents: read`, `packages: read`, `attestations: read`, `actions: read` for the artifact download; no `id-token`): (1) on a tag, the tag is annotated and `git verify-tag` passes against a signer list in a repository **variable** (missing → fail; the box's `allowed_signers` stays the authority), and the tag commit is reachable from `origin/main` (S96-21.1–2); (2) digest = `digest.txt` from the **newest successful build.yml run on `main` with `head_sha == commit`**; none → fail, nothing published (S96-21.3); (3) image label `org.opencontainers.image.revision == commit`; (4) `gh attestation verify oci://ghcr.io/richmosko/polycarpic@<digest> --repo richmosko/polycarpic --signer-workflow richmosko/polycarpic/.github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners` (S96-15). Output: the digest.
- Job `publish` (`needs: verify`, `if: github.event_name == 'push'`; `contents: write` only): refuse if a Release for the tag exists (S96-21.5); body exactly `digest: sha256:…`; the SBOM as an asset.

No `docker build`, `buildx`, `docker push` or `pnpm install` anywhere in the file, and no `packages: write`: release cannot rebuild by construction (S96-22). Logic lives in `infra/ci/release-lookup.sh`, testable with stub `gh`/`git`/`docker` on `PATH`. M1 has `target_tag: null`, so no real tag fires this milestone. Setting the signer variable is a repository setting: the lead's, with the user (D3).

## 6. Where tests live; local vs real-run evidence

Tests: `tests/ci/*.test.ts`, own config `tests/ci/vitest.config.ts`, run by the `lint` job on `ci`. They join an existing job — no new top-level job (POLY-96 steer). They are not under `tests/workflow/` (that is the cairn tooling suite's Python home and runs in `cairn`).

Locally assertable (must be red before the build — qa's gate 2): the filter table on fixture path lists (docs-only → all false; `layers.json` alone → `layers` only; `packages/db/x` → `node`+`db`+`layers` false; `infra/ci/x` → `ci` not `image`; …); `changes.mjs` exits non-zero on empty or unreadable input; `aggregate.mjs` over fixture `needs` JSON (every rule in §1, including skipped-while-output-true → red, cancelled → red); `check-pins.mjs` on fixture workflows (tag ref, branch ref, short sha, missing comment, `docker://` without digest → red; local `./` → ok) and on the real `.github/workflows/`; `job-report.mjs` on a fixture turbo summary (table rendered, warning emitted over budget, exit 0, JSONL schema keys equal the existing file's); YAML structure of ci.yml (job ids and names, `app` `needs` every other new job and has `if: always()`, `cairn`'s filter literals byte-identical to 31d62ab, no workflow-level `paths:`, per-job permissions within S96-3, `persist-credentials: false` on every checkout, no `secrets.`, no event expression in a `run:` body); build.yml / release.yml structure (triggers, every job's main-ref `if`, per-job permissions, the scan step before both attest steps, no cache restore, no build/push/install step and no `packages: write` in release, `publish` unreachable on dispatch, the verify line carrying `--source-ref` and `--deny-self-hosted-runners`); `release-lookup.sh` with stubs (missing image → non-zero, label mismatch → non-zero, attestation failure → non-zero, body is the one line).

Only on a real run: GitHub's `needs`/`skipped` semantics, `--affected` base detection on the runner, Docker on the runner, the step summary rendering, GHCR push and attestation, branch protection.

Accepted before merge:
- Stage 1: the PR's own run green (it touches `ci`, so `lint` runs `tests/ci`); `gh workflow run ci.yml --ref <branch>` (full) green with every job's summary table — this is the CI baseline measurement; `-f base=<HEAD~1>` where HEAD is an issue-file-only commit → only `changes`/`guard`/`app` ran, `app` green (criterion 1); `-f base=<40 zeros>` → `changes` red, `app` red (fail closed). Run the red probe **first**, so the latest `app` on the head sha is green. If GitHub rejects the input on a branch-only workflow version `(unmeasured)`, criterion 1's real-run half moves to post-merge.
- Stage 2: local `tests/ci` green; the PR `image` job runs build + scan green on the real image; a local `image.sh scan` against a fixture image carrying a fake secret and against an old pinned base with a known fixable HIGH both exit non-zero (qa records the commands and results).
- Stage 3: local `tests/ci` green with stubs; a local `git verify-tag` against a throwaway signed tag and signer list (never pushed).

Confirmed on the first push to `main` after merge (lead, recorded on the issue): build.yml run green; `sha-<merge commit>` exists in GHCR; `gh attestation verify … --source-ref refs/heads/main --deny-self-hosted-runners` on that digest passes from the lead's machine; SBOM attestation present; then `gh workflow run release.yml -f commit=<merge commit>` (dry run) prints the same digest as build.yml's summary (criterion 3). A failure here is a fix-forward bug on POLY-96's area, not a revert — nothing consumes the images until POLY-100.

## 7. Supply-chain conditions (seceng-96, S96-1..22)

Source: `/Users/mosko/Projects/polycarpic/.claude/worktrees/seceng-96/temp/2026-11-10-seceng-poly96-conditions.md` (the lead places it). All 22 are adopted and cited inline where folded. The three that conflicted with my draft are ruled:
- S96-16 order adopted (push → scan the pushed digest → SBOM → attest), superseding scan-before-push: the scanned digest is then exactly the attested one.
- S96-15 weekly run in build.yml adopted, as **scan-only** (§4) rather than a rebuild; it attests nothing, so it adds no signer path.
- S96-21 "tags only" kept for publishing; a dry-run `workflow_dispatch` reaches `verify` only (§5).
Routed, not built here: S96-13 CodeQL → a follow-up issue (the lead files the id; it is not in criteria 1–11 and adds minutes to every PR, unmeasured); S96-12 `minimumReleaseAge` → lead. The SECURITY C-81/82/83 bump (seceng) and the INFRA §4.4 `--source-ref` amendment (devops) land in this loop. Tag-ruleset and environment proposals are the lead's to put to the user.

## 8. paths: widening

Add to `paths:`: `process/cairn/reviews/POLY-96/**` (this file), `docs/SECURITY/**` (seceng's C-81..83 bump), `.trivyignore` (S96-10), `.gitleaks.toml` (only if test fixtures need an allowlist), `.dockerignore` (image context), `bin/**` only if `image.sh` needs an entrypoint change (not expected). Everything else (`infra/ci/**`, `tests/**`, the three workflow files, `docs/INFRA/**`) is already listed.

## Open (non-gating)

- O1. Criterion 11's ingest half — lead decision (§3).
- O2. Criterion 10 keys the battery to `packages/db/**` + `tests/db/**` only, so a lockfile bump of `drizzle-orm`/`pg` runs no battery on the PR. Weekly-scan does not run it either. Lead may widen `db` to `pnpm-lock.yaml`; cost ≈ the battery on every dependency bump `(unmeasured in CI)`.
- O4. The CodeQL follow-up id (S96-13): lead.
- O3. The INFRA §4.3 rows for auth routing, route-policy, compose-policy lint and the Vercel topology check have no code to run yet; their outputs are added by the issues that bring that code (POLY-95, the auth features), as rows in `changes.mjs`.
