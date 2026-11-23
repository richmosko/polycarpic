# POLY-100 test plan and contract pins (qa-100)

Harness: `tests/infra/ops/deploy_base.py` (`World`, `DeployTest`) on POLY-98's `base.py` (`Host.go` gained `ctx_extra`).
Unit file `tests/infra/ops/test_deploy.py`; it joins the existing provision-job command (`unittest discover -s tests/infra/ops`).

## Pins the builder codes against

1. **New Ctx seams** (constructor kwargs, like `stdout_bytes`): `resolve(name) -> [addr]`, raising `OSError` when the name does not resolve;
   `run_bytes(argv, stdin, timeout, env) -> (code, bytes, err_text)`, reached via `ctx.run_bytes(argv, timeout=, extra_env=)` with `fixed_env`
   like `ctx.run`. Reason: R4 reads `docker cp <cid>:/app/infra -` as a tar, and `ctx.run` is text-mode (a tar is not valid UTF-8).
   `CtxSeams.test_ctx_has_resolve_and_run_bytes` is red until both exist. If architect rules another way to read the tar, tell qa.
2. **gh**: argv `gh api <path>` with no `--jq`/`--template` (the tool parses JSON). Runs path contains `/actions/workflows/build.yml/runs`
   (answer `{"workflow_runs":[...]}`); releases path contains `/releases` (answer a JSON list). Download: `gh run download <id> -n image-<head_sha> -D <dir>`.
   Verify: `gh attestation verify oci://<ref>@<digest> ...` with `--source-digest <C>`. `GH_TOKEN` in the child env only; the fake refuses without it (exit 4).
3. **git** runs for real in the temp root. The only redirect: an argv element beginning `https://github.com/richmosko/polycarpic` goes to a local repo.
   Only `GIT_*` env passes through to the real child. Staging ancestry is `git merge-base --is-ancestor <current commit> <C>` (exit 0 = descends).
4. **docker**: `docker pull <ref>@<digest>`, `docker image inspect <ref>@<digest>` (no `--format`; the tool parses the JSON: `RepoDigests`, `Config.Labels`),
   `docker create --name N <ref>@<digest>` (stdout = container id), `docker rm`, and `docker cp <cid>:/app/infra -` through `ctx.run_bytes`.
5. **Lock**: `fcntl.flock(LOCK_EX|LOCK_NB)` on `ctx.p("/run/polycarpic/deploy.lock")` (T16 holds a real lock on that file).
6. **Token**: `ctx.p("/etc/polycarpic/secrets/host/github_read_token")`; state under `ctx.p("/var/lib/polycarpic/state/deploy/<project>/")`.
7. **Records** (R10): `deploy.log` lines `<UTC> <event> <fields>`; a refusal logs `<UTC> refused <name> <digest>`; `alert` is `<UTC> <name>`;
   stderr's last line on a refusal is `deploy: refused <name>`. Exit 1 on a refusal; exit 4 on a precondition (`not-first-deployed`, `existing-data`, `edge-prod-name-early`).
8. `current` for a seeded project is `<digest> <tag or -> <commit> <tree sha256> <UTC>`.

9. **Prod order and refusals** (`test_deploy_candidate.py`): the tag is fetched and verified first, then C = its commit feeds V1. So: `tag-signature`
   (bad key, lightweight, PGP block), `tag-commit` (a signed tag whose target is not a commit), `tag-name` (object's `tag` field, ref and Release differ;
   checked before `not-newer`), `attestation` (a signed tag on a commit the image was not attested at), `not-newer`, `label`: all exit 1, last stderr line
   `deploy: refused <name>`, alert `<UTC> <name>`. Q rows (`tag-*`, `label`) put `<digest> <UTC> <name>` in `quarantine`; `attestation`, `not-newer` do not.
   A gh outage logs event `transient`, no alert-free exit code is pinned. A candidate equal to `current` exits 0 touching nothing; a quarantined one exits 0 and logs `quarantined`.
   Staging's ancestry check needs both `current`'s commit and C in `tags.git` (fetch them both).

10. **Compose fake** (`World._compose`): renders come from `tests/infra/ops/fixtures/compose/*.json` (regenerate with `fixtures/gen_compose.py`; the
    real files do not render off-box because `env_file` paths are absolute). `config` is chosen by `-f` basenames and honours `--no-interpolate` (raw).
    `compose … run --rm --no-deps -T <svc> <svc> <cmd…>`: the command is everything after the second `<svc>`; `--plan` in it answers `plan_code` (default 3).
    `compose … exec -T web …` prints the HTTP status code alone on stdout (`200`). `compose up` sets each named service to the image of the `--env-file` it was given.
    Guard cases (T8) edit the renders; rule names asserted exactly except where an earlier closed rule also refuses (a service `volumes`/`ports`/`configs` key
    outside the key set may report `key`); the builder's own `compose_guard.check` was run against every case before this commit.
11. Sibling refusal names are `sibling-postgres|tools|caddy`; a sibling label mismatch is `sibling-<name>` and quarantined.

12. **Flow pins** (`test_deploy_flow.py`; setup is the tool's own `first-deploy <project>`): a healthy run exits 0; a refusal exits 1 with last stderr
    line `deploy: refused <name>`; an automatic rollback that comes up healthy exits 1 with `deploy: rolled-back` (alert `rolled-back`); no `previous`
    or an unhealthy rollback exits 1 with `deploy: rollback-unhealthy`. Names: `migrate-<code>` (Q for 1 and 2, not 4), `plan-diverged` (Q), `plan-error`, `check-config` (Q).
    first-deploy enables `systemctl enable --now polycarpic-deploy@<project>.timer` only when healthy. Compose `run`: `run --rm --no-deps -T <svc> <svc> <cmd>`
    (migrate: `… migrate migrate`, plan: `… migrate migrate --plan`). Every compose `up`/`run` has `--pull never` and `--no-build`. Rollback `up` uses the previous release's
    dir for `-f`/`--project-directory`/`--env-file`. Premigration is run as an argv ending `backup premigration`.

13. **Where a real render is judged** (lead's G3 question): `tests/infra/compose-real.test.ts` (lint job, needs the compose CLI, no daemon). It (a) compares the committed
    fixtures with real `docker compose config` output for the shipped files, and (b) renders 16 S10/S14 edits of the shipped `staging.yml` with real compose and runs the
    installed guard on those renders (`fixtures/guard_real.py`). The hand-written guard cases in `test_deploy_guard.py` stay as the unit level.

## Groups (builder turns them green in order)

- G0 slice 0 (this commit, green against a throwaway stub): V1 refusal.
- G1 T1, T2, T3, T4, T5 (candidate, verify, monotonic, siblings).
- G2 T6, T7, T14 (bundle, never rewrites itself, `--pull never`).
- G3 T8 (guard).
- G4 T10, T11, T12, T9 (order, rollback, edge).
- G5 T15, T16, T17, T18 (token, lock, signers, HOST_ONLY).
- G6 T-env and workflow statics (vitest lint job); T13 (box fixture).
- T-pre and T-lock belong to POLY-100f (packages/db).
