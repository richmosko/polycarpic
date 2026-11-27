# POLY-167 build fix: measurements (2026-11-27)

## Cause

`build` run 46047894114 (commit `61c5d206`), job `siblings`, step "Trivy scan of tools": 4 HIGH, CVE-2025-6020, `libpam0g`, `libpam-modules`, `libpam-modules-bin`, `libpam-runtime` at `1.5.2-6+deb12u2`, fixed in `deb12u3`.

## Base digest

| | Index digest | amd64 image created |
|---|---|---|
| Old pin | `sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc` | 2026-11-04 |
| New pin | `sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e` | 2026-11-23 |

The new digest is what `docker buildx imagetools inspect debian:bookworm-slim` returns, and the Docker Hub API (`hub.docker.com/v2/repositories/library/debian/tags/bookworm-slim`, `digest`) returns the same one.

**The current official image does not carry the fix.** Built on the new digest with no upgrade step, the scan shows the same 4 HIGH (`deb12u2`). `deb12u3` is in `bookworm-security`, newer than the image's archive snapshot (20261123). So the bump alone is not a fix: the shipped stage of `infra/backup/tools.Dockerfile` now also runs `apt-get -y --no-install-recommends upgrade`, from the base image's own signed sources, as the app and Postgres images do. The `fetch` stage ships nothing but the checksum-verified `rclone` binary and has no upgrade step.

## Tools used

- Trivy 0.76.2, the version `infra/ci/install-trivy.sh` pins. macOS-ARM64 release tarball; `shasum -a 256` matched its line in the release's `checksums.txt`, and that file holds the Linux SHA-256 pinned in the script.
- Scans: `bash infra/ci/image.sh scan <ref>`, the command `build.yml` runs (CI's ref is the pushed digest; here a local tag).
- **Difference from CI:** every local build and scan is **arm64**; CI is **amd64**. This Docker install cannot run amd64 images (`exec format error`). The amd64 `bookworm-security` package index lists all four packages at `1.5.2-6+deb12u3`. **The amd64 result is first seen in CI**: the pull request's `image` job (below), then `build.yml` on `main`.

## Scan results

| Image | `libpam` seen (all four packages) | Result |
|---|---|---|
| tools, old pin, no upgrade | `1.5.2-6+deb12u2` | exit 1: the 4 HIGH above |
| tools, new pin, no upgrade | `1.5.2-6+deb12u2` | exit 1: the same 4 HIGH |
| tools, new pin with upgrade | `1.5.2-6+deb12u3` | exit 0: 0 findings, `rclone` v1.76.0 with 0 |

The last row was repeated on the final file, built with the command `ci.yml` runs (`docker build --no-cache --pull -f infra/backup/tools.Dockerfile -t polycarpic-tools:ci infra/backup`).

| Other image | Result |
|---|---|
| postgres (`infra/postgres`) | exit 0 |
| caddy (`infra/caddy`) | exit 0 |
| app (`bash infra/ci/image.sh build`) | exit 0 |

All builds except the app used `--no-cache --pull`; `image.sh build` does so itself.

## Other `build.yml` steps

| Step | Result |
|---|---|
| `image.sh check polycarpic:ci` | exit 0 |
| `release-lint`: `images-env.sh` with placeholder digests, then `compose-policy.mjs` | clean |
| `image.sh sbom polycarpic:ci` | exit 0 |
| `release-scan` (weekly schedule only): newest Release is `edge-2`, so Caddy only, digest `sha256:ec17c90d925ebad50edd674e1883ceb605de9a447578b8e2553e734a57e80bd3` from that Release's `images.env` | exit 0 |
| Registry push, provenance and SBOM attestations, digest upload | not run locally |

## Tests

No committed test holds the old digest.

| Suite | Result |
|---|---|
| `tests/ci` | 27 files, 890 passed |
| `tests/infra` (`vitest.config.ts`) | 26 files passed, 1 skipped; 703 tests passed, 3 skipped |
| `tests/config` (includes `tests/image` and `tests/log`) | 100 passed, 15 skipped |
| `tests/infra` backup containers (`vitest.backup.config.ts`), on the image with the upgrade | 7 files, 112 passed |
| `actionlint` | not installed here; the `lint` job runs it |

Not run locally: the `tests/infra/image` container suite (Postgres and Caddy files, unchanged).

## R3: apt rules for every Dockerfile `build.yml` builds

`tests/infra/shipped-apt.test.ts`; the list is derived in `tests/infra/shipped-images.ts`. It is in `tests/infra` because the `lint` job runs that suite for a change under `infra/` or to `build.yml`; `tests/image` runs only on the `node` key, which neither sets. `aptViolations` moved to `tests/infra/apt-rules.ts`, which both tests import. The ruled installs are listed per Dockerfile: `age=<version>` (Postgres), `ca-certificates curl` (tools; the unshipped fetch stage also `unzip`).

Red output, `committed tree is clean` (the upgrade line was written before the test, so case (a) was shown by removing it again, then restoring it):

```
(a) infra/backup/tools.Dockerfile without the upgrade
    "infra/backup/tools.Dockerfile: the final stage does not run apt-get update && apt-get upgrade",

(b) build.yml with one added build step (context: tests/db/docker), reverted afterwards
    "tests/db/docker/Dockerfile: apt install (only update and upgrade are ruled)",
    "tests/db/docker/Dockerfile: the final stage does not run apt-get update && apt-get upgrade",
```

Both cases also stay in the file as fixture mutations.

## R4 and R4b: the pull request scans what `main` scans

`ci.yml`'s `image` job now builds `polycarpic-tools:ci` (no push) and runs `bash infra/ci/image.sh scan` on it, both on the `image` key, which `infra/backup/**` sets. `tests/ci/image-scan-parity.test.ts` compares the two workflows over the same derived list. Red before the `ci.yml` change (12 of 13 failed), the committed-tree case with:

```
    "infra/backup/tools.Dockerfile (context infra/backup): the image job does not build it",
```

Green after it. The fixture `build.yml` with one extra image yields exactly `infra/extra/Dockerfile (context infra/extra): the image job does not build it`.
