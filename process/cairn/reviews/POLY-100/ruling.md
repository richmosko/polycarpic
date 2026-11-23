# POLY-100 ruling: pull-based deploy and timers

Architect, 2026-11-23. Tree read at `aa8247f327a68b619342e27a06f895232f293d32`. Sources: the description, seven criteria and
twelve comments on `POLY-100.md`; POLY-99 ruling R5/R6 and verdict §8; INFRA §2.2, §3.2–§3.3, §4.4–§4.6, §6.4, §6.8, §7.1,
§8.6–§8.10; ARCH §8.1; SECURITY C-83, T-64, T-92, TB-12, R-29; DECISIONS 2026-11-23. A claim is measured (§M) or tagged
`(unmeasured)`. The ruling proceeds on each recommendation in §D unless the issue file says otherwise.

## M — Measurements (this Mac, gh 2.x, 2026-11-23)

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M1 | Repo visibility | `gh repo view --json visibility` | `PUBLIC` |
| M2 | Anonymous GHCR pull | anonymous `ghcr.io/token` scope pull, then `GET /v2/richmosko/polycarpic/manifests/<digest of run 45196636649>` | token issued; manifest **200**. The box needs no registry credential and writes no `docker login` file. |
| M3 | Anonymous Actions/Releases reads | `curl` without auth: `…/actions/runs`, `…/runs/<id>/artifacts`, `…/releases`; then the artifact's `archive_download_url` | 200, 200, 200; artifact download **401**. |
| M4 | Attestation verify without a credential | `gh attestation verify oci://…@<digest>` with the four C-83 flags, empty `GH_CONFIG_DIR`, no `GH_TOKEN` | refuses: "please run gh auth login". With a token: exit 0. |
| M5 | `--source-ref` is enforced | same digest, `--source-ref refs/heads/other` | exit 1 |

So the box needs **a** GitHub token (M3, M4) but not for anything private (M1, M2). Its scope is §D1.
Unmeasured: whether a fine-grained token returns `github-authentication-token-expiration` (my token is OAuth; no header).

## Scope

IN: R1–R12. OUT:

| Item | Goes to | Why |
|---|---|---|
| Box-side copy back into prod (`restore-apply`) | POLY-158 | DECISIONS 2026-11-23 D2. |
| Criterion 5's **timing** (60 min, on the laptop) | POLY-116 | The timed drill is the GA gate there (POLY-99 verdict §8). This loop proves the runbook's inputs (R7 T13). **§L1.** |
| Outbound alert route (Resend, Healthchecks deploy check), token-expiry alert | POLY-103 | Monitoring. This loop writes the alert file it reads (R9). |
| Live first deploy; real `check-config` in the rendered env; units under real systemd; real token scope (§D1) | POLY-104 | First staging deploy. |
| Home-box DNS-plugin Caddy build; home egress allowlist for `tuf-repo-cdn.sigstore.dev`, `ghcr.io`, `api.github.com` | POLY-120 | Home box is post-GA. |
| `polycarpic-ops self-update` (INFRA §8.7) | **§L2** (unhomed) | R-b converges without it (R4); the ops tool keeps updating by `install.sh`. |
| SBOM attestation in the box check | not taken | Provenance is the gate (C-83); SBOM is a record. seceng may overrule in 100b. |

## R1 — Entry points, units, lock

- New `infra/ops/commands/deploy.py` (`deploy <prod|staging>`), `first_deploy.py`, `rollback.py`, `allowed_signers.py`, and
  `infra/ops/lib/release.py` (candidate, verify, bundle, state). POLY-98 house style: root, injected `ctx`, argv lists,
  `fixed_env`, every value from GitHub regex-checked before use (a miss is refusal `malformed`).
- Units in `infra/deploy/systemd/`: `polycarpic-deploy@.service` (oneshot, `ExecStart=/usr/local/sbin/polycarpic-ops deploy %i`,
  `TimeoutStartSec=90min`) and `polycarpic-deploy@.timer` (`OnCalendar=*:0/5`, `RandomizedDelaySec=60`). `provision.sh --stage
  host` installs both, not enabled; provision-check compares them to the bundle, as for the backup units.
