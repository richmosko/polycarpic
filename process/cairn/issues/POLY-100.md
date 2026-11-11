---
id: POLY-100
title: Pull-based deploy + timers
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-96, POLY-76, POLY-83]
assignee: devops-engineer
paths: [infra/deploy/**]
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

INFRA §4.4–§4.6 / ARCH §8.1: a 5-minute poll under flock, digest pull, gh attestation verify pinned to the repo and signer workflow, prod git verify-tag against operator-installed allowed_signers, the tag-to-digest label check, ops-bundle extraction, check-config then migrate --plan, a pre-migration encrypted backup via the backup container, migrate under advisory lock, up -d, a 120 s health poll, automatic rollback, quarantine and heartbeat. A bad migration is recovered off the box from the operator's laptop within 60 minutes; no plaintext dump is written on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [ ] With a fake registry fixture, an unverified image is never run.
- [ ] A failed attestation, a bad tag signature and a wrong commit label each stop the deploy and alert.
- [ ] An unhealthy release rolls back within 120 s and is quarantined; a failing migration file leaves the old containers running.
- [ ] The script never rewrites itself.
- [ ] The bad-migration rollback runbook restores from the pre-migration backup on the operator's laptop within 60 minutes (measured in the restore drill).
- [ ] A failing migration file leaves the tracking table and the schema exactly as before the run (one transaction).
- [ ] Two migrate runs started together: the second waits on the advisory lock and then applies nothing.

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
