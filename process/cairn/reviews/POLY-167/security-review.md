# POLY-167 security review (seceng-167)

Reviewed: `735d32ef` (fix `4d99f5a1` + INFRA 1.3.48); SECURITY 1.21.6 at `0615466b`. amd64 proof: PR 162 CI run 46052776029 on `9d37b5b4` (= `633f5a5a` plus PDFs only), image job 140688032910.

## Why no update arrived for the stale pin (criterion 4)

- Nothing watched `infra/backup/tools.Dockerfile`: `renovate.json` `includePaths` holds only the Postgres and Caddy Dockerfiles.
- Renovate runs as no app (SECURITY, C-80): `renovate-check.yml` is a read-only `--platform=local --dry-run=lookup` with no
  token, so it never opens a PR. Its only run (2026-11-23, run 45217220103) was red on a report "problem entry", and nobody acted.
  It has never been green.
- The weekly no-cache rebuild re-pulls an immutable digest; it refreshes an image only through an in-place `apt-get upgrade`,
  which the app and Postgres images ran and the tools image did not. `apt-get install` left the base's linux-pam as pinned.
- The A1 static test read only the root `Dockerfile`, so the tools image was outside it.
- The current `bookworm-slim` digest (`e67eeead…`) still carries libpam `deb12u2`; the fix (`deb12u3`) is in
  bookworm-security only (build-fix.md). The upgrade step is the fix, not the digest bump.

## What keeps a pin fresh from here

| Pin | Refreshed by |
|---|---|
| node (app), postgres, debian (tools) | weekly rebuild via final-stage `apt-get upgrade`, enforced for every Dockerfile `build.yml` builds (`tests/infra/shipped-apt.test.ts`) |
| caddy builder and runtime (Alpine) | Renovate lookup only; the one named exception in that test |
| renovate image, Actions SHAs, Trivy binary, compose/gh | not watched (Actions stated in SECURITY) |
| `ubuntu:24.04` in `tests/infra/**` | not watched; never shipped or scanned — accepted |

Pull-request CI now scans every image `build.yml` scans (`tests/ci/image-scan-parity.test.ts`), so a red tools scan is seen
before merge.

Follow-up, gating prod: POLY-165 carries "Renovate check never green" (diagnose the problem entry, upload the report, show
one green and one due run, then decide coverage of the tools, Node and renovate digests). Until then Caddy has no working
refresh alarm.

## CVE-2025-6020 exposure

A `pam_namespace` path traversal, local privilege escalation in a PAM session. The tools image runs `rclone`/`curl` as uid
10005 (`uploader`, prod only) with `read_only`, `cap_drop: [ALL]` and `no-new-privileges`; nothing in it opens a PAM
session. Not reachable in practice; the gate refused it correctly and was not waived.

## Review of the fix

| Check | Result | Evidence |
|---|---|---|
| R1 digest is the registry's current one | pass | `e67eeead…` = Docker Hub `bookworm-slim` digest, re-read at review |
| R2 final-stage upgrade under A1 | pass | `tools.Dockerfile` runtime stage; fetch stage exempt as ruled |
| R3 apt rules on every shipped Dockerfile | pass | derived from `build.yml` (4 files); red fixtures (a), (b) and six more |
| R4 PR builds and scans tools | pass | `ci.yml` image job, same `image.sh scan`, `--no-cache --pull`; image key covers `infra/backup/**` |
| R4b parity test | pass | extra-image fixture yields the exact message |
| Nothing waived | pass | no `.trivyignore`, no direct `trivy` call, no `continue-on-error` |
| Red old pin / red new digest alone / green with upgrade | pass (arm64) | build-fix.md |
| amd64 green on the PR | pass | run 46052776029, job 140688032910: base resolved at `e67eeead…`; upgrade took the four libpam packages `deb12u2` → `deb12u3` from bookworm-security; scan `polycarpic-tools:ci (debian 12.15)` 0, `rclone` 0 |

Not blocking: shipped-apt's mutation cases assert "some violation" rather than the message; the clean baseline makes any
violation the mutation's.

What the amd64 claim rests on: the job log, not the runner label alone. The job ran on GitHub's hosted `ubuntu-26.04` runner
image; its Compose install fetched `docker-compose-linux-x86_64`; and the tools build's apt step fetched and unpacked
`libpam0g:amd64` and `libpam-modules:amd64` from `bookworm-security/main amd64`. No step names a `--platform`.

Verdict: pass.
