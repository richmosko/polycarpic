# POLY-100 ruling: pull-based deploy and timers

Architect, 2026-11-23. Tree read at `aa8247f327a68b619342e27a06f895232f293d32`. Sources: the description, seven criteria and
twelve comments on `POLY-100.md`; POLY-99 ruling R5/R6 and verdict §8; INFRA §2.2, §3.2–§3.3, §4.4–§4.6, §6.4, §6.8, §7.1,
§8.6–§8.10; ARCH §8.1; SECURITY C-83, T-64, T-92, TB-12, R-29; DECISIONS 2026-11-23; seceng-100's prep (attacker table
A1–A6, holes 1–5, conditions D1–D15, advisories A-a–A-d), mapped in §S. A claim is measured (§M) or tagged `(unmeasured)`.
The ruling proceeds on each recommendation in §D unless the issue file says otherwise.

## M — Measurements (this Mac, gh 2.105.0, 2026-11-23, digest of build run 45196636649)

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M1 | Repo visibility | `gh repo view --json visibility` | `PUBLIC` |
| M2 | Anonymous GHCR pull | anonymous `ghcr.io/token`, then `GET /v2/richmosko/polycarpic/manifests/<digest>` | **200**: no registry credential, no `docker login` file on the box |
| M3 | Anonymous Actions/Releases reads | `curl` without auth: runs, run artifacts, releases; then `archive_download_url` | 200, 200, 200; artifact download **401** |
| M4 | Verify without a credential | `gh attestation verify` with an empty `GH_CONFIG_DIR`, no `GH_TOKEN` | refuses ("gh auth login"); with a token exit 0 |
| M5 | `--source-ref` enforced | `--source-ref refs/heads/other` | exit 1 |
| M6 | `--source-digest` enforced | the run's `headSha`; then 40 zeros | exit 0; **exit 1** |
| M7 | `--predicate-type` | `https://slsa.dev/provenance/v1`; `https://cyclonedx.org/bom` | both exit 0: each pins which attestation is checked |

So the box needs **a** GitHub token (M3, M4), and nothing it reads is private (M1, M2); scope is §D1. M6 is what binds an
image to a commit: the source digest comes from the Fulcio certificate GitHub issues, not from anything the build writes,
unlike the label (seceng A2). Unmeasured: whether a fine-grained token returns `github-authentication-token-expiration`.

## Scope

IN: R1–R13. OUT:

| Item | Goes to | Why |
|---|---|---|
| Box-side copy back into prod (`restore-apply`) | POLY-158 | DECISIONS 2026-11-23 D2. |
| Criterion 5's **timing** (60 min, on the laptop) | POLY-116 | The timed drill is the GA gate there. This loop proves the runbook's inputs (T13). **§L1.** |
| Outbound alert route; token-expiry alert; Rekor watch (seceng A-b) | POLY-103 | Monitoring. This loop writes the files it reads (R10). |
| Live first deploy; real `check-config` in the rendered env; units under real systemd; the real token (§D1) | POLY-104 | First staging deploy. |
| Home-box DNS-plugin Caddy build; home egress allowlist (`tuf-repo-cdn.sigstore.dev`, `ghcr.io`, `api.github.com`, `github.com`) | POLY-120 | Home box is post-GA. |
| `polycarpic-ops self-update` (INFRA §8.7) | **§L2** (unhomed) | The ops tool keeps updating by `install.sh` (§D3). |
| `migrate --plan` under a read-only credential (seceng A-a) | not taken | R6 takes the prod backup before any candidate container holds a credential, which closes the same window. |

## R1 — Entry points, units, lock

- New `infra/ops/commands/deploy.py` (`deploy <prod|staging>`), `first_deploy.py`, `rollback.py`, `allowed_signers.py`;
  `infra/ops/lib/release.py` (candidate, verify, bundle, state) and `lib/compose_guard.py` (R5). POLY-98 house style: root,
  injected `ctx`, argv lists, `fixed_env`. Every value from GitHub is regex-checked before use; a miss is refusal `malformed`.
- Units in `infra/deploy/systemd/`: `polycarpic-deploy@.service` (oneshot, `ExecStart=/usr/local/sbin/polycarpic-ops deploy %i`,
  `TimeoutStartSec=90min`) and `polycarpic-deploy@.timer` (`OnCalendar=*:0/5`, `RandomizedDelaySec=60`). `provision.sh --stage
  host` installs both, not enabled; provision-check compares them to the ops bundle, as it does for the backup units.