- Lock: `flock /run/polycarpic/deploy.lock`, **one for both projects** (both may touch edge). The timer run is non-blocking
  (busy → exit 0, log `busy`); `first-deploy` and `rollback` wait at most 10 min (exit 4).

## R2 — Finding the candidate

| | Source | Accept only |
|---|---|---|
| staging | `GET …/actions/workflows/build.yml/runs?branch=main&status=success&per_page=1`, then `gh run download <id> -n image-<head_sha>` into a root 0700 temp dir | `id` `^[0-9]{1,20}$`, `head_sha` 40-hex, `digest.txt` exactly `sha256:<64 hex>\n`; expected commit = `head_sha` |
| prod | `GET …/releases?per_page=100` | non-draft, non-prerelease, tag `^v1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`; take the **highest semver**, not the newest date; body exactly one line `digest: sha256:<64 hex>`; expected commit = the tag's commit (R3) |

Then: digest equal to `current` → exit 0. Digest in `quarantine` → exit 0, log `quarantined`. **Prod refuses a tag whose
semver is not above `current`'s** (log `not-newer`; a downgrade is `rollback`'s job). `gh` gets `GH_TOKEN` from
`secrets/host/github_read_token` in its env only, never argv, with `GH_CONFIG_DIR` an empty root 0700 dir, so gh writes no
`hosts.yml`.

## R3 — Verify, all before anything runs

Order, each a named refusal; any refusal → R9 alert, and for the release-fault rows quarantine.

| # | Check | Refusal | Quarantine |
|---|---|---|---|
| V1 | `docker pull ghcr.io/richmosko/polycarpic@<digest>`; `RepoDigests` contains it | `pull` | no |
| V2 | `gh attestation verify oci://…@<digest> --repo richmosko/polycarpic --signer-workflow richmosko/polycarpic/.github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners`, exit 0 | `attestation` | yes |
| V3 | `docker image inspect` label `org.opencontainers.image.revision` == expected commit | `label` | yes |
| V4 (prod) | `git -C /var/lib/polycarpic/state/deploy/tags.git fetch --no-tags https://github.com/richmosko/polycarpic refs/tags/<tag>:refs/tags/<tag>` (bare, created by root); `cat-file -t` is `tag`; `git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=/etc/polycarpic/allowed_signers verify-tag <tag>` exit 0; `rev-parse <tag>^{commit}` == V3's label | `tag-signature`, `tag-commit` | yes |
| V5 | Bundle extracted (R4); its `images.env` well-formed; each sibling pulled by digest and passes V2's flags and V3 against the **same** commit | `bundle`, `sibling-<name>` | yes |
| V6 | Bundle `infra/postgres-major` equals `current`'s (skipped on the first deploy) | `postgres-major` (a major upgrade is INFRA §5's operator procedure) | yes |

**Nothing with a candidate digest is created, run or composed before V1–V6 pass**, except `pull`, `image inspect` and R4's
`docker create` (which never starts) after V4. Every `compose up`/`compose run` carries `--pull never --no-build`, so compose
never resolves a tag.

## R4 — The release bundle (closes F5, F8, R-b)

- `docker create --name polycarpic-bundle-<12 hex> <ref>@<digest>` (never started); `docker cp <cid>:/app/infra -` streamed
  through `install_box.py`'s member filter (no links, no absolute or `..` paths, files and dirs only); `docker rm`. Into
  `/opt/polycarpic/releases/.incoming-<12hex>/`, then root 0755/0644 (RUNNABLE scripts 0755), rename to
  `releases/sha256-<64 hex>/`. Kept: each project's `current` and `previous`; older ones pruned after a healthy run.
- `releases/<d>/images.env` = the bundle's `infra/release/images.env` (exactly `POLY_POSTGRES_IMAGE`, `POLY_TOOLS_IMAGE`,
  `POLY_CADDY_IMAGE`, each `=ghcr.io/richmosko/polycarpic-<postgres|tools|caddy>@sha256:<64>`, name↔repo fixed) plus
  `POLY_APP_IMAGE=ghcr.io/richmosko/polycarpic@<digest>`. Root 0644.
