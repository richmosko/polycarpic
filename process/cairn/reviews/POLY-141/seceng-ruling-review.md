# POLY-141 seceng review of the gate-1 ruling (R3, R4, Merge gate, C8–C11, C14–C19)

Head 8f3fa2d. Question: can any skip let a change merge that a full run would have failed?

**Verdict: pass with conditions (S1–S8).** The anchor rule is sound. The safety argument does not depend on which green run is
picked: it holds when (a) some run with `head_sha` A from this repository passed, (b) the current base is in A, and (c) the trees
of A and the head differ only in files that nothing reads except the ledger tests, which still run. Every spoofing route below fails
on (a), (b) or (c), or makes the diff bigger. What can break the rule is a diff that leaves paths out, or outputs the aggregate
accepts when it should not. Two holes of that kind exist **today**, outside the anchor (S1, S2).

Probes: scratch-repo script
`/private/tmp/claude-501/-Users-mosko-Projects-polycarpic/b17028eb-1453-4ef1-ba41-875181397c90/scratchpad/probe.sh`
(P1–P5), the runs API against this repo, and `evaluate()` from `infra/ci/aggregate.mjs` called with fixtures. Not committed.

## 1. The anchor

| Route | Result | Basis |
|---|---|---|
| Fork PR | Safe | Step 2 rejects a run whose `head_repository` is not this repository. A fork whose head *contains* one of our green commits A, plus ledger-only commits, passes (c): its tree is A's tree. The repo is public, so fork PRs can happen; fork tokens are read-only. |
| Fork branch name built to retarget the query (`x&branch=<ours>`) | Fails closed, if the JS re-check stays | Probed: with repeated query params the last one wins (`branch=nosuch&branch=<real>` returned the real branch's runs; a second `status=failure` overrode `status=success`). Today's shell does not re-check. R4's `head_branch === HEAD_REF` and `conclusion` checks reject it. S3 encodes the name. |
| Branch deleted and recreated, same name | Safe | An old run's A must still pass (b) and be an ancestor of the head; if it does, (c) applies. |
| Force-push | Safe | The old A is no longer an ancestor, so step 4 fails. If A survives the rewrite, (c) applies. |
| Run from another PR on the same branch | Safe | Every PR run targets `main` (`on.pull_request.branches`); (a)–(c) do not depend on the PR number. |
| Re-run of an old run | Safe, unverified on ordering | Re-runs keep their `created_at` (seen: run 43052475191, attempt 3). An older anchor only makes the diff bigger. |
| Cancelled, then green | Safe | Cancelled runs have conclusion `cancelled`, which `status=success` excludes and step 2 re-checks. Re-running only the failed jobs to green is a real pass. |
| Newest run red, older one green | Safe | The older A is picked; the diff A..head includes the red commit's changes. |
| `head_sha` missing from the clone | Fails closed (step 3) | `cat-file -e A^{commit}`. |
| Workflow file changed between A and the head | Fails closed | `.github/` is outside `LEDGER`. Runs use the merge commit's `ci.yml`, which (b) makes equal to A's. |
| Base moved | Fails closed | (b) fails on a fresh base. A stale `base.sha` still puts main's own changes into the A..head diff (unverified whether `base.sha` can be stale on `synchronize`). |
| The run re-runs itself | Fails closed | A = head, so the diff is empty and step 5 returns false. |
| Time-dependent checks (`pnpm audit`, Trivy DB) | Residual, not new | An old anchor does not re-run audit or scan against today's advisories. A ledger-only BASE..HEAD skips them today too. gitleaks never skips. |
| `changes` and `cairn` picking different anchors | Safe | Each decision stands alone. |

## 2. `actions: read` and `GH_TOKEN`

- `actions: read` lets a job list runs and read logs and artifacts. The repo is public, so it exposes nothing new.
- **It is already granted at workflow level** (ci.yml line 21, since 4774ef2). That contradicts SECURITY C-81 ("default to
  `contents: read`, widen per job only"), and it gives the token to `lint`, `unit`, `db` and `image`, which install and run
  third-party code. S4 moves it to the two jobs that call the API.
- `GH_TOKEN` is set as an `env:` on the cairn "Detect path changes" step only, which is right. The ruling's "in the environment"
  for `changes` has to mean the step, not the job (S4).
- Shell interpolation: no `${{ }}` in `run:` today (`check-run-expr` in `guard`). `$HEAD_REF` sits inside a double-quoted `gh api`
  argument, so a `$(…)` in a branch name is never parsed again. It does reach the URL unencoded (row 2 above). In `anchor.mjs`, no
  shell may be involved at all (S3). The PR title is never read.
- Self-attestation, not new: `pull_request` runs the PR's own `ci.yml`, `changes.mjs` and `anchor.mjs`, so a PR can edit them to
  print a skip. The defence is review of `.github/` and `infra/ci/`, plus the fact that branch protection names `cairn` and `app`
  from the Actions app (id 15368). A fork cannot merge.

## 3. The ledger set

- Issue `paths:` is read only by the local push guard (`scripts/cairn/cairnlib/guards.py`). No CI job checks it, so a skip loses
  nothing. Widening a `paths:` list widens what an agent may push. That is a review concern, and no CI check verifies it today.
- The pinned rulings stay outside `LEDGER` (step 6), and `test_ruling_archive_records.py` (a ledger test) covers the rest.
- `guard` and `app` read no ledger file (`check-pins` reads `.github` and `infra/ci`; `aggregate.mjs` reads only `NEEDS`).
- Outside `tests/workflow` and `scripts/cairn/tests` (git grep), ledger paths appear only in comments and in `guards.py`/`attribution.py`,
  which the full cairn suite exercises through fixtures. `.dockerignore` excludes `process`.
- Every test runner discovers files outside `process/` (the vitest `include`s, `run_tests.py`'s globs under the tests dirs, and the
  pnpm workspace globs). A `*.test.ts` placed under `reviews/` runs nowhere. S6 keeps it that way.
- Symlink hole: probes P4 and P5. If a code path is a symlink into a ledger file, editing the ledger file changes the code, and the
  diff lists only the ledger path. A ledger file that becomes a symlink also shows only as the ledger path. The tree has no
  symlinks or gitlinks today (`git ls-files -s`, modes 120000 and 160000). S5.

## 4. Renames and siblings

- **Renames, confirmed (P1).** Moving `packages/db/sql/x.sql` to `process/cairn/issues/x.md`: the default diff lists only the issue
  file, and `changes.mjs` prints every key false. `--no-renames` lists both. Copies are reported only with `-C`, so a copy's new path
  appears as an add. Mode changes are listed (P3).
- **Quoted paths, a sibling hole found today (P2).** Under the default `core.quotePath`, `git diff --name-only` C-quotes any path
  with a byte ≥ 0x80, a tab, a newline, `"` or `\`: `"packages/db/sql/caf\303\251.sql"`. The quoted line does not match `^packages/`,
  so a PR that adds only `packages/db/sql/café.sql` gets `db=false` (P2b). The same fails open in the cairn job's `PATTERN` grep.
  It fails closed only where the test is an allowlist (`LEDGER`). `--no-renames` does not fix it. S1 does.
- Submodules: a gitlink is listed by path. S5 covers one placed under `LEDGER`.

## 5. The area skip

- Fail-closed cases in R3 and C8/C10 are right: a `db` path in no area runs all four areas, zero areas selected exits 1, a value
  other than `true`/`false` exits 1, and `all` runs with no file filter.
- Residual risk the ruling names, a file read through a computed path: accepted, because `packages/db/` is shared as a whole. The
  closure walk (C9) follows imports, not configuration. The `db` job also reads files that are in neither `TABLE.db` nor
  `DB_SHARED`: `svelte-kit sync` reads `apps/web/package.json` and `apps/web/tsconfig.json`, and the install and transpile read
  the root `package.json`, `pnpm-workspace.yaml`, `.npmrc` and `tsconfig*.json`. This gap predates the issue (TABLE.db), and the
  area split does not widen it. Whether an edit there can flip a `db` test is unmeasured. S8.
- `--db-select` output is a file list. If it reached `$GITHUB_OUTPUT`, a crafted name could inject a key (S7).

## 6. Branch protection

Read through the API: `required_status_checks.strict: true`, contexts `cairn` and `app`, both bound to app 15368, and
`enforce_admins: true`. No force-push and no deletion. The ruling keeps both job names and leaves `REQUIRED` unchanged, so the head
that merges still needs green `cairn` and `app` from its own run. Those runs may now be mostly skipped. That is the point of the
issue, and it rests on the anchor argument in section 1. **The aggregate fails open on missing outputs today:** `evaluate()` returns
green with `changes.outputs` `{}`, and with `{node:'TRUE', db:'yes'}`. `--none` makes an all-false output normal, so a filter bug
that emits nothing would look exactly like a ledger-only skip (S2).

## 7. Conditions before build green

- **S1 NUL-delimited diffs.** Every diff that feeds a filter (the `changes` step, cairn BASE..HEAD, the anchor diff) runs
  `git diff --no-renames -z --name-only`. `changes.mjs` and `anchor.mjs` split stdin on `\0`. A rename fixture plus a fixture
  that adds only `packages/db/sql/café.sql`, and one with a tab in the name, give `db=true`. Today's code is red on both (P1, P2b).
  The cairn shell's grep pipeline gets the same input, or moves into `anchor.mjs`.
- **S2 Aggregate fails closed on outputs.** `evaluate()` is red when any key of `TABLE`, or any of the four area keys, is missing
  from `changes.outputs` or is not exactly `true` or `false`, and when `db` is not the OR of the area keys. Fixtures: `{}` and
  `{node:'TRUE'}` are red; all-false with every key present is green.
- **S3 Query and process hygiene.** `anchor.mjs` builds the query with `encodeURIComponent(HEAD_REF)`. It calls `gh` and `git`
  through `spawnSync` with an argv array and no `shell` option. `HEAD_REF` is never a git argument, and every sha is checked against
  `^[0-9a-f]{40}$` before git sees it. A C14 fixture: lookup output naming another branch (the `&branch=` route) → false.
- **S4 Token scope.** ci.yml's workflow-level `permissions` is exactly `{contents: read}`. `actions: read` appears only at job level,
  on `cairn` and `changes`. `GH_TOKEN` appears only as a step `env:` on the step that runs `anchor.mjs`, in those two jobs. Checked
  by a test in `ci-workflow.test.ts`.
- **S5 No links into the ledger.** The anchor returns false when any path in the anchor diff has mode 120000 or 160000 on either
  side (read from `git diff --raw -z --no-renames`). A static `tests/ci` test fails when the tree holds any symlink or gitlink.
  The test is red on a fixture repo built like P5.
- **S6 Nothing runs from the ledger.** A `tests/ci` text test: no vitest `include`, `run_tests.py` discovery root, or
  `pnpm-workspace.yaml` package glob matches a `LEDGER` path.
- **S7 `--db-select` stays in-step.** The battery step reads the list into a bash array in the same step, never through
  `$GITHUB_OUTPUT`. Every line must match `^tests/db/[a-z0-9-]+\.test\.ts$`, otherwise exit 1. The battery command has no
  `--passWithNoTests`. Covered by C10/C11 tests.
- **S8 Config edges are shared.** `TABLE.db` and `DB_SHARED` add `^package\.json$`, `^pnpm-workspace\.yaml$`, `^\.npmrc$`,
  `^tsconfig[^/]*\.json$`, `^apps/web/package\.json$` and `^apps/web/tsconfig\.json$`. A C8 fixture shows each one selects all
  four areas.

## SECURITY

C-81 needs one line in the loop's doc step: the anchor skip rule and its invariant (only `LEDGER` paths differ from a commit
whose whole workflow passed and which contains the base), filter diffs use `--no-renames -z`, and `actions: read` is granted per job.

## Build check (head c2dde89)

All eight are met. Read against `.github/workflows/ci.yml`, `infra/ci/anchor.mjs`, `changes.mjs` and `aggregate.mjs`.

| S | Met | Evidence |
|---|---|---|
| S1 | yes | ci.yml 61 (cairn) and 200 (`changes`) run `git diff --no-renames -z --name-only`; anchor.mjs 84 does too and rejects output that is not NUL-terminated (85); changes.mjs 113–117 splits on `\0` and exits 1 on non-NUL input (C26). |
| S2 | yes | aggregate.mjs 20 is red on any `ALL_KEYS` value other than exactly `true`/`false`; line 21 is red when `db` is not the OR of the area keys. |
| S3 | yes | anchor.mjs 76 `encodeURIComponent(HEAD_REF)`; 57–58 `spawnSync` with an argv array and no shell; 67–69 and 81–89 put every sha through `needSha`; `HEAD_REF` is never a git argument; 26–31 re-check conclusion, event, branch, repository and sha. |
| S4 | yes | ci.yml 19–20 workflow `permissions` is `contents: read` only; `actions: read` only at 33 (`cairn`) and 151 (`changes`); `GH_TOKEN` only at 45 and 173, the steps that run `anchor.mjs`. Pinned by `ci-workflow.test.ts` (C21). |
| S5 | yes | anchor.mjs 88–90 read modes with `git diff --raw -z --no-renames`; 45 returns false on 120000/160000; `anchor.test.ts` 303–336 hold the fixture and the real-tree check. |
| S6 | yes | `anchor.test.ts` 343 onward (C23). |
| S7 | yes | ci.yml 537–546: `mapfile` into a bash array in the battery step, a per-line regex check, exit 1; no `--passWithNoTests` in ci.yml or `tests/db/vitest.config.ts`. changes.mjs 87 checks the same pattern. |
| S8 | yes | changes.mjs 15 adds the six paths to `DB_SHARED`, which `TABLE.db` spreads; the fixture is in `db-areas.test.ts` at 92. |

Minor, not a condition: anchor.mjs 44 accepts an empty `modes` list when the diff has paths. If git's `--raw` format ever changed,
S5 would stop seeing links without failing. Requiring two modes per diff path would make that case fail closed.
