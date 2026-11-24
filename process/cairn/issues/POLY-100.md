---
id: POLY-100
title: Pull-based deploy + timers
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-96, POLY-76, POLY-83, POLY-99]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-100.md, process/cairn/reviews/POLY-100/**, infra/deploy/**, infra/ops/**, infra/compose/**, infra/provision.sh, infra/provision-check.sh, infra/postgres/**, infra/caddy/**, infra/README.md, infra/lint/**, infra/ci/**, packages/db/**, packages/config/**, apps/worker/**, tests/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, .github/workflows/**, package.json, packages/*/package.json, apps/*/package.json, pnpm-lock.yaml, eslint.config.js, layers.json, .gitignore, Dockerfile]
labels: [ops, deploy, security]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/152
created: 2026-11-08
updated: 2026-11-24
---

INFRA §4.4–§4.6 / ARCH §8.1: a 5-minute poll under flock, digest pull, gh attestation verify pinned to the repo and signer workflow, prod git verify-tag against operator-installed allowed_signers, the tag-to-digest label check, ops-bundle extraction, check-config then migrate --plan, a pre-migration encrypted backup via the backup container, migrate under advisory lock, up -d, a 120 s health poll, automatic rollback, quarantine and heartbeat. A bad migration is recovered off the box from the operator's laptop within 60 minutes; no plaintext dump is written on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [x] With a fake registry fixture, an unverified image is never run. Proved by `test_deploy_candidate.py` (`test_t1_v1_argv_is_exactly_the_six_flags_with_c_and_precedes_any_pull`, `test_t2_a_label_alone_does_not_bind_the_image`) and `test_deploy_flow.py::test_t7_a_deploy_never_rewrites_the_box_and_runs_nothing_from_the_release`; the guard cases in `test_deploy_guard.py`; red-run.md has each on a mutant.
- [x] A failed attestation, a bad tag signature and a wrong commit label each stop the deploy and alert. Proved by `test_deploy_candidate.py` (`test_label_mismatch_is_refused_and_quarantined`, `test_t3_a_tag_signed_by_a_key_not_in_allowed_signers`, V1 refusals) and `test_deploy_prod.py`.
- [x] An unhealthy release rolls back within 120 s and is quarantined; a failing migration file leaves the old containers running. Proved by `test_deploy_flow.py` (`test_t10_unhealthy_rolls_back_from_the_previous_bundle_without_migrating_and_is_quarantined_once`, `test_t11_a_failing_migrate_never_touches_the_running_containers`), `test_deploy_probe.py`, `test_deploy_hang.py`.
- [x] The script never rewrites itself. Proved by `test_deploy_flow.py::test_t7_a_deploy_never_rewrites_the_box_and_runs_nothing_from_the_release` and `test_deploy_render.py` (every compose call names the saved render; a `releases/` path only as `config`'s inputs).
- [x] The bad-migration rollback runbook's inputs are proven: `backup premigration`, then a restore from the pre-migration backup on the operator's laptop (T13). The 60-minute timing is measured in the restore drill, POLY-116. Proved by `test_deploy_t13.py` (`test_the_set_a_deploy_logs_is_the_set_list_premigration_offers`, `test_fetch_premigration_gives_the_same_bytes`, `test_the_fake_box_and_the_real_list_print_the_same_bytes`).
- [x] A failing migration file leaves the tracking table and the schema exactly as before the run (one transaction). Proved by `tests/db/runner.test.ts` `a failing file leaves schema and tracking unchanged (one transaction)` (green in the db job, 44/44 locally).
- [x] Two migrate runs started together: the second waits on the advisory lock and then applies nothing. Proved by `tests/db/runner.test.ts` `T-lock: two migrate runs together` > `both exit 0, one applies and one finds nothing, one tracking row, the second was seen waiting on Lock/advisory`.

## Comments

### @team-lead — 2026-11-09

From the POLY-83 architect ruling (R1, R6, R7): three deploy-side requirements for INFRA / provision.sh. (1) `provision.sh` runs `packages/db/sql/roles.sql` as the Postgres superuser before the first migrate — roles are cluster objects and poly_backup needs REPLICATION + BYPASSRLS; bootstrap.sql carries no passwords, provision.sh sets them. (2) The deploy runs `migrate --plan` first and aborts on exit 2 (tracking rows diverge from the journal); exit 3 means pending, proceed to apply; exit 0 nothing pending. (3) The image ships `packages/db/migrations` (incl. `meta/_journal.json`) — the startup guard in web and worker reads the bundled journal to learn the expected schema version. INFRA doc update is devops's when this issue starts.

### @architect — 2026-11-09

Architect, 2026-11-09 (supersedes POLY-83 ruling Addendum 2 (2), seceng's view): the poly_backup ACL check goes into the migrate runner's role preflight, not into provision-check. It runs on every deploy, so it catches drift that a one-time provisioning check would miss. Criterion: migrate and --plan exit 2, applying nothing, when (a) any aclitem in pg_database, pg_namespace, pg_class, pg_proc or pg_default_acl names poly_backup as grantee, except CONNECT on the database; or (b) poly_backup owns any object in pg_class, pg_proc, pg_namespace or pg_type (C-79: no other grant, owns nothing). Code in packages/db (assertRoles); qa adds the fixture GRANT CREATE ON SCHEMA public TO poly_backup and the runner refuses. POLY-97 gets no criterion for this. Not blocking POLY-83.

### @team-lead — 2026-11-09

seceng's refinements to the poly_backup preflight predicate (architect ruling above @ 686f0c3), relayed from POLY-83 @ a694b2a — seceng wrote them against the POLY-97 placement before the revision; they apply here unchanged: (a) also refuse EXECUTE on any `prosecdef` function (a definer grant is a write path) and TEMPORARY on the database; (b) "owns nothing" covers pg_type as well (the architect already added it). The POLY-97 criterion is withdrawn (5add6b5); this issue is the single home.

### @team-lead — 2026-11-10

Bubble-up from the POLY-85 architect ruling (`process/cairn/reviews/POLY-85/ruling.md` R3, R5): the deploy runs `check-config` in all three containers (`polycarpic migrate|web|worker check-config`), since each container sees only its own secret mounts; compose gives every service `env_file: host.env` (INFRA §2.2, §4.5, §3.2 — devops). The label the tag-to-digest check reads is `org.opencontainers.image.revision` (full 40-hex), via `docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>@<digest>`; build.yml passes `--build-arg GIT_COMMIT=${{ github.sha }}`. Hetzner sets `TLS_MODE=real-domain` (devops to confirm).

### @team-lead — 2026-11-10

From the POLY-85 seceng concurrence S-9(b) (`process/cairn/issues/POLY-85.md` @ 2463be2): the release image refuses `APP_ENV=development` whenever `POLY_IMAGE_REVISION` is set, so any CI run of the built image (smoke, `check-config`) uses `APP_ENV=staging` with a staging-shaped env; `check-config` is offline, so the `https` `PUBLIC_ORIGIN` is only a string there.

### @team-lead — 2026-11-10

From POLY-96 (ruling `process/cairn/reviews/POLY-96/ruling.md` §5 and Addendum 1; seceng S96-15, A2; SECURITY v1.9 C-83):
- The box's attestation check adds `--source-ref refs/heads/main --deny-self-hosted-runners`; without it an image built from a branch that edited build.yml passes (T-92).
- The staging poll takes the digest from the newest successful build.yml run's `digest.txt` on `main`, never from a tag. Push tags are per run (`sha-<commit>-<run_id>`), and a commit can carry several attested digests (weekly rebuild).
- Prod's digest is frozen at the release tag; a patch reaches prod only through a new tag.

### @team-lead — 2026-11-10

Before the first `v1.*` tag (user action, from POLY-96): set the repository variable `RELEASE_SIGNERS` to the `allowed_signers` content for the key that signs release tags; release.yml refuses to publish while it is empty. No tag signing is configured in git on the lead's machine as of 2026-11-11, so choosing and configuring the SSH signing key comes first. Also from the seceng verdict: `release-lookup.sh` verifies provenance only; confirm the SBOM attestation by hand on the first build, and consider adding it to the box check.

### @team-lead — 2026-11-11

From the POLY-95 loop (`process/cairn/reviews/POLY-95/`): (F3) `build.yml` publishes and attests the Postgres derivative, the Caddy image and the tools image; none is published today. The home-box DNS-plugin Caddy build goes with it. (F5) The ops bundle carries `infra/compose/**`, `infra/caddy/Caddyfile` and the `infra/postgres/**` config into the verified image. (F8) The deploy uses explicit `-f` files from the verified bundle only and runs the compose-policy lint, or checks the bundle digest, before `up`. (F10) `POLY_APP_IMAGE`, `POLY_TOOLS_IMAGE` and `POLY_CADDY_IMAGE` become `${…:?}` like `POLY_POSTGRES_IMAGE`; they default to an all-zero digest today.

### @team-lead — 2026-11-16

Noted in the POLY-89 loop (2026-11-17): the two `it.fails` pins in `tests/db/runner.test.ts` (line 196 on) still stand; they predate that loop.

### @team-lead — 2026-11-22

From the POLY-97 loop (ruling Scope): `env_file:` wiring of `/etc/polycarpic/host.env` into auth and worker; the worker's `DATABASE_*` and `PUBLIC_ORIGIN` (POLY-142); the deploy timer, `allowed_signers` install and poly_backup ACL preflight, each with a provision-check line in R6's format. The D3 probe takes its image from the running postgres container, so the deploy must have Postgres up before the D checks can leave WAIT.

### @team-lead — 2026-11-22

From the POLY-98 ruling (`process/cairn/reviews/POLY-98/ruling.md` M4, Scope): the `operator` compose service sets only `DB_PASSWORD_FILE`, while the config registry reads `DATABASE_PASSWORD_FILE` and the operator also needs `PUBLIC_ORIGIN` and `APP_ENV`. Add `operator` to the env wiring this issue owns. Until then `polycarpic-ops cli user invite` is proven against fakes only; the first live invite is POLY-104's. The GitHub-token-days `status` item is also this issue's.

### @team-lead — 2026-11-22

From the POLY-98 security review (`process/cairn/reviews/POLY-98/ruling-review.md` R-b): the ops bundle is installed from the laptop's checkout, so the compose files `set-secret` and `cli` read can drift from the deployed release's. A drift misses a mount or runs a stale `operator` definition; it grants nothing. `self-update` installing from the attested release bundle is where they converge (ruling R1 leaves the `sha256-<12 hex>` id for it).

### @team-lead — 2026-11-22

Feature started. Branch: `feature/poly-100-pull-based-deploy`.
From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8; ruling R6 is the contract): the deploy calls `polycarpic-ops backup premigration` and migrates only on exit 0 (1 failed, 3 not ready, 4 lock not got in 30 min), writing the `premigration-set …` line to deploy.log. Also this issue's: write /opt/polycarpic/images.env; enable both timers; publish and attest the tools image; install the ops bundle from the verified image; the deploy lock alongside backup.lock; `github_read_token` joins HOST_ONLY only through seceng's pinned-set review (secrets/host/, root:root 0400).

### @team-lead — 2026-11-23

Criterion 5 reworded with the Principal's agreement (2026-11-23), at the architect's request (ruling §L1): this loop proves the runbook's inputs (T13); the 60-minute timing is POLY-116's, where the timed drill lives. The old text read "within 60 minutes (measured in the restore drill)".

### @team-lead — 2026-11-23

PR opened: https://github.com/richmosko/polycarpic/pull/152. Gate signed at a9d35481, seceng PASS WITH FOLLOW-UPS (H1 accepted into POLY-160 by the Principal), architect verdict at 82b8b1c2. Awaiting the Principal's merge.

### @team-lead — 2026-11-24

Validate passed; merging via PR #152. Closing. No real deploy has completed: POLY-160, POLY-161 and POLY-162 carry the rest.