- Every compose call names `-p polycarpic-<project> --project-directory releases/<d>/infra/compose -f releases/<d>/infra/compose/<project>.yml`
  and `--env-file releases/<d>/images.env` (edge adds `-f …/edge.yml --env-file /etc/polycarpic/edge.env`). No other `-f`, no
  `COMPOSE_*` env. The compose-policy lint ran on that commit in CI before the attest (R10), so the attested bundle is a linted one.
- **R-b:** `lib/compose.py` resolves compose files from `releases/<project>-current` (a root symlink) when it exists, else from
  the ops bundle. `backup.py`'s `BUNDLE_COMPOSE`, `upload.py`, `cli.py` and `set_secret.py` go through it.
- After a healthy prod run, `/opt/polycarpic/images.env` = that release's `images.env` (tmp + rename, root 0644).

## R5 — Order of a run (prod; staging differs where marked)

1. Lock (R1), candidate (R2), verify (R3), bundle (R4).
2. Postgres not running in the project → `up -d --no-deps postgres` from the candidate bundle; healthy within 120 s or stop (`postgres-start`).
3. `check-config` in migrate, web, auth and worker (`compose run --rm --no-deps -T <svc> <svc> check-config`), each exit 0, or stop (`check-config`, quarantine).
4. `migrate --plan`: 0 → skip to 7; 3 → continue; 2 → stop (`plan-diverged`, quarantine); else stop (`plan-error`, no quarantine).
   On the first deploy, exit 2 naming `roles-missing` prints `run: sudo polycarpic-ops provision --stage database --project <p>` and exits 4.
5. **Prod only:** `polycarpic-ops backup premigration` (subprocess, timeout 65 min). Migrate only on exit 0 **and** a last stdout
   line matching `^premigration-set <TS> dump-…\.age=<64 hex> globals-…\.age=<64 hex>$` (as built, `backup.py`; INFRA §6.4 has
   the same form). That line goes to `deploy.log` verbatim. 1/3/4/other → stop (`premigration-<code>`, no quarantine; the next poll retries).
   Staging has no backup service and skips 5–6.
6. **Prod only:** take `backup.lock` (wait ≤ 30 min, else stop `backup-lock`) and hold it to the end, so a nightly never starts
   during migrate or recreate. The nightly never takes `deploy.lock`, so there is no cycle.
7. `migrate` (`compose run`): 0 → on; 2 or 1 → stop (`migrate-<code>`, quarantine; the old containers were never touched); 4 → stop, no quarantine.
8. `up -d --pull never --no-build` for the project. Edge: R8.
9. Health (R6). Healthy → state (R9), prune (R4), clear alert. Unhealthy → rollback (R7).

## R6 — Healthy

Within 120 s of `up -d` returning, polled every 5 s: every long-running service of the project (postgres, web, auth, worker;
caddy when R8 recreated it) is `running`, `Health.Status=healthy`, and its `Config.Image` equals `images.env`; **and**
`compose exec -T web node -e "<fetch http://127.0.0.1:3000/api/v1/health>"` prints exactly `{"ok":true}` with 200. The second
clause exists because the worker's healthcheck is `process.exit(0)` (POLY-103 comment, 2026-11-20).

## R7 — Rollback and quarantine

- **Automatic:** at the 120 s mark, quarantine the candidate (`<digest> <UTC> unhealthy`), `up -d` from `previous`'s own bundle
  and `images.env`, R6 again. Healthy → `rolled-back`, alert. Unhealthy, or no `previous` (first deploy) → `rollback-unhealthy`,
  alert, change nothing else (INFRA §8.6). Criterion 3's "within 120 s" means the rollback **starts** no later than 120 s after `up -d`.
- **Manual:** `polycarpic-ops rollback <project>`: no GitHub call; quarantines `current`, ups `previous` from `releases/`,
  after the R1 integrity check on that directory (root-owned, not group/world-writable); then R6.
- A quarantined digest is skipped by R2 until a different one is the candidate.

## R8 — Edge