- Lock: `flock -n /run/polycarpic/deploy.lock`, **one for both projects** (both can touch edge). Busy timer run → exit 0, log
  `busy`, nothing else touched. `first-deploy` and `rollback` wait at most 10 min (exit 4). Lock order is always
  `deploy.lock` then `backup.lock`; the nightly takes only `backup.lock`.

## R2 — Finding the candidate

| | Source | Accept only |
|---|---|---|
| staging | `GET …/actions/workflows/build.yml/runs?branch=main&status=success&per_page=1`, then `gh run download <id> -n image-<head_sha>` into a root 0700 temp dir | `id` `^[0-9]{1,20}$`; `head_sha` 40-hex; `head_branch` = `main`; `event` ∈ {`push`, `schedule`}; `path` = `.github/workflows/build.yml`; `digest.txt` exactly `sha256:<64 hex>\n`. Commit C = `head_sha` |
| prod | `GET …/releases?per_page=100` | non-draft, non-prerelease, `tag_name` `^v1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`; the **highest semver**, not the newest date; body exactly one line `^digest: sha256:[0-9a-f]{64}$`. Commit C = the signed tag's commit (V4) |

Then: digest equal to `current` → exit 0. Digest in `quarantine` → exit 0, log `quarantined`, no new alert.

**Monotonic** (seceng D3, A2'):
- **Prod:** the version, read from the **signed tag object's** `tag` field, must be above `current`'s. That field, the ref
  name and the Release `tag_name` must be equal. Otherwise `not-newer` / `tag-name`.
- **Staging:** C must equal `current`'s commit or descend from it: `git merge-base --is-ancestor <current> C` in the bare
  repo of V4, after `git fetch --filter=tree:0 https://github.com/richmosko/polycarpic C`. Ancestry is part of the commit
  object, so the server cannot fake it for a given sha. A re-run of an old run is therefore refused (`not-newer`).
- A downgrade happens only through `rollback`.

`gh` gets `GH_TOKEN` from `secrets/host/github_read_token` in its environment only: never argv, never `docker login`, with
`GH_CONFIG_DIR` an empty root 0700 dir. git and docker get no token (M1, M2).

## R3 — Verify, all before anything runs

In this order; each check is a named refusal. Every refusal is logged and raises the R10 alert. A **Q** row also
quarantines the digest. A network or API failure is never Q (seceng D13): it is logged as `transient` and retried at the
next poll.

| # | Check | Refusal | Q |
|---|---|---|---|
| V1 | `gh attestation verify oci://ghcr.io/richmosko/polycarpic@<digest> --repo richmosko/polycarpic --signer-workflow richmosko/polycarpic/.github/workflows/build.yml --source-ref refs/heads/main --deny-self-hosted-runners --source-digest C --predicate-type https://slsa.dev/provenance/v1`, exit 0, **before any pull** | `attestation` | no (gh's exit does not tell a refusal from an outage; the next poll re-checks) |
| V2 | `docker pull ghcr.io/richmosko/polycarpic@<digest>`; `RepoDigests` holds it | `pull` | no |
| V3 | Label `org.opencontainers.image.revision` == C (a build-bug check; V1 is the binding) | `label` | yes |
| V4 (prod) | In the bare repo `/var/lib/polycarpic/state/deploy/tags.git` (created by root): `git fetch --no-tags https://github.com/richmosko/polycarpic refs/tags/<tag>:refs/tags/<tag>`; `cat-file -t` = `tag`; the signature block is SSH; `git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=/etc/polycarpic/allowed_signers verify-tag <tag>` exit 0, with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`; `rev-parse <tag>^{commit}` gives C | `tag-signature`, `tag-commit` | yes |
| V5 | Bundle extracted and checked (R4); its `images.env` well-formed; each sibling passes V1 with the **same** C and the same flags, then V2 and V3 | `bundle`, `sibling-<name>` | yes (V1/V2 of a sibling: no) |
| V6 | Bundle `infra/postgres-major` equals `current`'s (skipped on the first deploy) | `postgres-major` (a major upgrade is INFRA §5's operator procedure) | yes |
| V7 | Compose guard passes on the rendered config (R5) | `guard-<rule>` | yes |

**Nothing with a candidate digest is created, run or composed before V1–V7 pass.** The only exceptions are `pull`,
`image inspect`, and R4's `docker create`, which never starts. Every `compose up` and `compose run` carries
`--pull never --no-build`, so compose never resolves a tag.

## R4 — The release bundle is data (F5, F8, R-b; seceng D7, D8, hole 5)

- Extraction: `docker create --name polycarpic-bundle-<12 hex> <ref>@<digest>` (never started), then
  `docker cp <cid>:/app/infra -`, then `docker rm`.
  - The tar goes through a filter. It refuses: symlinks, hardlinks, devices, FIFOs, setuid/setgid bits, absolute or `..`
    paths, and any path outside the fixed manifest: `infra/compose/{prod,staging,edge}.yml`, `infra/caddy/Caddyfile`,
    `infra/postgres/**` (config and `archive-wal.sh`), `infra/backup/{backup,upload}.sh`, `infra/postgres-major`,
    `infra/release/images.env`.
  - Extraction goes into a fresh root 0700 `releases/.incoming-<12hex>/`. Then root 0755/0644 (container-run scripts
    0755), and a rename to `releases/sha256-<64 hex>/`.
  - Root records a sha256 tree hash in `state/deploy/<project>/current`. Rollback re-checks it.
  - Kept: each project's `current` and `previous`; anything older is pruned after a healthy run.
- **The host executes nothing from `releases/`.** No argv[0] under it, ever. Its scripts run only inside containers, as
  mounts. The host's own programs are the installed ops bundle, changed only by `install.sh` (§D3).
- `releases/<d>/images.env` is the bundle's `infra/release/images.env` plus
  `POLY_APP_IMAGE=ghcr.io/richmosko/polycarpic@<digest>`. The bundle file holds exactly `POLY_POSTGRES_IMAGE`,
  `POLY_TOOLS_IMAGE` and `POLY_CADDY_IMAGE`, each `=ghcr.io/richmosko/polycarpic-<postgres|tools|caddy>@sha256:<64>`,
  with name↔repo fixed. It is written root 0644 by atomic rename, only after V5.
- Every compose call is `-p polycarpic-<project> --project-directory releases/<d>/infra/compose -f releases/<d>/infra/compose/<project>.yml --env-file releases/<d>/images.env`.
  - Prod's edge calls add `-f …/edge.yml --env-file /etc/polycarpic/edge.env`.
  - The installed script fixes the project, the kind and the files; the bundle cannot choose any of them (seceng D10).
- **R-b:** `lib/compose.py` resolves compose files from `releases/<project>-current` (a root symlink) when it exists, else
  from the ops bundle. `backup.py` (`BUNDLE_COMPOSE`), `upload.py`, `cli.py` and `set_secret.py` all go through it.
- After a healthy prod run, `/opt/polycarpic/images.env` becomes that release's `images.env` (tmp + rename, root 0644).

## R5 — The compose guard: the bundle does not judge itself (seceng holes 1, 2, 4; D6, D9, D10)

`lib/compose_guard.py` is part of the **installed** ops bundle, not the release. Its policy is installed with it at
`infra/deploy/compose-allow.json`. It runs after V6 and before any `compose run` or `up`.

1. **Pre-render.** Refuse if any bundle compose file has a line matching `^\s*(include|extends)\s*:`, so the render
   cannot pull in other files.
2. **Render.** `docker compose … config --format json`, with R4's fixed arguments.
3. **Check by allowlist,** not denylist. The guard refuses each of these:
   - a service not in the allowlist for that project;
   - an `image` that is not one of the digests V1–V5 just verified;
   - a top-level `name` other than the `-p` value, or any `container_name`;
   - `privileged`, `cap_add`, `devices`, `pid`/`ipc`/`userns_mode`/`network_mode` set to `host`, or a `security_opt`
     other than `no-new-privileges:true`;
   - a bind-mount source outside that service's allowlisted host paths, which never include `/`, the Docker socket,
     `/opt/polycarpic/ops`, `/var/lib/polycarpic/state` or `secrets/host/`;
   - a secret file outside the service's own directory;
   - a network outside the project's own set;
   - a `ports:` mapping on anything but caddy.

This guard is **narrower** than the CI lint (C-70), which stays the full check on every PR. The guard is the trust
boundary, because staging runs `main` with no human gate. Changing its policy needs an operator `install.sh` (§D3).

## R6 — Order of a run (prod; staging differs where marked)

1. Lock (R1), candidate (R2), V1–V7 (R3–R5).
2. If Postgres is not running in the project, start it with `up -d --no-deps postgres` from the candidate bundle. It must be
   healthy within 120 s, or stop (`postgres-start`).
3. **Prod only, and before any candidate container holds a credential** (seceng A-a): run `polycarpic-ops backup premigration`
   as a subprocess, timeout 65 min.
   - Continue only on exit 0 **and** a last stdout line matching
     `^premigration-set <TS> dump-…\.age=<64 hex> globals-…\.age=<64 hex>$`. This is the form `backup.py` prints and INFRA
     §6.4 states. The line goes to `deploy.log` verbatim.
   - On 1, 3, 4 or anything else: stop with `premigration-<code>`, no quarantine; the next poll retries.
   - Prod deploys are tag-rare, so one dump per deploy is affordable (its duration is `(unmeasured)`; POLY-104).
   - `first-deploy` skips this step: the project has never had a release, so there is no data to protect, and before
     `provision --stage database` poly_backup does not exist. The timer's `deploy` never skips it, and refuses to run at
     all while the project has no `current` (`not-first-deployed`).
   - Staging has no backup service and skips steps 3 and 4.
4. **Prod only:** take `backup.lock` (wait at most 30 min, else stop with `backup-lock`) and hold it to the end, so no
   nightly starts during migrate or recreate.
5. `check-config` in migrate, web, auth and worker: `compose run --rm --no-deps -T <svc> <svc> check-config`. Each must
   exit 0, or stop (`check-config`, Q).
6. `migrate --plan`:

   | Exit | Action |
   |---|---|
   | 0 | skip to step 8 |
   | 3 | continue |
   | 2 | stop (`plan-diverged`, Q) |
   | other | stop (`plan-error`, no Q) |

   On the first deploy, exit 2 naming `roles-missing` prints `run: sudo polycarpic-ops provision --stage database --project <p>`
   and exits 4. The operator then runs `first-deploy` again.
7. `migrate`:

   | Exit | Action |
   |---|---|
   | 0 | continue |
   | 1 or 2 | stop (`migrate-<code>`, Q); the old containers were never touched |
   | 4 | stop, no Q |

8. `up -d --pull never --no-build` for the project; edge as R9 says.
9. Health (R7). Healthy → state (R10), prune (R4), clear the alert. Unhealthy → rollback (R8).

## R7 — Healthy

Health is polled every 5 s for up to 120 s after `up -d` returns. A release is healthy when:
- every long-running service of the project (postgres, web, auth, worker, and caddy when R9 recreated it) is `running`, with
  `Health.Status=healthy` and a `Config.Image` equal to `images.env`; **and**
- `compose exec -T web node -e "<fetch http://127.0.0.1:3000/api/v1/health>"` reports HTTP **200**. The decision reads the
  status code only, never the body (seceng D15).

The HTTP clause exists because the worker's healthcheck is `process.exit(0)`. A compromised container can still answer 200
(A5); health is a liveness gate, not a security one.

## R8 — Rollback and quarantine

- **Automatic:** at the 120 s mark:
  1. Quarantine the candidate (`<digest> <UTC> unhealthy`).
  2. Re-check `previous`'s tree hash, then `up -d` from its bundle and its `images.env`.
  3. Run R7 again.
  - Healthy → `rolled-back`, alert.
  - Unhealthy, or no `previous` (first deploy) → `rollback-unhealthy`, alert, change nothing else (INFRA §8.6).
  - **Rollback never migrates.**
  - Criterion 3's "within 120 s" means the rollback **starts** no later than 120 s after `up -d`.
- **Manual:** `polycarpic-ops rollback <project>` makes no GitHub call. It quarantines `current` and ups `previous` from
  `releases/`, after the tree-hash re-check and R1's integrity check, then runs R7.

## R9 — Edge (seceng hole 3; §D2)

- `edge.yml`, the Caddyfile and the Caddy image come from **prod's** signed release, and are rendered and upped only by
  a prod run.
- **One exception:** on a host where prod has no `current` and no `polycarpic-prod` container exists, staging's run owns
  edge. Without it a staging-only host (POLY-104, before any `v1.*` tag) cannot be reached. No prod traffic exists then.
- Prod's first deploy always recreates caddy, so no staging-built edge survives into prod. R7 then includes caddy.
- `/etc/polycarpic/edge.env` (`POLY_DOMAIN`, `POLY_BIND_ADDR`, `POLY_STAGING_ALLOW`, `POLY_TLS`; root 0644) is written by
  `provision.sh`, with a provision-check line.

## R10 — State, log, alert

`/var/lib/polycarpic/state/deploy/<project>/`, root 0755, files root 0644, written tmp + rename, mounted by nothing:

| File | Content |
|---|---|
| `current`, `previous` | one line `<digest> <tag or -> <commit> <tree sha256> <UTC>` |
| `quarantine` | lines `<digest> <UTC> <reason>` |
| `deploy.log` | append `<UTC> <event> <fields>`. Events are a closed set: `candidate verified refused transient busy quarantined not-newer premigration-set migrated up healthy rolled-back rollback-unhealthy` |
| `alert` | one line `<UTC> <refusal or event>`. Written on every stop or rollback; removed on the next healthy run |
| `last-poll` | UTC of the last run that read GitHub successfully (seceng A-c) |

New status modules:
- `08_deploy.py`:
  - OK: digest, tag and age.
  - RED while `alert` exists, naming it.
  - WARN when `last-poll` is older than 1 h, which means a freeze or an outage.
  - WAIT when not deployed.
- `09_token.py`: reads `token-expiry`, which the deploy writes from the `github-authentication-token-expiration` header
  when it is present `(unmeasured)`.
  - OK: more than 14 days left.
  - WARN: 14 days or fewer, or the expiry is unknown.
  - RED: expired.

POLY-103 sends `alert` outward.

## R11 — CI, images, env wiring, signers (F3, F10; POLY-85, 97, 98 comments)

- **`build.yml` siblings job.** It builds, pushes by per-run tag, Trivy-scans and provenance-attests three images, each with
  `GIT_COMMIT` and the revision label:
  - `polycarpic-postgres` from `infra/postgres/Dockerfile`;
  - `polycarpic-tools` from `infra/backup/tools.Dockerfile`;
  - `polycarpic-caddy` from `infra/caddy/Dockerfile`.
- **`build.yml` app job.** It `needs` the siblings job. It runs the compose-policy lint, writes `infra/release/images.env`
  from the siblings' digests, then builds. The siblings are therefore covered by the app's attestation, and V5 checks each
  sibling's own attestation as well.
- `POLY_APP_IMAGE`, `POLY_TOOLS_IMAGE` and `POLY_CADDY_IMAGE` become `${…:?}` with no default digest anywhere (F10). The lint
  step's env sets all four.
- **Env wiring.** web, auth, worker, migrate and operator get:
  - `env_file: /etc/polycarpic/host.env` (staging: `staging-host.env`);
  - `DATABASE_HOST/PORT/NAME/USER/SSLMODE/PASSWORD_FILE` and `APP_ENV` in `environment:`.

  `DB_PASSWORD_FILE` is removed: no service passes `check-config` with it today. This covers the operator (POLY-98 M4) and
  the worker (POLY-142).
- `HOST_ONLY` becomes exactly `{heartbeat_url, github_read_token}`, in both `lib/secrets.py` and `provision-check.sh`
  (root:root 0400). This lands **only with seceng's pinned-set sign-off in 100b**.
- **`polycarpic-ops allowed-signers install`.** It reads the file on stdin from the laptop. Each line must be
  `<principal> namespaces="git" ssh-ed25519 <base64>`, and there must be at least one. It writes
  `/etc/polycarpic/allowed_signers` root:root 0644, asks for `yes` before replacing, and prints the fingerprints. The file
  is never fetched.
- **provision-check lines,** in the POLY-97 R6 format:
  - the deploy units equal the bundle's copies;
  - `compose-allow.json` is present and root-owned;
  - `allowed_signers` is present and well-formed (WAIT before prod);
  - `edge.env` is present;
  - the deploy timer is enabled for each project that has a `current` (WAIT before then).
- **`first-deploy <project>`.** It runs R6 in the foreground, waiting for the lock. When healthy, it enables
  `polycarpic-deploy@<project>.timer`. For prod, once `/opt/polycarpic/images.env` exists, it also enables
  `polycarpic-backup.timer` and `polycarpic-uploader.timer`.

## R12 — Migrate-runner preflight (`packages/db`)

These checks go into `assertRoles`, which runs for both apply and `--plan`, before the lock. A failure is refusal
`backup-acl`: exit 2, nothing applied.

- **(a)** No `pg_shdepend` row may reference poly_backup (`refclassid = 'pg_authid'::regclass`) in any database, with one
  exception: the ACL row of the current database. That database's `datacl` item for poly_backup must be exactly CONNECT.
  This one sweep covers:
  - ownership (`o`);
  - every ACL (`a`), column ACLs included;
  - default privileges;
  - EXECUTE on a definer function.
- **(b)** poly_backup's attributes must be exactly roles.sql's: LOGIN, REPLICATION, BYPASSRLS, not
  SUPERUSER/CREATEDB/CREATEROLE, CONNECTION LIMIT 3. Its `pg_db_role_setting` must be exactly
  `{default_transaction_read_only=on}`.
- Whether `pg_shdepend` records every T-pre case is `(unmeasured)`. A case it misses gets an explicit catalog read.

## R13 — The tests

**Seam.**
- **Unit level:** `tests/infra/ops/test_deploy.py`, on the POLY-98 harness (`base.py`: temp root, every outside call faked,
  subprocess and sockets raise). `ctx.run` dispatches on `argv[0]`.
- **Fake registry (`docker`):** a dict `ref@digest → {labels, bundle tar}`.
  - `pull` succeeds only if the digest is present.
  - `inspect`, `create` and `cp` answer from the dict.
  - `compose … config` renders the bundle's real files: it shells out to real `docker compose config` only where the
    test runner has it; otherwise a fixture JSON is committed beside the test.
  - `compose up` and `compose run` follow scripted health over fake time.
  - Every argv is logged.
- **Fake gh:**
  - `api` routes (runs, releases) and `run download` answer from fixtures.
  - `attestation verify` passes or fails per (digest, `--source-digest`), and its argv is logged.
- **Real git:** `git` and `ssh-keygen` run in the temp root for V4 and for the staging ancestry check. Two test keys are
  used, one in `allowed_signers` and one not. So the signature and ancestry checks are real, not scripted.
- **Premigration:** `polycarpic-ops backup premigration` has a scripted exit and stdout. The backup command is POLY-99's,
  tested there.
- **Box fixture** (vitest, provision job): the POLY-97 box, with the real ops bundle installed and `fakes-ops/` extended
  with the same fake `docker` and `gh`. At most three cases:
  - a staging deploy end to end;
  - one refusal;
  - the units and paths under a real root.

**Slice 0** (green before qa writes the rest):
- The fake registry holds digest X, and gh fails V1 for X.
- `deploy staging` exits 1.
- The docker log holds no `pull`, `create`, `run` or `compose` argv naming X.
- `alert` names `attestation`.

qa commits the harness and this one test first, with any contract pins; the builder makes it green.

**Security-bearing tests.** Each goes red on a mutant copy of the code under test, never on a fake of it:

| # | Behaviour | Red on |
|---|---|---|
| T1 | V1's argv is exactly R3's seven flags with C; V1 precedes any pull; a failure stops all | mutant without `--source-ref`; without `--source-digest`; that pulls first |
| T2 | **Label alone does not bind:** an image labelled X, attested at H; `--source-digest X` refuses it (the label check alone would pass) | mutant using the label as C |
| T3 | V4 real: a tag signed by a key not in `allowed_signers`, a lightweight tag, a GPG-signed tag, a signed tag on another commit, a tag object whose `tag` field ≠ ref ≠ Release name: each refused | mutant without `-c gpg.ssh.allowedSignersFile`; without the name compare; honouring a global git config that sets another signers file |
| T4 | Monotonic: prod highest semver, not newest; lower than `current` refused; staging candidate not descending from `current` (a re-run of an old run) refused | mutant picking by date; mutant without the ancestry check |
| T5 | A sibling failing V1, or attested at another commit, stops the deploy | mutant skipping siblings |
| T6 | Bundle tar with a symlink, hardlink, setuid file, `..`, absolute or off-manifest member: refused, nothing under `releases/` | mutant using `tarfile` defaults |
| T7 | **Never rewrites itself:** a bundle carrying a changed `infra/ops/polycarpic-ops`, changed units and a script that would touch a canary. After a healthy deploy every file outside `releases/`, `images.env`, `state/deploy/` and the lock is byte-identical, the canary is absent, and no argv[0] is under `releases/` | mutant copying the bundle's `infra/ops` into `ops/`; mutant running a bundle script |
| T8 | Guard, each refused with no container of the digest created: `privileged: true`; a bind of `/`; the Docker socket; an `image:` outside the verified set (`ghcr.io/anyone/x@sha256:…`); top-level `name: polycarpic-prod` in a staging bundle; `container_name`; an `include:` line | mutant guard that denylists instead of allowlisting; mutant without the image-set check |
| T9 | Staging never renders `edge.yml` once prod has a `current`; prod's first deploy recreates caddy | mutant letting staging up edge |
| T10 | Unhealthy: rollback starts at ≤ 120 s fake time; candidate quarantined; previous upped from its own bundle after the tree-hash check; no migrate; next poll skips it without re-alerting | mutant without quarantine; mutant skipping the hash re-check |
| T11 | `migrate` exit 1: no `up`, the running containers unchanged, quarantined, alert | mutant that `up`s anyway |
| T12 | Prod: premigration runs before the first `compose run`. 1/3/4, or exit 0 with a malformed line: no `check-config`, no `migrate`, alert. Exit 0 with a good line: the line verbatim in `deploy.log` | mutant running `check-config` first; mutant ignoring the line |
| T13 | Criterion 5 inputs: the `premigration-set` line in `deploy.log` is what `restore.sh --premigration --from-box` lists (box fixture, POLY-99's fake ssh) | — (timing is POLY-116) |
| T14 | `--pull never --no-build` on every compose up/run; only R4's `-f` files | mutant without `--pull never` |
| T15 | `GH_TOKEN` is never in argv, never in any file under the root, never in `deploy.log`; gh's config dir is empty after a run; no `/root/.docker/config.json`. A gh outage is `transient`, not quarantined | mutant passing `--token`; mutant quarantining on gh exit 1 with a network stderr |
| T16 | Two deploys together: the second exits 0 `busy` and touches nothing | mutant without `-n` |
| T-pre | The runner exits 2 `backup-acl` on each of: `GRANT CREATE ON SCHEMA public` (flip the two `it.fails`); `GRANT UPDATE (col)`; EXECUTE on a definer function; `TEMPORARY` on the database; `ALTER DEFAULT PRIVILEGES … TO poly_backup`; `ALTER TABLE … OWNER TO poly_backup`; `ALTER ROLE poly_backup SET default_transaction_read_only = off`. It **passes** on roles.sql's own state | mutant `assertRoles` without the sweep |
| T-lock | Criterion 7: two real `migrate` runs together on a slow file. Both exit 0, one prints `applied:` and the other `nothing to apply`, there is one tracking row, and the second is seen on `Lock/advisory` | mutant without the advisory lock |
| T-env | For each app service, the keys of the rendered `docker compose config` env plus `env_file` cover `packages/config`'s required keys for it | mutant compose keeping `DB_PASSWORD_FILE` |

Every refusal test asserts the exit code and the refusal name, and each guard has a positive case. Criterion 6 is
`tests/db/runner.test.ts` "a failing file leaves schema and tracking unchanged", which is already green; qa cites it.

**Suite-time budget.** qa reports each delta at the gate, against a same-day control on `main`.

| Job | May add | Holds |
|---|---|---|
| image | **0 s** | nothing; the POLY-99 backup suite (386 s) stays alone there |
| provision | ≤ 25 s unit (`test_deploy.py`), plus ≤ 60 s box fixture | T1–T16 |
| db | ≤ 10 s | T-pre, T-lock (in the existing `runner.test.ts`; no new DB_AREAS entry) |
| lint | ≤ 5 s | T-env; workflow statics for R11 |

**Builder split.** R12 goes to **backend-lead** as its own sub-issue, which the lead files:
- about 40 lines in `packages/db/src/migrate.ts`, plus the T-pre and T-lock cases;
- disjoint from every infra path;
- backend-lead owns the runner's refusal codes that the deploy reads.

The cost is one more spawn. devops-engineer builds R1–R11.

## D — Decisions for the Principal

**D1 — The box's GitHub token scope** (seceng P-a).
- *Mechanism:* the token is needed only for `gh attestation verify` (M4), the staging artifact download (M3) and the
  rate limit (60 an hour anonymous, per seceng). Everything it reads is public (M1, M2).
- *Reach if stolen* (that needs root on the box or the laptop during `set-secret`):
  - **(a)** INFRA's spec, fine-grained, this repo, `contents:read packages:read`. Today it reads only public data; it would
    read private content if the repo were made private. seceng believes GHCR refuses fine-grained tokens for packages,
    forcing a classic `read:packages` PAT, which reaches every package the account can read.
  - **(b)** Fine-grained, "public repositories, read-only", no permissions. It reads only what anyone can, under the
    owner's rate limit; the worst a thief can do is exhaust that limit and so stall the poll.
- *Cost of (b):* nothing in code. It must be shown to download a public artifact and to run `verify` `(unmeasured)`, by a
  one-call check before POLY-104.
- **Recommend (b).** A classic PAT is refused under either option. The build is the same either way.

**D2 — The shared edge on a staging-only host** (R9).
- *Mechanism:* one Caddy terminates TLS for both projects and reads every prod request in plaintext.
- Options:
  - **(a)** As R9: edge comes from prod's signed release, except on a host with no prod at all. Prod's first deploy
    replaces whatever staging ran.
  - **(b)** Strict (seceng's hole 3, read literally): staging never touches edge. A staging-only host cannot be reached
    until the first `v1.*` tag, which blocks POLY-104.
  - **(c)** Edge follows staging always. Whoever can merge to `main` controls the process that reads prod traffic, which
    bypasses C-83's signed-tag gate.
- **Recommend (a).**

**D3 — Box-guard policy changes ship only by an operator step** (R5; seceng P-b).
- *Mechanism:* the guard and `compose-allow.json` are installed tooling. A release that adds a mount, a service or a
  network is refused (`guard-…`, quarantined) until the operator runs `install.sh` (later `self-update`) from a reviewed
  checkout.
- *Why:* staging has no human gate, so the bundle judging itself would let any `main` merge mount host paths on the box
  that also runs prod.
- *Cost:* a compose change becomes a two-step release. The guard refuses loudly, so it is a cost, not a silent breakage.
- Options:
  - **(a)** As ruled.
  - **(b)** The release's own policy, checked by the installed guard code. This is weaker: a `main` merge widens the policy
    itself.
- **Recommend (a).**

## S — seceng-100 prep, mapped

| seceng | Where |
|---|---|
| Hole 1 (bundle judges itself), D9 | R5. Python guard in the installed bundle, not the node lint in an image: the tools image has no node, and the candidate's node is the A2 attacker |
| Hole 2 (literal image refs), D6 | R5 image-set rule, R4, R11 F10 |
| Hole 3 (edge from staging), D10 | R9, §D2 (staging-only-host exception, and why) |
| Hole 4 (project identity), D10 | R4 fixed `-p` and `-f`; R5 `name` and `container_name` |
| Hole 5 (host programs from the bundle), D8, D11 | R4, T7 |
| D1 flags, verify before pull | R3 V1 (M6, M7), T1. SBOM-only attestation refused by `--predicate-type` |
| D2 commit binding | R2 run fields, R3 V1 `--source-digest`, T2 |
| D3 monotonic, tag names | R2, T3, T4 |
| D4 pinned git config | R3 V4 (`GIT_CONFIG_GLOBAL=/dev/null`, SSH only), R11 signers, T3 |
| D5 strict inputs | R2, R1 |
| D7 extraction manifest, tree hash | R4, T6, T10 |
| D12 token | R2, R11 `HOST_ONLY`, T15, §D1 |
| D13 fail closed; outage not quarantined | R3 Q column, T15 |
| D14 locks | R1, T16 |
| D15 health by status only; rollback never migrates | R7, R8 |
| A-a | R6 step 3: prod backup before any candidate credential |
| A-b | Scope → POLY-103 |
| A-c | R10 `last-poll`, `08_deploy` WARN |
| A-d | §E: INFRA §4.4's re-run sentence is wrong |

## L — For the lead

- **L1.** Criterion 5 says "measured in the restore drill", but the drill and its timing are POLY-116's. Amend the
  criterion to "the runbook's inputs are proven (T13); the 60 minutes is POLY-116's", or say otherwise.
- **L2.** `self-update` has no issue; I suggest the ops follow-up umbrella.
- **L3.** File the R12 sub-issue for backend-lead.
- **L4.** User steps before the first real deploy:
  - create the token (§D1), and run the one-call check;
  - set up the SSH tag-signing key and `RELEASE_SIGNERS` (POLY-96 comment);
  - after the first `build.yml` run, confirm that the three new GHCR packages are public `(unmeasured)`.

## E — Doc passages (owners, at the verdict)

- **INFRA** (devops):
  - §3.2 and §3.3: the token and `HOST_ONLY`;
  - §4.4–§4.6;
  - §4.4's re-run sentence, which is wrong: a re-run keeps the original commit;
  - §7.1 first-deploy;
  - §8.6.
- **SECURITY** (seceng): C-83 flags and tested-by; the `HOST_ONLY` row; the guard as a control.
- **ARCH §8.1** (architect, with 100e): state paths, edge, the binding of the siblings, R5, R7.
