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

## Groups (builder turns them green in order)

- G0 slice 0 (this commit, green against a throwaway stub): V1 refusal.
- G1 T1, T2, T3, T4, T5 (candidate, verify, monotonic, siblings).
- G2 T6, T7, T14 (bundle, never rewrites itself, `--pull never`).
- G3 T8 (guard).
- G4 T10, T11, T12, T9 (order, rollback, edge).
- G5 T15, T16, T17, T18 (token, lock, signers, HOST_ONLY).
- G6 T-env and workflow statics (vitest lint job); T13 (box fixture).
- T-pre and T-lock belong to POLY-100f (packages/db).