`edge.yml` and the Caddy image follow **prod's** release whenever prod has a `current`; before the first prod deploy, staging's
deploy owns edge. (§D2.) A prod run that changes `POLY_CADDY_IMAGE` or the bundle's Caddyfile recreates caddy in step 8, and R6
includes it. `/etc/polycarpic/edge.env` (`POLY_DOMAIN`, `POLY_BIND_ADDR`, `POLY_STAGING_ALLOW`, `POLY_TLS`; root 0644) is written by
`provision.sh` with a provision-check line.

## R9 — State, log, alert

`/var/lib/polycarpic/state/deploy/<project>/`, root 0755, files root 0644, tmp + rename:

| File | Content |
|---|---|
| `current`, `previous` | one line `<digest> <tag or -> <commit> <UTC>` |
| `quarantine` | lines `<digest> <UTC> <reason>` |
| `deploy.log` | append `<UTC> <event> <fields>`; events a closed set: `candidate verified refused busy quarantined not-newer premigration-set migrated up healthy rolled-back rollback-unhealthy` |
| `alert` | one line `<UTC> <refusal or event>`; written on every stop or rollback, removed on the next healthy run |

New status modules: `08_deploy.py` (OK digest/tag/age; RED while `alert` exists, naming it; WAIT not deployed) and
`09_token.py` (from `token-expiry`, written by the deploy from the `github-authentication-token-expiration` header if present,
`(unmeasured)`: OK > 14 d, WARN ≤ 14 d or unknown, RED expired). POLY-103 sends `alert` outward.

## R10 — CI, images, env wiring (F3, F10, POLY-85/97/98 comments)

- `build.yml`: a `siblings` job builds, pushes by per-run tag, Trivy-scans and provenance-attests `polycarpic-postgres`
  (`infra/postgres/Dockerfile`), `polycarpic-tools` (`infra/backup/tools.Dockerfile`) and `polycarpic-caddy` (`infra/caddy/Dockerfile`),
  each with `GIT_COMMIT` and the revision label. The app job `needs` it, runs the compose-policy lint, writes
  `infra/release/images.env` into the context from the siblings' digests, then builds. So the siblings are bound by the app's attestation.
- `POLY_APP_IMAGE`, `POLY_TOOLS_IMAGE`, `POLY_CADDY_IMAGE` become `${…:?}` (F10); the lint step's env sets all four.
- Env wiring: web, auth, worker, migrate and operator get `env_file: /etc/polycarpic/host.env` (staging: `staging-host.env`) and
  `DATABASE_HOST/PORT/NAME/USER/SSLMODE/PASSWORD_FILE` and `APP_ENV` in `environment:`; `DB_PASSWORD_FILE` goes. Includes the
  operator (POLY-98 M4) and the worker (POLY-142).
- `github_read_token` joins `HOST_ONLY` in both `lib/secrets.py` and `provision-check.sh` (root:root 0400) **only after seceng's
  pinned-set review in 100b**.
- `polycarpic-ops allowed-signers install`: the file on stdin from the laptop; each line `<principal> namespaces="git" ssh-ed25519 <base64>`,
  at least one; writes `/etc/polycarpic/allowed_signers` root:root 0644; replacing asks `yes`; prints fingerprints. Never fetched.
- provision-check lines in the POLY-97 R6 format: deploy units equal the bundle; `allowed_signers` present and well-formed (WAIT
  before prod); `edge.env` present; the deploy timer enabled for each project with a `current` (WAIT before it).
- `first-deploy <project>`: R5 in the foreground, waiting for the lock; on healthy enables `polycarpic-deploy@<project>.timer`, and
  for prod, once `/opt/polycarpic/images.env` exists, `polycarpic-backup.timer` and `polycarpic-uploader.timer`.

## R11 — Migrate-runner preflight (`packages/db`)

Add to `assertRoles` (runs for apply and `--plan`, before the lock; refusal `backup-acl`, exit 2, nothing applied):
- **(a)** No `pg_shdepend` row references poly_backup (`refclassid = 'pg_authid'::regclass`) in any database, except the ACL row of
  the current database, and that database's `datacl` item for poly_backup is exactly CONNECT. One sweep covers ownership (`o`),
  every ACL (`a`, column ACLs included), default privileges, and EXECUTE on a definer function.
