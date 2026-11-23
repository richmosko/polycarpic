# POLY-100b — seceng's review of the ruling

Reviewed: `process/cairn/reviews/POLY-100/ruling.md` @ `43af930317ad2ac8ab04e49fe56e86a1e5ef3a35`. Read alongside: SECURITY
TB-12, T-64, T-92, T-94, T-65/R-4, C-81–C-83, R-29, the host-only rule; INFRA §4.4–§4.6; `build.yml`, `release.yml`,
`infra/ci/release-lookup.sh`; `infra/lint/compose-policy.mjs`; `infra/compose/*.yml`; `packages/db/sql/roles.sql`.

**Verdict: accepted with conditions S1–S9.** No position is refused. Each condition names its test, red on a mutant of
the code under test. The architect may carry them by reference ("seceng S1–S9, `ruling-review.md` @ <sha>"). D1 and D2:
I agree with both recommendations (section "For the Principal").

## Measured here (2026-11-23, this Mac, authenticated gh)

| # | Question | Result |
|---|---|---|
| SM1 | Does `gh attestation verify` enforce `--source-digest`? Build run 45196636649 (push, `main`, commit `889c0494…`), its recorded digest, the four C-83 flags. | With `--source-digest 889c0494…`: exit 0. With another `main` commit (`aa8247f3…`): exit 1, `expected SourceRepositoryDigest to be aa8247f3…, got 889c0494…`. The value comes from the Sigstore certificate, which GitHub's OIDC token sets, not the build. |
| SM2 | `gh attestation verify --help` | `--predicate-type` defaults to `https://slsa.dev/provenance/v1`; `--source-digest` and `--signer-digest` exist. |

## What each attacker reaches under the ruling as written

One host runs prod, staging and edge (INFRA §2, R-4), so root on the host is root on prod. A path to root through
staging is a path to prod.

| Attacker | Reaches as ruled | Stopped by | Gap → condition |
|---|---|---|---|
| **A1** branch Actions run (edited `build.yml`, any writer) | GHCR push, an attestation naming `build.yml` | V2 `--source-ref refs/heads/main` (T-92). R2 never offers a branch digest. | none |
| **A2** Actions run on `main` (a malicious merged commit, a compromised SHA-pinned action or runner) | Any image content, **any label**, a valid attestation from `main`, `digest.txt`, the siblings and their `images.env` | Staging: nothing; it runs `main` by design. What keeps that from root is the compose definition, and the compose files come from that same image. R4's "the lint ran in CI before the attest" binds only an honest run: A2 skips the lint step, or edits `policy.json` in the same PR. Prod: the signed tag, **but** V3 binds the commit through a label A2 wrote. A run at H can label its image as an older signed commit X and pass V2+V3+V4. It then needs only a Release whose body names that digest. | **S1** (source digest), **S3** (box-side compose check), **S4** (edge) |
| **A2'** any repo writer: pushes a tag ref | `release.yml` publishes a Release automatically on any `v1.*` ref whose tag object verifies. Pushing ref `v1.99` at the old signed tag object `v1.0` makes our own workflow publish "v1.99" with the old attested digest. R2 takes it as the highest semver and V4 passes: a **downgrade** of prod to an old release, with no signing key. | nothing | **S2** |
| **A3** stolen `github_read_token` | Under D1(b): what anyone reads, under the owner's rate limit (it can deny the poll by draining the limit). Only root reads it on the box, so theft means A5, or the laptop at `set-secret`. | scope (D1), S8 | S6 (keep it out of git/docker) |
| **A4** registry/API serving other bytes | By-digest pull is content-addressed (V1). The attestation is public-good Sigstore + Rekor, so forging one needs GitHub's OIDC issuer. Freeze (withhold new runs/Releases): the box stays put. | V1, V2 | freeze detection is POLY-103's (advisory A3) |
| **A5** compromised container | Its mounts and networks. The deploy reads from containers only exit codes and R6's exact `{"ok":true}`. The state, `releases/`, Docker socket and `secrets/host/` are mounted nowhere **if** the rendered compose honours the policy. That is S3's job on the box, not CI's. | lint (CI) + S3 (box) | S3 |
| **A6** root / `polyops` (R-29) | Everything | nothing on the box | residual R-29 |

Which checks only restate another: once S1 is in, **V3 (label) stops no attacker**, because A2 writes the label. It guards
against a build bug and costs nothing, so keep it, named as a bug check. **V1-before-V2** is the same: pulling an
unverified blob runs nothing. The candidate digest comes only from `main` runs or Releases, so A1 cannot aim the box at
its blob, and A2's blobs verify anyway. The order buys nothing (advisory A1). The **SBOM attestation** has the same signer,
certificate and subject as provenance, so it adds no stop. I agree it stays out of the box check.

## Conditions

**S1. V2 binds the commit through the certificate.** V2's argv adds `--source-digest <expected commit>` (prod: the tag's
commit; staging: the run's `head_sha`) and `--predicate-type https://slsa.dev/provenance/v1`, for the app **and** each
sibling in V5. V3 stays, as a bug check. *Why:* SM1; A2 row. *Test (T1 extended):* the fake gh models a source commit per
digest and refuses when the `--source-digest` value differs. Fixture: an image whose label is the tag commit X and whose
attestation source is H. Red on a mutant without `--source-digest`: it passes V2 and V3 and deploys. The argv assertion is
exact (six flags plus subject). The real enforcement is SM1; POLY-104 re-shows it live with one wrong-commit run.

**S2. The tag's own name is bound.** V4 reads the tag object's `tag <name>` header (`git cat-file tag <ref>`) and refuses
`tag-name` unless it equals the ref name **and** the Release `tagName`. Semver ordering (R2, `not-newer`) uses that name.
*Test (T3 extended):* real git, a correctly signed `v1.0` tag object fetched as ref `v1.99`, Release `v1.99` naming the
digest attested for `v1.0`'s commit: refused `tag-name`, exit 1, quarantined, alert. Red on a mutant without the header
compare. `release.yml` adds the same compare as a fail-fast mirror (advisory A2; the box is the authority).

**S3. The box checks the rendered compose with the installed policy before any candidate container exists.** This happens
before R5 step 2 (the postgres `up`), before every `compose run`/`up` on a candidate, and before rollback's `up` of
`previous`.
- *Input:* the host's `docker compose … config --format json` for the exact R4 argv (`-p`, `--project-directory`, `-f`,
  `--env-file`).
- *Policy source:* the ops bundle installed by `install.sh` (`/opt/polycarpic/ops`), never `releases/`. It is a Python
  module in `lib/`, so no Node on the host and no candidate binary judging itself.
- *Refuses* (`compose-policy`, quarantine):
  - `privileged`, any `cap_add`, `devices`;
  - `pid`/`ipc`/`userns_mode: host`, any `network_mode`;
  - `security_opt` without `no-new-privileges:true`, or with `unconfined`;
  - `build`, `container_name`, a top-level `name` ≠ the `-p` value;
  - a bind source not in the installed allowlist for that project and service, or a writable one the allowlist marks `:ro`;
  - any bind of the Docker or containerd socket, `/`, `/run`, `/var/lib/polycarpic/state`, `secrets/host/`, or a
    `releases/` path other than the allowlisted read-only config files;
  - a secret file outside that project's prefix;
  - a network outside the project's allowlist (a staging service on `polycarpic-prod_default` or `polycarpic-prod-edge`);
  - a `ports` entry not on `POLY_BIND_ADDR`;
  - an `image` that is not exactly one of the four refs R4 just verified.

  The full lint stays CI's. This is the subset that decides host root, cross-project reach and the image set.
- *Why:* A2 row. SECURITY's R-4 rests on C-70 (non-root, read-only, no Docker socket), and today nothing on the box
  enforces it. The lint's own `image-digest` rule checks only the `@sha256:` shape, so a literal
  `ghcr.io/<anyone>/x@sha256:…` passes it.
- *Tests (T14, one per refusal family):* a candidate bundle with `privileged: true`, with a bind of `/`, with the Docker
  socket, with a staging service on `polycarpic-prod-edge`, with a literal foreign image, and with `name: polycarpic-prod`
  in `staging.yml`. Each is refused, and the docker log holds no `create`/`run`/`up` naming the candidate. Red on a mutant
  that reads the policy from the release bundle (the fixture bundle carries a permissive `policy.json`), and on a mutant
  without the check.
