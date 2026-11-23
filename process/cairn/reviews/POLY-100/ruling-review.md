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