- **(b)** poly_backup's attributes are exactly roles.sql's (LOGIN, REPLICATION, BYPASSRLS, not SUPERUSER/CREATEDB/CREATEROLE,
  CONNECTION LIMIT 3), and its `pg_db_role_setting` is exactly `{default_transaction_read_only=on}`.
- Whether `pg_shdepend` records every case in T-pre is `(unmeasured)`; a case it misses gets an explicit catalog read.

## R12 — The tests

**Seam.** Unit level: `tests/infra/ops/test_deploy.py` on the POLY-98 harness (`base.py`: temp root, every outside call faked,
subprocess and sockets raise). `ctx.run` dispatches on `argv[0]`:
- **fake registry** (`docker`): a dict `ref@digest → {labels, bundle tar, sibling refs}`; `pull` succeeds iff present;
  `inspect`/`create`/`cp`/`compose …` answer from it and from scripted health over fake time; every argv logged.
- **fake gh**: `api` routes (runs, releases) and `run download` from fixtures; `attestation verify` pass/fail per digest, argv logged.
- **git**: real `git` and `ssh-keygen` in the temp root for V4, two test keys (one in `allowed_signers`, one not), so the
  signature check is real, not scripted.
- **premigration**: `polycarpic-ops backup premigration` scripted exit and stdout (the backup command is POLY-99's, tested there).
- **Box fixture** (vitest, provision job): the POLY-97 box with the real ops bundle installed and `fakes-ops/` extended with the
  same fake `docker`/`gh`; at most three cases: a staging deploy end to end, a refusal, and the units/paths under a real root.

**Slice 0 (green before qa writes the rest):** fake registry holds digest X; gh fails V2 for X; `deploy staging` exits 1; the
docker log holds no `create`, `run` or `compose` argv naming X; `alert` names `attestation`; `quarantine` holds X. qa commits the
harness and this one test first, with any contract pins; the builder makes it green.

**Security-bearing tests, each red on a mutant copy of the code under test (never a fake of it):**

| # | Behaviour | Red on |
|---|---|---|
| T1 | V2's argv is exactly the four flags; failure stops before any run | mutant without `--source-ref`; mutant that runs after a failed verify |
| T2 | V3 wrong label stops and alerts (prod and staging) | mutant skipping V3 |
| T3 | V4 real: a tag signed by a key not in `allowed_signers`, a lightweight tag, a signed tag on another commit — each refused | mutant without `-c gpg.ssh.allowedSignersFile`; mutant without the commit compare |
| T4 | Prod highest semver, not newest; lower than `current` refused | mutant picking by date |
| T5 | A sibling failing V2 or carrying another commit's label stops the deploy | mutant skipping siblings |
| T6 | Bundle tar with a symlink, `..` or absolute member: refused, nothing written under `releases/` | mutant extracting with `tarfile` defaults |
| T7 | **Never rewrites itself:** a bundle carrying a changed `infra/ops/polycarpic-ops` and changed units; after a healthy deploy every file outside `releases/`, `images.env`, `state/deploy/` and the lock is byte-identical; no argv[0] under `releases/` | mutant copying the bundle's `infra/ops` into `ops/` |
| T8 | Unhealthy: rollback starts at ≤ 120 s fake time, candidate quarantined, previous `up` from its own bundle; next poll skips it | mutant without quarantine |
| T9 | `migrate` exit 1: no `up`, the running containers unchanged, quarantined, alert | mutant that `up`s anyway |
| T10 | Premigration 1/3/4, or exit 0 with a malformed line: no `migrate`, alert; exit 0 good line: line verbatim in `deploy.log` | mutant ignoring the line |
| T11 | `--pull never --no-build` on every compose up/run; no `-f` outside the release bundle | mutant without `--pull never` |
| T12 | `GH_TOKEN` never in argv or in any file under the root; gh's config dir empty after a run | mutant passing `--token` |
| T13 | Criterion 5 inputs: the `premigration-set` line in `deploy.log` is what `restore.sh --premigration --from-box` lists (box fixture, POLY-99 fake ssh) | — (timing is POLY-116) |
| T-pre | Runner exits 2 `backup-acl` on each: `GRANT CREATE ON SCHEMA public` (flip the two `it.fails`), `GRANT UPDATE (col)`, EXECUTE on a definer function, `TEMPORARY` on the database, `ALTER DEFAULT PRIVILEGES … TO poly_backup`, `ALTER TABLE … OWNER TO poly_backup`, `ALTER ROLE poly_backup SET default_transaction_read_only = off`; and **passes** on roles.sql's own state | mutant `assertRoles` without the sweep |
| T-lock | Criterion 7: two real `migrate` runs together on a slow file: both exit 0, one `applied:`, one `nothing to apply`, one tracking row, the second seen on `Lock/advisory` | mutant without the advisory lock |
| T-env | For each app service, the rendered `docker compose config` env plus `env_file` keys cover `packages/config`'s required keys for it | mutant compose keeping `DB_PASSWORD_FILE` |

Criterion 6 is `tests/db/runner.test.ts` "a failing file leaves schema and tracking unchanged", already green; qa cites it.

**Suite-time budget** (qa reports each delta at the gate against a same-day control on `main`):

| Job | May add | Holds |
|---|---|---|
| image | **0 s** | nothing; the POLY-99 backup suite (386 s) stays alone there |
| provision | ≤ 20 s unit (`test_deploy.py`) + ≤ 60 s box fixture | T1–T13 |
| db | ≤ 10 s | T-pre, T-lock (existing `runner.test.ts`, no new DB_AREAS entry) |
| lint | ≤ 5 s | T-env, workflow statics for R10 |

**Builder split.** R11 goes to **backend-lead** as its own sub-issue (lead files it): ~40 lines in `packages/db/src/migrate.ts`
and the T-pre/T-lock cases, disjoint from every infra path, and backend-lead owns the runner's refusal codes the deploy reads.
Cost: one more spawn. devops-engineer builds R1–R10.

## D — Decisions for the Principal

**D1 — The box's GitHub token scope.** *Mechanism:* the box needs a token only for `gh attestation verify` (M4) and the staging
artifact download (M3); every byte it reads is public (M1–M2). *Attacker's reach if the token is stolen from the box* (root
already, so it adds only what GitHub grants): (a) INFRA's design, fine-grained, this repo, `contents:read packages:read`: reads
the public repo and packages, nothing more today, but would read private content if the repo were ever made private;
(b) fine-grained, "public repositories, read-only", no permissions: reads only what anyone can, under the owner's name and
rate limit. *Cost of (b):* none in code; it must be shown to download an artifact and run `verify` (unmeasured; POLY-104 or
before). **Recommend (b).** The build is the same either way.