- *Cost:* about 120 lines and 6 cases in `test_deploy.py`, within R12's 20 s.
- *Consequence:* a release that loosens the policy is refused until the operator installs the new ops bundle. That is
  intended: staging has no human gate after merge.

**S4. Edge never comes from staging once prod exists.** After prod has a `current`, a staging run renders no `edge.yml`,
issues no argv naming the edge project or `caddy`, and S3 refuses a staging service on an edge network. The **first** prod
deploy recreates caddy from prod's bundle unconditionally, whatever is running, so no staging-era Caddy image or Caddyfile
survives into prod. *Test (T15):* prod `current` present; a staging candidate with a changed Caddyfile and caddy digest
deploys healthy, and the caddy container and its mounts are unchanged. A first prod deploy with an identical caddy digest
still recreates it. Red on a mutant that lets staging own edge after prod exists, and on a mutant that skips the
recreate when the digest is unchanged.

**S5. R11 also checks memberships.** `pg_shdepend` does not record role membership. Add to (b): poly_backup is a member of
exactly `{pg_read_all_data}` (roles.sql line 46), without ADMIN, INHERIT as granted, and no role is a member of
poly_backup. *Why:* `GRANT poly_owner TO poly_backup` or `GRANT pg_write_all_data TO poly_backup` turns the read-all
login into a writer, and the sweep as ruled passes both. *Test (T-pre extended):* both grants, and `GRANT poly_backup TO
poly_app`, each give exit 2 `backup-acl`, nothing applied. Red on the ruled sweep without the membership read.

**S6. The token reaches gh only.** `GH_TOKEN` goes into the environment of the `gh` child alone. Docker, compose and git
children get the fixed env without it. V4's fetch runs with `-c credential.helper=`, `GIT_TERMINAL_PROMPT=0` and a bare
URL, so no credential is ever sent to git. *Test (T12 extended):* the fake docker and real git record their env; the
fixture token string is absent from every child env except gh's, and from `tags.git` (config, `FETCH_HEAD`, packed refs).
No `/root/.docker/config.json` exists. Red on a mutant that exports `GH_TOKEN` into the deploy's whole env.

**S7. T7 also covers indirect execution.** No argv element resolves to a path under `releases/` except as the value of
`-f`, `--env-file` or `--project-directory`. *Red on* a mutant that runs `bash releases/<d>/infra/…`: T7 as ruled checks
`argv[0]` only, which that mutant passes.

**S8. `github_read_token` joins the host-only set: approved, exactly so.**
- *File:* `/etc/polycarpic/secrets/host/github_read_token`, `root:root` 0400.
- *Set:* the `HOST_ONLY` pin becomes exactly `{"heartbeat_url": "host", "github_read_token": "host"}`, in `lib/secrets.py`
  and in the shell mirror. The equality test, the no-overlap test and the `secrets/host/` lint rule stay.
- *Shape:* `set-secret` checks the fine-grained token form (prefix `github_pat_`, then 82 word characters) and refuses a
  classic `ghp_` token with exit 2. That enforces D1 in code.
- *Output:* `list-secrets` and `09_token.py` print the path, mode and expiry, never the value (swept).
- *Tests:* the pin test fails on a third name; `set-secret` refuses the classic form; the sweep finds the fixture token in
  no output or log.

  This review is the pinned-set review the issue requires.

**S9. `allowed-signers install` admits the plain form only.** Each line is exactly `<principal> namespaces="git"
ssh-ed25519 <base64>`. Any other option is refused (`cert-authority` above all, which admits every key a CA signs; also
`valid-before` with no `valid-after`, or an extra namespace), as is any key type other than ed25519. *Test:* a
`cert-authority` line and a second-namespace line, each exit 2, nothing written.

## Positions accepted as ruled

R1 (lock, units), R2's strict regexes and `GH_CONFIG_DIR`, R4 extraction (mode reset closes setuid; files and dirs
only), R5 order with the strict `premigration-set` line, R6, R7, R9 (the state stays under `state/`, which the lint
already refuses as a mount and S3 refuses on the box), R10's sibling binding through `images.env` **inside** the attested
app image (strong: the siblings cannot be swapped without a new app attestation), V6, Scope (SBOM out; `self-update`
unhomed: the deploy script still changes only by the operator's `install.sh`, which C-83's rule needs).

## Advisory (not gating)

- **A1** V2 before V1 costs a swap and gains nothing against A1–A6 (above).
- **A2** `release.yml` mirrors S2's tag-name compare, so A2' fails in CI before a Release exists.
- **A3** Freeze: `08_deploy.py` WARN when prod's digest ≠ the highest Release's after 1 h, or staging's commit lags
  `main`'s head by 2 days. POLY-103 owns the alert.