**D2 — Who deploys the shared edge.** *Mechanism:* one Caddy terminates TLS for both projects and sees every prod request in
plaintext, session cookies and passwords included. (a) Edge follows prod's signed release (R8): a Caddy change reaches staging
only when it is tagged, so it is not exercised on staging first; a bad one fails R6 and rolls back with the release.
(b) Edge follows staging's newest `main` build: whoever can merge to `main` controls the process that reads prod traffic,
which bypasses the signed-tag gate (C-83 residual). **Recommend (a).**

## L — For the lead

- **L1.** Criterion 5 says "measured in the restore drill"; the drill and its timing are POLY-116's. Amend the criterion to
  "the runbook's inputs are proven (T13); the 60 minutes is POLY-116's", or say otherwise.
- **L2.** `self-update` has no issue; suggest the ops follow-up umbrella.
- **L3.** File the R11 sub-issue for backend-lead.
- **L4.** User steps before the first real deploy: create the token (§D1); set up the SSH tag-signing key and `RELEASE_SIGNERS`
  (POLY-96 comment); after the first `build.yml` run, confirm the three new GHCR packages are public (unmeasured; a private one fails M2's path).
- **E — doc passages (owners, at the verdict):** INFRA §3.2, §3.3, §4.4–§4.6, §7.1 first-deploy, §8.6 (devops); SECURITY
  C-83 tested-by and the `HOST_ONLY` row (seceng); ARCH §8.1 state paths, edge, sibling binding, R6 (architect, with 100e).