- **A4** Staging downgrade by re-run: GitHub re-runs keep the original `GITHUB_SHA` (INFRA §4.4's "re-running build.yml
  builds main's head" is wrong; devops corrects it). Whether a re-run of an old run becomes R2's `per_page=1` result is
  unmeasured. If it does, staging moves to an old, reviewed `main` commit; a schema in between stops it at
  `plan-diverged`. An ancestry check needs a `main` clone on the box; not worth it for staging today.
- **A5** `migrate --plan` runs in the candidate with the migrator credential **before** the premigration backup exists.
  A malicious candidate (A2, plus the tag on prod) can run DDL then; PITR (C-73) is the recovery, not the premigration
  set. Running `--plan` with a read-only credential would close it; that is a POLY-83 runner change, unmeasured.
- **A6** Rekor holds every attestation publicly: a periodic check that each Rekor entry for our signer identity matches a
  known `build.yml` run would detect A2 after the fact.

## For the Principal (via the lead)

**D1 — the box's GitHub token.**
- *Mechanism.* The server needs a token for two things: checking an image's signature record and downloading staging's
  "which image" file. Everything it reads is public, but GitHub refuses both without some login. Both are measured:
  the architect's M3–M4, and my 401.
- *Attacker's reach if the token is stolen.* Only root on the server reads it, and root already owns everything there.
  So the token's own reach is what GitHub grants it.
  - (a) As INFRA wrote it (this repository, read contents and packages): nothing extra today, but it would read private
    code if the repository were ever made private.
  - (b) A token limited to public repositories, read-only, with no permissions: nothing anyone else can't read. A thief
    could only use up your hourly request allowance, which pauses deploys until it resets.
- *Stronger option:* (b). *Cost:* none in code, but it is unmeasured that (b) can download the file and check the
  signature. That gets shown before the first deploy (POLY-104).
- *Recommendation:* (b). If (b) turns out unable to do either job, the decision comes back to you. It is never widened
  quietly, and never replaced by an older-style token that reaches every package your account can read (S8 refuses
  that form).

**D2 — who controls the shared front door (Caddy).**
- *Mechanism.* One Caddy decrypts all prod traffic, passwords and session cookies included.
- *Attacker's reach.*
  - (b) Caddy follows staging: anyone who can get code merged to `main` controls the program that reads prod traffic,
    skipping the signed-release step entirely.
  - (a) Caddy follows prod's signed release: that needs your signing key.
- *Stronger option:* (a). *Cost:* a Caddy change is not tried on staging before it reaches prod. A bad one fails the
  health check and rolls back with the release.
- *Recommendation:* (a), with S4, so nothing staging installed before the first prod release survives it.

## For the lead

- S3's consequence: a release that changes the compose policy needs `install.sh` on the box before it deploys. That is
  an operator step on every policy change, and the reason is that staging has no human gate after merge.
- SECURITY passages at the verdict (mine): C-83's check list and tested-by (S1–S4), the host-only row (S8), T-64 gets
  A2' (tag-ref downgrade) with S2, and R-4's controls name S3 as the box-side enforcement.

## Re-review: the ruling replaced whole @ `9b73741f`

Reviewed: `ruling.md` @ `9b73741f`. It supersedes `43af9303`; S1–S9 above are re-ruled here against it.

**Verdict: accepted with conditions.** S1, S2 (box side), S4 and S7 are closed. S5, S6, S8 and S9 carry, narrowed. S3 is
built as R5 but with gaps I measured (S10). S11–S13 are new. No position is refused. D1(b), D2(a), D3(a): agree.

### Measured here (Docker Compose v5.7.0, this Mac, `config --format json`, no container started)

| # | Input | Rendered output |
|---|---|---|
| SM3 | a service with `env_file: <host file>` | the file's keys appear in `environment`; **no `env_file` key and no path survive** |
| SM4 | top-level `configs: c: file: /etc/hosts`, used by the service | kept: `configs.c.file = /etc/hosts`, a host file mounted into the service |
| SM5 | `network_mode: "container:other"` | kept verbatim |

So a guard that reads only the render cannot see which host file fed a service's environment (SM3). R5's rules as written
pass a `configs` host-file mount (SM4) and a join of another container's network namespace (SM5). R5 only refuses
`network_mode` when it is set to `host`.

### Carried and closed

| Item | Status | Where |
|---|---|---|
| S1 source digest, predicate type, siblings same C | **closed** | R3 V1, V5; M6, M7; T1, T2 |
| S2 tag name = ref = Release | **closed** (box) | R2 Monotonic, T3. The `release.yml` mirror stays advisory A2 |
| S3 box-side guard from the installed policy | **built as R5**, gaps → S10 | R5, T8, §D3 |
| S4 edge | **closed** with D2(a), plus S11 | R9, T9 |
| S5 poly_backup memberships | **open**: R12 still has none | below |
| S6 token reaches gh only | **mostly closed** (R2, V4's `GIT_CONFIG_*`, T15); child-env test open | below |
| S7 indirect execution | **closed**: T7's canary script catches `bash releases/…` | T7 |
| S8 `HOST_ONLY` join | **approved**, with the shape check below | R11 |
| S9 signers plain form | rule in R11; **test missing** | below |

### Conditions on `9b73741f`

**S5 (carried). R12 (b) reads role membership.** `pg_shdepend` does not record it. poly_backup is a member of exactly
`{pg_read_all_data}` (roles.sql line 46), without ADMIN, and no role is a member of poly_backup. *T-pre adds:* `GRANT
poly_owner TO poly_backup`, `GRANT pg_write_all_data TO poly_backup` and `GRANT poly_backup TO poly_app`, each exit 2
`backup-acl`, nothing applied. Red on R12 as ruled. *Why:* either grant makes the read-all login a writer, and the sweep
passes both.

**S6 (narrowed).** T15 adds: the fixture token string is absent from the environment of every child except `gh` (fake
docker and real git record their env). Red on a mutant that exports `GH_TOKEN` into the deploy's own environment.

**S8 (narrowed).** `set-secret github_read_token` refuses any value that is not the fine-grained form (prefix
`github_pat_` and 82 word characters) with exit 2. That is what makes D1's "a classic PAT is refused" true in code; today
nothing refuses one. Test: the classic `ghp_` form is refused and nothing is written. The pin test fails on a third
`HOST_ONLY` name, and `list-secrets` and `09_token.py` print no value (swept). With that, the join is approved:
`/etc/polycarpic/secrets/host/github_read_token`, `root:root` 0400, `HOST_ONLY` exactly the two names.

**S9 (test).** `allowed-signers install`: a `cert-authority` line, an extra namespace and a non-ed25519 key are each
refused with exit 2, nothing written.

**S10. R5 is a per-service allowlist of keys and values, and covers env sources.** (SM3–SM5.)
- **Keys.** Each rendered service's key set is a subset of an installed per-service set. Any other key is refused
  `guard-key`. That closes, without naming them one by one:
  - `volumes_from` (another project's volumes);
  - `network_mode`, `pid`, `ipc`, `uts`, `cgroup` with **any** value: `container:<prod>` and `service:` join another
    namespace;
  - `cgroup_parent`, `runtime`, `sysctls`, `extra_hosts`, `group_add`, `links`, `external_links`, `storage_opt`.
- **Pinned values from the installed policy.** `user` equals the policy's uid:gid for that service. `read_only: true`
  where the policy says so. `cap_drop` includes `ALL`. `security_opt` exactly the policy's list. Absent `cap_add` is not
  enough, because Docker's default set (`DAC_OVERRIDE`, `NET_RAW`, …) applies without `cap_drop`. These are C-70's
  properties, which R-4 rests on.
- **Mounts.** Only `bind` and `tmpfs` volume types, as the CI lint already requires. A named volume can be a bind of `/`
  through `driver_opts`. Every top-level `configs` and `secrets` entry's `file` must be one the policy lists for a service
  that uses it (SM4).
- **Env sources.** The guard reads each bundle compose file's `env_file` entries **before** rendering. It uses a YAML parse,
  not a line regex, and the same parse replaces R5 step 1's regex for `include`/`extends`. Each path must be one the
  policy lists for that project's service; for example, staging may never name `/etc/polycarpic/host.env`. *Why the parse:*
  `{include: …}` in flow style, `"include":` and `? include` all defeat `^\s*include\s*:`. If PyYAML is not on the host,
  `docker compose config --no-interpolate --no-normalize` (measure: does it keep `env_file`?) or a fixed bundle rule
  "`env_file` only as a block-style list of literal paths" with a parse of exactly that form.
- **T8 adds:** `network_mode: "container:polycarpic-prod-web-1"`, `volumes_from`, a named volume with `driver_opts` bind
  `/`, a `configs` entry with `file: /etc/shadow`, a staging `env_file` of prod's `host.env`, `user: "0"`, a service
  without `cap_drop: [ALL]`, and `{include: [x.yml]}` in flow style. Each is refused and creates no container of the
  digest. Plus one positive case: the real bundle passes.
- *Cost:* the guard grows from a denylist-shaped list to a key and value table; about 40 more lines and 8 cases.

**S11. A staging-era Caddy leaves no key behind.** On a staging-only host (R9's exception), unreleased `main` code runs
Caddy. If the Caddyfile names the prod hostname, it obtains and holds the private key of prod's certificate, which stays
valid for up to 90 days after the first prod deploy recreates the container.
- *Required, either:*
  - (i) on a host with no prod, the edge serves the staging site block only, and the guard or the render refuses the
    prod hostname; or
  - (ii) prod's first deploy removes Caddy's data and config directories before the recreate, so prod gets fresh keys
    and a new ACME account.
- I prefer (i), since nothing secret is ever issued to staging-era code.
- *Test (T9 extended):* the chosen form, red on a mutant without it.

**S12. Until step 8, a prod run uses `current`'s images, not the candidate's, for anything holding data.**
- **Step 2.** When Postgres is down at a prod deploy (after a reboot or a crash), start it from **`current`'s** bundle and
  `images.env`, not the candidate's. The candidate's Postgres image would open the live data directory before the
  premigration backup exists, which is the window A-a closes for credentials. Only `first-deploy`, with no `current`, starts
  the candidate's.
- **Step 3.** `backup premigration` runs through `lib/compose.py` from `releases/prod-current`, so the backup and uploader
  containers are `current`'s tools image, never the candidate's. The ruling implies this through R-b; make it a stated rule.
- *Test (T12 extended):* every `compose` argv before step 5 names `current`'s directory and image refs.

**S13. Rollback passes the guard.** R8's `up` of `previous`, automatic and manual, runs R5 with the installed policy first.
A refusal is `rollback-unhealthy`-class: alert, change nothing. *Test:* a `previous` bundle the installed policy now
refuses; rollback creates nothing.

### Advisory on `9b73741f` (not gating)

- **A7.** V1 refusals are not Q, so a truly bad attestation re-alerts on every poll. POLY-103 should dedupe by digest.
- **A8.** `first-deploy` skips the premigration backup. If an operator runs it on a box whose state dir was lost while the
  database survived, real data migrates unbacked. `first-deploy` could refuse when the project's Postgres data directory
  is non-empty, unless `--no-data` is given.

### For the Principal, on the re-issue

D1 and D2 as above. **D3, the safety check's rules come only from the operator (recommend (a)):**
- *Mechanism.* The check that stops a new release from giving its containers power over the server takes its rules from
  what you installed, not from the release.
- *Attacker's reach under (b).* Under (b) the release supplies its own rules. Then anyone who gets a change merged to
  `main` can widen them, and staging runs every `main` change automatically on the same server as prod.
- *Cost of (a).* A release that legitimately needs a new mount or service is refused, loudly, until you run the install
  step.

### Read against `900d23f6` (the architect's in-place update, which landed while the re-review above was written)

| Condition | At `900d23f6` |
|---|---|
| S5 memberships | **closed**: R12 (c), T-pre |
| S6 child env, git credentials | **closed**: R2, T15 |
| S8 `HOST_ONLY` + `github_pat_` shape | **closed**: R11, T18. The join is approved as written there |
| S9 signers | **closed**: R11, T17 |
| S13 rollback through the guard | **closed**: R5 (V7 before rollback's `up`), R8 |
| S10 key and value allowlist, env sources | **partly met.** `priv` now refuses any `network_mode`. Still open: `pid`/`ipc` with `container:` or `service:` (the rule says `host` only); `uts`, `cgroup`, `cgroup_parent`, `volumes_from`, `sysctls` (no per-service key set); named volumes with `driver_opts` (no type rule); top-level `configs` `file` sources (SM4); `env_file` sources, which the render erases (SM3); pinned `user`, `read_only`, `cap_drop: [ALL]`; step (1) still a line regex. T8 needs S10's eight cases |
| S11 staging-era Caddy keys | **open**: `--force-recreate` replaces the container, not Caddy's data directory, so a key issued to staging-era code survives |
| S12 `current`'s images until step 8 | **open**: R6 step 2 still starts the **candidate's** Postgres, before step 3's backup |

**Gate:** the plan gate clears when S10, S11 and S12 are in the ruling with their tests. Each is a ruling edit, not a
re-measure.

### Delta `43af9303..900d23f6`: the lead's four named items

S1–S9 against `900d23f6` are in the table above: S1, S2, S4–S9 met, and S3 met as R5 with S10 open.

| Item | Ruling | Mechanism and reach |
|---|---|---|
| **R7 health by HTTP status alone** (`43af9303` also required the body `{"ok":true}`) | **Accept; not a weakening.** | `apps/web/src/ops/health.ts` returns 200 if and only if the body is `{"ok":true}`, and 503 with `{"ok":false}` otherwise. So for this handler the two clauses decide the same thing. The body clause would only have caught a handler edited to answer 200 with `{"ok":false}`, which is a bug, not an attacker. A malicious release prints either. Neither clause looks at the worker: its container check is `process.exit(0)` in both versions, and the HTTP probe goes to web. *A release that answers 200 while broken:* it becomes `current`, and the old release moves to `previous` and stays on disk. It is reached by `polycarpic-ops rollback`, not by the automatic path. It grants nothing: health is a liveness gate (R7 says so), and every security check ran before `up`. A broken worker is POLY-103's monitoring, as before. |
| **§D2 exception: staging owns edge on a staging-only host** | **S4 holds for the process, not for the key material. S11 closes the rest.** | The exception's predicate (no prod `current` in root state, and no `polycarpic-prod` container) cannot be faked by staging. The state is root's and mounted nowhere. The guard refuses `name` and `container_name`, and `-p` is the script's, so a staging bundle cannot create a `polycarpic-prod-*` container. When prod arrives, R9's `--force-recreate` replaces the Caddy image, the Caddyfile and the process. *What it does not stop:* Caddy's data directory survives a recreate. If staging-era Caddy served the prod hostname, the private key and certificate it obtained are reused by prod's Caddy from storage, and unreleased code had them for up to 90 days. So S11 is the answer to "what stops it": either the staging-era edge never serves the prod name, or the first prod deploy empties Caddy's data and config directories. Without one of them, D2(a) leaves that path open. |
| **Python allowlist guard in the installed ops bundle** (architect's choice) | **Accept; the right call.** | It matches my S3. The judge must not come from the candidate: the candidate's `node` binary is attacker A2, and the tools image has no Node. A Python module installed by `install.sh` is the only judge on the box that the release cannot supply. Its completeness is S10. |
| **Staging "current commit or later" by partial fetch** (R2; my A4 had left it out) | **Accept; stronger than my advisory, at near-zero cost.** | `git fetch --filter=tree:0 <url> C` brings C's commit objects without trees, and `merge-base --is-ancestor <current> C` reads parents only. Commits are hash-addressed: GitHub can withhold history and so fail the check, but it cannot forge C's ancestry. A commit is its own ancestor, so a weekly rebuild of the same commit passes. A re-run of an old run is refused. The fetch runs under S6 (no credential), into root's bare repository. Git parsing a pack from GitHub as root is the same surface V4 already has. T4's ancestry case runs on real git, which is what makes it count. |

Also new in the rewrite, already ruled above: V1 is not quarantined (A7); `first-deploy` skips the premigration backup
(A8). S12's step 2 was in `43af9303` too, and I missed it in the first review.

## Re-check @ `d6ee5088` (S10–S12 and what the edit touches)

| Condition | At `d6ee5088` |
|---|---|
| S10 key and value allowlist, env sources | **Met.** R5's `key`, `pinned`, `mount`, `file` and `env` rules over two renders. M8 shows the raw render keeps `env_file` paths and resolves a quoted `include`, so the line regex goes, which is better than my YAML-parse suggestion. `extends` is unmeasured and carried as a T8 case, which is enough. One gap remains in the `network` rule, unchanged by this edit: **S14**. |
| S11 no prod key for staging-era Caddy | **Met in mechanism**, (i) through DNS plus (ii) the wipe. The reasoning holds: no CA validates a name that does not resolve to the box, and Hetzner's Caddy holds no DNS token, so a wildcard or DNS-01 is out of reach. One ordering gap: **S15**. |
| S12 `current`'s images until step 5 | **Met.** R6 steps 2–3, the note, T12. |
| A8 `first-deploy` on existing data | **Adopted.** `existing-data` exit 4, and `--existing-data` makes the backup required. |

### Measured here (Compose v5.7.0, `-p polycarpic-staging`, no container started)

SM6: a staging file whose service joins `default`, with top-level `networks: default: {external: true, name:
polycarpic-prod_default}`. In the plain render, the service lists only the key `default`. The real name,
`polycarpic-prod_default`, appears only in the top-level `networks` entry.

**S14. The `network` rule judges the resolved network, not its key.**
- *Rule:* for each network a service joins, the guard looks up the top-level entry in the plain render and compares its
  `name`, `external` and `driver` to the project's installed list. Any other top-level network property (`driver_opts`,
  `ipam` other than the policy's) is refused `guard-network`.
- *Why it blocks:* with a key-only check, the SM6 file passes. A staging service then sits on prod's application network,
  inside 10.201.1.0/24, which prod's `pg_hba.conf` admits. It reaches prod's web and auth without Caddy, and prod
  Postgres's listener. It still needs a prod password for the database, but every unauthenticated internal port is open
  to it.
- *Test (T8 adds):* SM6's file is refused `guard-network`, and so is an `edge` alias naming `polycarpic-prod-edge`. Red on
  a guard that checks service network keys only.

**S15. The `app.` record is created only after prod's first deploy has wiped and recreated Caddy.**
- *Mechanism:* Caddy keeps retrying a failed issuance in the background. If a staging-era Caddyfile names `app.<domain>`,
  the staging-era Caddy that is running obtains the certificate in the minutes between the operator creating the record
  and prod's first deploy stopping it. In that window the key can leave the box, and the wipe revokes nothing.
- *R9's precondition alone does not close this.* It checks DNS when a staging run starts, not while Caddy runs.
- *Required:*
  - §L5 and the INFRA first-deploy runbook state the order: prod first deploy first (stop, wipe, recreate from prod's
    bundle), then the `app.` A/AAAA records.
  - `first-deploy prod` prints that instruction as its last line.
  - `first-deploy prod` refuses `edge-prod-name-early` (exit 4) if `app.<domain>` already resolves while caddy is still a
    staging-era container (no prod `current`). The operator removes the record, or passes `--caddy-never-staged` when no
    staging edge ever ran on the host.
- *Test (T9 adds):* `first-deploy prod` with `app.` resolving and a staging-era caddy is refused with that code, and
  nothing changes. Red on a mutant without the check.
- *Cost:* one resolve call and one flag.

**Advisory A9.** A CAA record for the domain pinning `accounturi` to prod's ACME account, set after the first prod
deploy, makes any later certificate from another account fail at the CA. Today Caddy's `/srv/polycarpic/caddy` is the
only account store.

**Gate: not open.** S14 and S15 are two small ruling edits, plus their T8 and T9 cases. Everything else is met.

## Re-check @ `569f8798` (S14, S15)

| Condition | At `569f8798` |
|---|---|
| S14 network judged by its resolved entry | **Met.** R5 `network` compares the top-level entry's `name`, `external` and `driver` to the installed list and refuses any other property. SM6's file is refused. T8 carries it. |
| S15 `app.` record only after the prod wipe | **Met.** R9 Order, `edge-prod-name-early` exit 4 changing nothing, the instruction printed last, T9, §L5. |
| No `--caddy-never-staged` flag (architect's deviation) | **Accept; better than my form.** The refusal fires only when a staging-era caddy container exists and prod has no `current`, which is computed from root's state and Docker. The case my flag covered, a host where no staging edge ever ran, has no caddy container and is not refused, so the flag could only have added a bypass. A caddy that existed and was removed cannot be issuing anything. Whatever it left in `/srv/polycarpic/caddy` is emptied by the first-deploy wipe (S11 ii). |
| A9 CAA `accounturi` | Advisory, as I filed it. |

**Gate: open.** S1–S15 are met at `569f8798`. D1(b), D2(a), D3(a): I recommend each, with the plain-language text above.

## R12(a) narrowing (backend-100's measurement): sweep `dbid IN (0, current)`, exempt exact-CONNECT `pg_database` rows

**Accept.** Each project's deploy catching its own database is enough, for the reasons below.

- **Where other databases exist.** Staging is a separate cluster, with its own `postgres` service and data directory, so
  "staging beside prod" holds only for the test cluster. On the box, prod's cluster holds `polycarpic` plus `postgres`,
  `template1` and `template0`.
- **What a grant in a sibling database reaches: nothing a poly_backup login can use.**
  - `pg_hba.prod.conf` admits poly_backup only to `polycarpic` and to `replication`, from the backup net. The next line
    is `host all poly_backup all reject`.
  - A grant or an owned object in `postgres` or `template1` is therefore unusable by a poly_backup session.
  - Replication is not widened by it either: REPLICATION already reads the whole cluster by design (C-79).
  - The dependency is pinned: `compose-policy.mjs` (lines 139–147) requires exactly those lines, and `reject` for every
    other database.
- **Who could plant such a grant.** Only the superuser (local peer) or a role connected to that database. pg_hba admits
  no service role to any database but `polycarpic`, so this is root or superuser drift. Neither the preflight nor any
  control on the box answers that (R-29).
- **What the narrowed sweep still sees.**
  - Every shared-object row (`dbid 0`): databases, tablespaces, roles. A TEMPORARY, CREATE or grant-option entry on
    **any** database is still refused, because only an entry that is exactly CONNECT without grant option is exempt.
  - Every row in the current database.
  - The explicit reads backend-100 measured as missing from `pg_shdepend`: the current database's `datacl`, settings,
    attributes, and memberships in both directions.
- **One residual, advisory (A10).** `template1` objects are copied into any database later created from it. The prod
  cluster creates `polycarpic` once at provision, and restores happen on the laptop, so nothing is created from it today.
  If a later loop creates databases on the box, its preflight sweeps `template1` too.
- **Wording I agree to:** "sweep `pg_shdepend` rows with `dbid` in (0, the current database's oid); exempt only a
  `pg_database` `a` row whose `datacl` entry for poly_backup is exactly CONNECT, not grantable; refuse every other row."
  T-pre keeps each case red in the current database, and adds one case: TEMPORARY granted to poly_backup on a
  **sibling** database is refused (a `dbid 0` row). Red on a mutant that exempts every `pg_database` row.

### R12(a) wording @ `580be11e` (`99b45aae..580be11e`)

**Accepted.** The wording matches what I agreed above: `dbid` 0 or the current database; `pg_database` rows exempt only
when `aclexplode` gives poly_backup exactly CONNECT without grant option, on every database; policy rows (`r`) refused.

- **The pg_hba claim, checked against the shipped files.**
  - `infra/postgres/pg_hba.prod.conf` opens with `host replication poly_backup 10.201.10.0/29`, then
    `host polycarpic poly_backup 10.201.10.0/29`, then `host all poly_backup all reject`.
  - pg_hba is first-match, so no later line can admit poly_backup to another database.
  - `pg_hba.staging.conf` admits poly_backup nowhere.
  - `compose-policy.mjs` lines 138–147 pin all of this in CI: the four C-79 lines first and in order, and no
    poly_backup or replication allow on staging.
  - The ruling says `pg_hba.conf`; the file is `pg_hba.prod.conf`. That is cosmetic.
- **If pg_hba is later widened** (a poly_backup line for another database, or `all` for it): the sibling database's
  grants become reachable, and this sweep would not see them.
  - Who can widen it: a reviewed `main` commit that also edits the CI rule, then a signed tag on prod; or attacker A2,
    who already holds the migrator credential and gains nothing from it.
  - The box guard (R5) checks compose files, not the contents of the pg_hba file.
  - So the protection is the CI rule plus review. Required edit, small: the `pg-hba-prod` rule's comment and message
    name R12(a). The rule then reads: "the four C-79 lines must come first, in order; R12(a)'s preflight sweeps only
    this database and relies on it."
  - A change that widens pg_hba must then widen R12(a) to sweep the newly admitted database. The two cannot drift
    apart silently.
- **Test, carried from above:** T-pre adds TEMPORARY granted to poly_backup on a **sibling** database. It must be
  refused through the shared `pg_database` row, and go red on a mutant that exempts every `pg_database` row. The diff
  does not add it yet.

### R12(a) edits @ `cc8f5ba6`

**Met.** The `pg-hba-prod` rule names R12(a), with devops building the lint edit. T-pre carries TEMPORARY on a sibling
database, refused through the shared `pg_database` row, red on a mutant exempting every `pg_database` row. The file name
is corrected. Nothing else in `ruling.md` changed (`580be11e..cc8f5ba6`). The plan gate stays open.

## Delta `5b774ae5..21891607`

**Accepted with S16 and S17.** Read against `deployer.py` @ `240fcbde` (edge, guard and pointer code only; no test run).

| Item | Ruling |
|---|---|
| S3, R8: rollback restores edge, both renders judged before either `up` | **Accept.** A refused edge render leaves the failed release's Caddy up, alerted; that Caddy passed the guard. |
| R4: edge `up` whenever owned | **Accept.** An equal image does not mean an equal `edge.yml`. |
| S8: `list-secrets` without path or expiry | **Accept**, narrower. A fine-grained token has a fixed length, so its size says nothing. |
| S11, S15: fail closed | **Accept**, with S16 and S17. The wipe's listing must be `ps -a` (as built), so a stopped Caddy counts. |
| R7: health of Caddy is `caddy version` | **Accept** as a stated residual: liveness, not a security check. |
| R10: token expiry, 90-day estimate | **Accept.** |
| T-render | **Accept.** It must fail, not skip, when the compose plugin is missing. |

**S16. Edge ownership is decided once per run.** `_gate` guards the edge render only if `edge_owner_peek` says this run
owns edge; `_apply` later calls `edge_owner`, which resolves the name and runs `compose ps` again. If the first answer is
"not ours" and the second is "ours", staging's edge is upped **with no guard**. Failing closed makes this easier to reach:
one `EAI_AGAIN` at the gate is now "resolves", and a clean answer minutes later owns edge.
- *Required:* one decision, made before V7, carried to step 8 and to rollback. Later checks may only take ownership away
  (the name now resolves: skip edge), never add it. `_edge_up` refuses a render this run has not judged.
- *Test (T9):* staging-only host, resolver answers "resolves" then "no such name": no argv names edge. Red on `240fcbde`'s
  shape. Reverse order: edge skipped, `edge-prod-name`.

**S17. An unreadable or malformed `current` means "prod exists".** `load_pointer` returns `None` both for no file and for a
bad one, so a damaged prod `current` with prod's containers down hands edge to staging, and `first-deploy prod` would take
the box for a new one and wipe Caddy. *Required:* absent is absent; present but unparsable stops the run (`state`, exit 1,
no quarantine), for both projects and for `first-deploy` and `rollback`. *Test:* a truncated prod `current` and no prod
containers: staging touches no edge; `first-deploy prod` wipes nothing. Red on a mutant treating malformed as absent.

**A11 (advisory).** `first-deploy prod` resolves `app.` at the start; Caddy is wiped after migrate, perhaps minutes later.
Resolve once more after Caddy is removed and before the recreate, and stop if the name appeared.

## `d0cd9969` (what lifts a quarantine)

**Accept, with S18.** The lapse follows an operator's root install and re-runs V1–V7, so it reaches nothing new. **S18:** a
`guard-` line lifts only when both ids are well-formed (`git-` or `sha256-` and 12 hex) and differ. A missing or unreadable
id, stored or installed, keeps the digest quarantined. A digest that also has any other reason stays. *T10q adds both.*

## D2: a correction to my text for the Principal

My D2 text above says a bad Caddy change "fails the health check and rolls back with the release". **That is wrong for a
Caddy that starts.** Health runs `caddy version` and asks web directly, not through Caddy. Nothing on the box reads the
Caddyfile: it is baked into the Caddy image, and the guard (V7) reads compose only.

*What stops a signed release whose Caddyfile is wrong but starts:* the CI lint and container tests on the PR, the lint
again at release, review, and the signature. After that, only a person noticing, and `rollback`. By reading, the lint has
holes: it pins `reverse_proxy` targets but not other directives that forward traffic (`forward_auth`), and it requires the
filtered log block without refusing a second one that writes elsewhere.

*Recommendation: still (a).* Under (b) or (c) the same file reaches prod with every one of those checks except the
signature. The two-line reason changes, not the choice. Two additions, each for the lead or the Principal:
- **A12.** The lint allowlists Caddyfile directives and global options instead of naming bad ones. Closes the holes above.
- **A13.** After a prod `up`, except the first, root asks `https://app.<domain>/api/v1/health` through Caddy (pinned to the
  bind address) and requires 200. Catches a Caddy that misroutes that path or has no certificate; it cannot see logging.

## D2 reopened: strict (staging never touches Caddy) against the exception

**Labels.** Ruling §D2: (a) exception, (b) strict, (c) staging always. My first D2 text to the Principal used "(b)" for what the
ruling calls (c), and never offered strict. My correction above says "under (b) or (c)" the file reaches prod unsigned;
that is true of (c) only, and of (a) before prod exists. It is **false of strict (b)**. Below, names only.

**My recommendation changes: strict.** I accepted the exception and then patched it four times. Reading the code showed
the patches failing open; the exception is the cause.

*What strict removes.*
- Code: the staging branch of edge ownership, the resolver seam and every DNS check, `edge-prod-name` and its early form,
  Caddy's wipe and forced first recreate, staging's edge rollback, the DNS-record order in the runbook.
- Tests: most of T9 (resolve, early name, wipe, the three fail-closed mutants), S16's two-answer case, T10's staging edge.
- Conditions: S11, S15 and A11 go. S16 shrinks to "`_edge_up` refuses a render this run has not judged".
- **Stays:** S4 as an absolute (no staging run names edge), S14, S3 on prod's edge and its rollback, and S17: a damaged
  `current` still defeats the version check and `first-deploy`.

*What the exception keeps even with S11–S17 met.*
- Unreleased code runs the process on 80/443, with internet access, joined to the prod edge network, until prod's first
  deploy. It holds the staging password file, which stays in use afterwards unless rotated.
- The DNS check is a glance, not a lock: it sees the box's resolver at poll time. If the `app.` record appears early,
  Caddy may get prod's certificate first. `edge-prod-name-early` then refuses, but the key may already be gone; only
  revoking the certificate helps, and nothing here does that.
- It checks one name. Any other name pointing at the box (the bare domain, say) can be certified by staging-era code.
- A destructive one-time path (the wipe) that no live run has exercised.

*What strict costs.* Nothing is served, staging included, until a signed `v1.*` release exists, so the signing key and
`RELEASE_SIGNERS` move ahead of the first staging deploy. Two shapes, for the architect:
- **Prod first:** `first-deploy prod` on an empty database, with no `app.` record. No new code, but prod's secrets must be in
  place first, and prod's first install is not rehearsed on staging.
- **Edge alone:** an operator command brings up only Caddy from a verified, signed release. Prod's secrets can wait; it
  is one more path to build and test.

  I prefer prod first if its secrets can be ready. POLY-104's order changes either way. Neither is measured.

*A wrong-but-running Caddy config in a signed release.* No option stops it on the server: CI, review and the signature
are the gate, then a person and `rollback`. Strict improves one thing: no Caddy ever runs without that gate. A12 and A13
are wanted under every option.

## `7ad32ae1` (S16, S17, A11, `first-attempt`)

S16, S17, A11, `ps -a` and T-render's fail-not-skip: **met** (R9, R10, T9). If the Principal chooses strict, R9's parts go.
`--existing-data`'s render: **accept**; it runs only the backup service, on the running Postgres image.

**`first-attempt`: accept with S19.** The file proves the directory was empty once, not that it is empty of data now. On a
rebuilt box: first attempt, `roles-missing`, the operator restores real data, then a rerun skips the backup and migrates
it. The restored copy still exists off the box, so this risks time and anything written since, not everything.

**S19.** A rerun skips step 3 only if the file exists, there is no `current`, **and** the project's database holds no table
outside the system schemas, read over the local socket just before step 5. A table, or a failed or unparsable read, makes
step 3 required. The file is ignored and removed whenever `current` exists. *T12:* rerun after `roles-missing` with an
empty database succeeds; with one table, step 3 runs; with the read failing, step 3 runs; a leftover file beside `current`
has no effect. Red on a mutant that trusts the file alone.

## `7ad32ae1..dafb93bc` (S18, A12, A13)

S18: **met.** A13 with its baseline: **accept**; a fault that was there before the deploy must not quarantine a good release,
and it alerts. S19 is not in this diff and stays open.

**A12: accept with S20.**
- *(a) Order.* Counted lines in any order still pass a Caddyfile that moves `respond @denied 403` below `basic_auth` or the
  proxies (the staging allowlist stops deciding first), or moves a line to another depth. Each block's lines must equal the
  fixed list **as an ordered sequence**, braces included.
- *(b) The other way in.* By Caddy's documentation `{$NAME}` is substituted before the Caddyfile is parsed, so a value can
  carry directives (not measured here). `edge.yml` sets those values and may set `command`. The lint therefore also pins
  caddy in `edge.yml`: no `command`, no `entrypoint`, and `environment` exactly the three `${NAME:?}` forms. `provision.sh`
  refuses an `edge.env` value with whitespace other than the single spaces `POLY_STAGING_ALLOW` needs, or with a brace.
- *T-caddy adds:* `@denied` moved below `basic_auth`; a literal `POLY_TLS` value with a newline; a `command` on caddy; an
  `edge.env` value with a newline and one with `}`. Red on a mutant comparing counts only.

## Draft: what a guard refusal tells the operator (architect-100, not yet in the ruling)

**Agree to the shape, with S21. Not as worded.** Sources, closed templates, no command for `current`, review before
install, the unsigned wording, and T-help: agree.

**S21.**
- *(a) No checkout of C.* `git switch --detach <C>` is itself a run of C: this repository sets `core.hooksPath` to the tracked
  `.githooks`, so a `post-checkout` in C runs on the laptop with the SSH key loaded (read from the git config; not run).
  The review covers `infra` and `packages/db/sql`, so it never shows that file, or `.claude/settings.json`, whose hooks run
  when a session next starts there. *Required:* `install.sh` gains `--commit <40 hex>`; the operator's already trusted
  `install.sh` ships `git archive <C>`, refuses a commit that is not an ancestor of `origin/main`, and needs no checkout.
- *(b) The diff shows what is shipped, unhidden.* `git diff --text --no-ext-diff --no-textconv <base> <C> -- infra packages/db/sql`
  plus `':(glob)**/.gitattributes'`: `git archive` reads attributes from C, and `export-ignore` can drop a file.
- *(c) Same commit.* Review and install name the same full C, never a branch. Prod's step 1 also runs `git verify-tag <tag>` on the
  laptop, so prod's signature is checked somewhere the box cannot lie.
- *(d) Not by email.* POLY-103 sends line 1 only. A command to run as root must not arrive in a message anyone can imitate.
- *Wording:* "Nothing of it ran" becomes "None of its containers was started".
- *T-help adds:* the text holds no `switch`, `checkout` or `pull`; `install.sh --commit` ships C while HEAD is elsewhere; a
  commit not on `origin/main` is refused, exit 2, before any ssh; a `post-checkout` hook planted in C leaves no canary.
- *Limit:* root on the box (A6) can print any text. The runbook says to compare the command with INFRA before running it.

## S19 @ `ad00423d`: met (R6, T12)

## D2 is strict: the shape before prod exists

**My preference changes to edge alone.** I preferred prod first without knowing that `v1.0.0` is the GA tag: prod first means
teaching prod to accept a pre-GA tag, putting prod's secrets on the box early, and running its first install unrehearsed.
Edge alone leaves prod's `v1.*` rule untouched. Conditions if it is chosen:

- **S22. Two namespaces that cannot cross.** `edge-deploy` accepts only `^edge-(0|[1-9][0-9]*)$`, prod only `v1.*`; each binds
  the tag object's own name (S2), verifies against the same `allowed_signers`, and runs V1–V7 with the tag's commit. `n` must
  rise. Only the edge render is upped from it: no app, database or backup container of that release starts.
- **S23. One owner after prod.** `edge-deploy` refuses once prod has a `current` (S17: damaged counts as present). Prod's first
  deploy takes edge over only if its commit equals or descends from edge's, so an older Caddy cannot return.
- **S24. The networks.** `provision.sh` creating them is right. `edge.yml` then declares both external too, S14's policy follows, and
  provision-check asserts each name and subnet, since prod's `pg_hba` relies on edge being outside its ranges.
- **S25. `release-scan`** also covers the newest `edge-*` release's Caddy until prod has a release; otherwise the only
  internet-facing image is never rescanned before GA.
- *Tests:* an `edge-1` tag offered to prod and a `v1.0.0` tag to `edge-deploy`, both refused; a lower `n`; `edge-deploy` with a prod
  `current`; a prod commit not descending from edge's; a staging run that names edge in any argv (red on the old branch).

**I disagree with the note's fallback.** If the Principal declines a new tag namespace, the fallback is not the exception:
they chose strict. It is prod first, or staging unserved until GA.

### What a second signed tag namespace adds for an attacker

- **Pushing the tag.** Any account that can write to the repository can push `edge-*`, as with `v1.*` today. A workflow on a tag
  runs the file **at the tagged commit**, so a writer can also edit `release.yml` there and publish any Release. The same is
  true now: `release.yml` is a fail-fast mirror and the box decides. Nothing new is reachable.
- **On the box.** Without a key in `allowed_signers` V4 refuses. The Release body can only name a digest attested at the signed
  commit (V1), so editing it chooses among builds of that commit.
- **Replay.** Name binding (S2) stops `edge-5` re-pointed as `v1.0.0` or `edge-9`. `n` must rise, so an old one cannot come back.
  `edge-deploy <tag>` is typed by the operator and has no timer: an attacker cannot make the box look.
- **What it truly adds:** one more thing the same key may sign. Signing `edge-n` must never be consent to run the app, hence S22.
  A stolen signing key reaches Caddy before GA; it already reached all of prod after.
- **Advisory A14.** A GitHub ruleset limiting who may create `edge-*` and `v1.*` tags. Whether one exists is unmeasured.

Prod first has no second namespace, but makes prod accept `v0.y.z` as well, which widens what prod itself will run.

**Caddy naming `app.` with no record.** No security cost under strict: only a signed Caddy ever holds that key, and with no
record there is none. It retries and fails. By documentation the CA limits failed validations per name and Caddy backs off,
so the certificate may lag the record at launch (unmeasured). That is launch timing, for POLY-104's or the GA runbook.

**Recommendation: edge alone,** with S22-S25.

## `ad00423d..d634da53` (D2 strict, S20, S21)

- **D2 strict: nothing of the exception is left** in the ruling (read the delta, then searched the whole file for its names,
  checks and refusals; the only hits are the lists of what was removed). S11, S15, A11 and S16's ownership half: withdrawn, agreed.
- **S20: met.** **Networks created by provision: accept**; that is S24's first half. The rest of S24, and S22, S23, S25, wait on §L6.
- **S21: met but for one line.** Prod's step 1 verifies the tag but not that it points at C. Add `test "$(git rev-parse
  '<tag>^{commit}')" = <C>`. Without it a box that lies could pair a good tag with another merged commit. T-help: the prod
  text holds the compare.
- **S26. The wrong network name, and it was mine.** I wrote `polycarpic-prod-edge` (from INFRA) in S3, S10 and S14, and the
  ruling's R5 and T8 carry it. The real name, in all three compose files and the policy, is `polycarpic-edge-prod`. A T8
  case on a network that does not exist proves nothing about the real one. *Required:* R5 and T8 use
  `polycarpic-edge-prod`; qa checks the committed fixtures and tests for the wrong name; devops corrects INFRA §2.2's row.

## `dac66f0a` (S24)

**Met,** with one test to add: T-net has no case for the rule that both subnets sit outside `pg_hba`'s allow ranges and the
10.200.0.0/16 pool. Add one overlapping each, provision-check fails, red on a mutant without that check. "Present and
different: stop, never replace" is right. Open: S21's tag compare, S26; S22, S23, S25 wait on §L6.

## `da6b5338` (S21, S26)

**Both met** in the ruling; the old name is gone from the file. **A15 (advisory):** a failing `test` or `merge-base` prints nothing, so a
person can read silence as success. End each step-1 chain with `&& echo REVIEW-OK` (prod's second line: `TAG-OK`) and say
step 2 needs it. Open: T-net's overlap cases; S22, S23, S25 (§L6). The fixed names in tests and INFRA are checked at build review.

## `b2d0642c`, `166e2438`, `2899fe83`

`b2d0642c` (T-net overlap) and `166e2438` (A15): **accept.** `2899fe83` (mail.env): **accept.** It narrows who gets `MAIL_FROM`.
The env_file rule becomes **S27**:

| Service | Prod, exactly this list, in this order | Staging |
|---|---|---|
| auth, worker | `/etc/polycarpic/host.env`, `/etc/polycarpic/mail.env` | `/etc/polycarpic/staging-host.env`, `/etc/polycarpic/staging-mail.env` |
| web, migrate, operator | `/etc/polycarpic/host.env` | `/etc/polycarpic/staging-host.env` |
| every other service, edge's caddy included | none | none |

- *Match:* whole-list equality, same length and order, each path the exact string. Refused: a subset, a superset, a swap, a
  duplicate, a prefix, `..`, a relative path, a variable, the other project's file, `required: false`, any key but `path` and `required`.
- *Why order:* Compose lets a later file override an earlier one (documentation). So each mail file also holds exactly one
  key, `MAIL_FROM`, and `host.env` does not hold it: provision-check asserts both, for both projects.
- *One list:* lint and guard both read `env_files` in `infra/deploy/compose-allow.json`, the lint from the tree and the guard from
  the installed copy. No second list in `policy.json` or in code. A pin test holds the table above literally, so the shared list
  cannot loosen without that test changing.
- *Tests, guard and lint alike:* `mail.env` on web; missing from worker; the two swapped on auth; prod's `mail.env` in staging and the
  reverse; a third file; `required: false`; `mail.env` with a second key (provision-check). Positives for both projects.
- *The lint today (read; its render keeps `env_file`, measured on Compose v5.7.0):* it accepts a service with **no** list, because it
  judges only a non-empty one; it compares a single entry; and it reads a normalized render, where a relative or `..` path may
  already be resolved. It must compare the whole list, empty included, and take the paths from the raw YAML, as the guard
  takes them from the raw render.

## `8e67c480`, `c66b6602`, `4d76516a` (S27; edge alone; tightening)

- **`8e67c480`:** S27 carried. **`c66b6602`:** S22, S23 and S25 **met**; S24 unchanged. The additions are accepted: `rollback edge`, Caddy going
  back to edge's `current` when the first prod deploy fails, the name compare for both namespaces, and help line 3.
- **`4d76516a`:** compared word by word. No test row changed and no rule was dropped. The Principal options became decisions
  and the met-by table lost only its descriptions. **One wording to fix:** R8's manual rollback now reads "R5 on `previous`", and edge's
  render is judged only by R9's sentence. Say "R5 on both renders before either `up`", as before and as step 2 says.

**S28, two gaps in `edge-deploy`.**
- *(a) Under the lock.* Steps 2 and 3 are read after `deploy.lock` is held, not before; otherwise a prod first deploy can finish while
  `edge-deploy` waits, and an older Caddy then replaces prod's.
- *(b) Lost state.* Step 2 reads only the `current` file. If the state directory is lost while prod runs, "no `current`" is true, the
  rising-`n` check has nothing to compare, and any signed edge release replaces the Caddy in front of live prod. Also refuse when
  `compose ps -a` lists any `polycarpic-prod` container; a failed or unparsable listing counts as listing one. The same for
  `rollback edge`. After a failed first prod deploy the way forward is `first-deploy prod` again.
- *T-edge adds:* prod gaining a `current` while `edge-deploy` waits; a prod container with no `current`; `ps` failing; a damaged edge
  `current` (`state`). Red on mutants reading before the lock, reading the file alone, and treating a failed `ps` as none.

**Plan gate:** opens when S28 and the R8 wording are in. Nothing else is open in the ruling.

## Draft: `staging-auth` (architect-100, not yet in the ruling)

**Agree, with S29.** Agreed as drafted: hidden prompt only, `htpasswd` on stdin, the one exact line, cost 10 with 16-72 bytes (the
allowlist is asked first, so only listed addresses can spend CPU or guess), no hash printed, refusal before V1. An
unaccepted `$2y$` fails closed: nobody signs in, or Caddy does not start.

**S29.**
- *(a) Every way Caddy reads the file.* Caddy reads it at any start, so the check also runs in `polycarpic-ops restart caddy`
  (refuse, Caddy untouched) and before rollback's and `rollback edge`'s caddy `up`, where a failure is `rollback-unhealthy`, nothing upped.
  A restart by Docker cannot be checked; provision-check is what sees that case.
- *(b) Bytes, whole file.* Read at most 128 bytes without following a link and match with `fullmatch`: Python's `$` also matches before a
  final newline. Owner `root`, group 10010 and the directory's group are compared with 10010 itself; `set_secret._plan` takes the group
  from whatever the directory has.
- *(c) `htpasswd` output.* Its trailing blank line is accepted exactly as printed and nothing else is stripped.
- *T-sauth adds:* `restart caddy` and both rollbacks with a bad file; a file with two trailing newlines, with `\r\n`, and a 129-byte
  file; a directory with another group. Red on mutants using `match` with `$`, and checking only in deploys.
- *SECURITY, mine at the verdict:* the row says "Staging secrets directory"; the file is in `secrets/caddy/`.

## `3c50fb1c`: S28 and R8's wording **met**

## `staging-auth`: where the hash is made (S30; replaces my acceptance of `apache2-utils` above)

I accepted the new package without weighing it. Comparing:

| Way | For | Against |
|---|---|---|
| `apache2-utils` on the box | the draft works as written | root-installed code on prod's host, kept patched for good, for a command run a few times; the password passes through the box |
| `caddy hash-password` from the verified image | no package; the consumer makes the hash | before `edge-deploy` the only verified Caddy on the box is staging's, unsigned: it would be handed the password and could print a hash of another one. Waiting for a signed image needs a new half-deployed state. Reading a password on stdin is unmeasured |
| **hash on the laptop** | no package; the box and every image on it never see the password | the box cannot check length; needs `htpasswd`, which macOS ships (measured: `/usr/sbin/htpasswd`) |

**S30. Required: hash on the laptop, and the box takes only the line.**
- The password is **generated**, not chosen: `openssl rand -hex 16`, into the operator's secret store, then `htpasswd -nBC 10 staging`
  at its own prompt (never `-b`). That replaces the length rules: 128 random bits, 32 ASCII characters, under bcrypt's 72.
- `staging-auth` keeps its hidden prompt (not a secret worth printing), takes `staging:$2y$10$<53>`, `fullmatch`, writes the file as drafted. Password
  prompts, `htpasswd`, the package and their tests go. S29 (a) and (b) stay; (c) goes.
- The box cannot see a weak password. The runbook's command is the control; the IP allowlist is the second.
- *T-sauth:* a pasted password, a hash of another cost, another user, an extra line: exit 2, nothing written, value not echoed. No package is added
  to `provision.sh`.

**Cost 10 on every request:** accept. With a random 128-bit password the cost guards nothing that matters, so it is chosen for CPU. The allowlist
answers first, so outsiders cost nothing (by the Caddyfile's order, which S20 pins). Load on the shared box is POLY-104's to measure.

## `ccb94ad3`, `6747ce07` (staging-auth): S29 (a, b) and S30 **met**

**Plan gate: open at `6747ce07`.** No condition of mine is open in the ruling. S11, S15 and A11 are withdrawn with strict. The build gates on
every condition's test.

## Draft: F1-F15 (architect-100, not yet in the ruling)

**F1, F3: agree as drafted.** On F3's reuse path the existing directory also passes F8's owner check. **F4: agree with S31;** rendering from the judged file is better than
my parse, because the second render no longer decides anything. **F2: agree with S32.** F5-F15: agree.

**S31 (on F4).**
- *(a) Render as nobody.* A local `include` may name a file a staging container can write (its Postgres data directory, say). The guard reads `env_file` from the
  raw render and values from the plain one, so a file that changes between the two shows clean paths to the first and gives a root-only file's content to the second,
  inside staging's environment. (b) does not help: that plain render **is** the judged one. So every `config` runs as uid and gid 65534 with no groups and no new
  privileges (`setpriv`, inside the `unshare`), where no secret file is readable and the Docker socket is not reachable. What it needs is already world-readable
  (release files, `images.env`, `edge.env`, the host and mail env files). Unmeasured that Compose renders so; the Linux test shows it.
- *(b) Only local files of this release.* Same run, a second line: a service's `environment` in the plain render holds no key outside the raw render's own plus
  those of its listed env files. Refusal `guard-env`.
- *(c) The zero written back* is `ulimits.core` alone, and only where the policy pins it at zero (F14). Any other empty object where a number belongs is `guard-render`.
- *Tests:* a root-only file as `env_file` through a local include fails the render; a canary in a 0400 root file never appears in a render; a file swapped between
  the two renders is refused; red on mutants rendering as root and without (b).
- *Consequence for INFRA:* the saved file bakes `host.env` and `mail.env` in, so an edit to them takes effect at the next deploy, not at a restart.

**S32 (on F2's `in-progress`).** A power cut must not ban a good release for good. The first interruption of a digest rolls back with no quarantine and is tried again;
a second for the same digest quarantines it (`interrupted`). The mark means the **candidate's** first `up`, not step 2's Postgres. It is removed once handled, so a first
deploy with nothing to roll back to alerts once, not every poll. *Tests:* each of the three; red on a mutant that quarantines at once.

A measure still owed before build: `unshare`, `setpriv` and an `up` from the saved file on Linux. The `up` needs the lead's go-ahead (a container run).

## `c52458c8..74714230` (section F; T13)

**Met:** F1-F15 as agreed, S31 and S32 folded in whole; the re-render on stdin and the 0755 HOME are right. R4, R-b, S7's exception, T7 and T14 follow. T13: no objection.

**S33, two small edits.** *(a)* R-b falls back to the ops bundle's compose file when no judged render exists. With a `current` present, a missing or unreadable render stops
the command (`state`); the fallback is for a box with no release only. *(b)* S32 needs the first interruption remembered: name the file, read it by F5's rule. *Tests:* each, red on
a mutant that falls back, and on one that forgets. **Advisory A17:** prune removes a pruned release's `render-*.json`.

**Still owed:** the three Linux measurements. If any fails, F4 comes back to a ruling before it is built. The mutants named in `build-review.md` are unchanged.
