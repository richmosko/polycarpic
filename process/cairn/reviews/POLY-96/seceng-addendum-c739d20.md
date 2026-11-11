---
kind: finding
target: POLY-96 ruling addendum (architect-96), S96-18/19/20, C-82
---

# seceng on c739d20 (apt-get upgrade, npm tree removed) and the weekly full rebuild

**Concur** with keeping the upgrade, with the weekly run becoming a full rebuild (push → scan → SBOM → attest, no cache), with release keeping "newest successful build.yml run on main for the commit" with the digest frozen at the tag, and with the no-package-manager rule. A patched image is worth more than one that rebuilds byte-for-byte from the commit. The attestation still binds the build to build.yml on main at that commit (T-92 holds). The SBOM is taken from the pushed digest, so it records the packages the upgrade actually installed. The scan gate is unchanged.

Extra conditions, gate-4 checkable:

- **A1 (apt trust; C-80/C-82, new).** The Dockerfile adds no apt source and no key, and uses none of `--allow-unauthenticated`, `--allow-insecure-repositories`, `--allow-downgrades`, `[trusted=yes]`, `Acquire::AllowInsecureRepositories` or `APT::Get::AllowUnauthenticated`. apt then verifies the signed Release files of the base image's own Debian sources, so a plain-HTTP mirror is acceptable. Check: grep the Dockerfile and `infra/**` Dockerfiles. Upgrade only. `dist-upgrade`/`full-upgrade` and new package installs need their own ruling.
- **A2 (no moving tag before attestation; S96-16/S96-18, new).** Weekly rebuilds now give one commit several digests, and a run that fails Trivy still pushes. So the push tag is unique per run (for example `sha-<commit>-<run_id>`). No shared tag (`sha-<commit>`, `main`, `latest`) is created or moved until that run's attest step has passed. Release (S96-21.3) and the staging poll (POLY-100) choose a digest from the newest *successful* build.yml run's `digest.txt` and verify its attestation; they never resolve a tag. A failed weekly build therefore leaves staging and prod on the last attested digest. It never leaves a tag pointing at an unattested image. Put the POLY-100 half on POLY-100.
- **A3 (prod keeps being scanned; C-82, new).** A rebuilt main digest is not what prod runs, because prod's digest is frozen at the tag. So the weekly run also runs Trivy, scan only (no rebuild, no attest), on the digest of the newest published `v1.*` Release, when one exists. A red result is an alert under INFRA §5's response windows, not a deploy. No-op in M1 (no tag).
- **A4 (runtime image contents; C-80, standing rule).** Asserted on the built image, not on the Dockerfile text: none of `npm`, `npx`, `corepack`, `pnpm`, `yarn` resolves on `PATH`, `/usr/local/lib/node_modules` is absent, and the image's `User` is non-root (`node`). apt/dpkg stay in the slim base. They are acceptable only because the process is not root, so the non-root assertion is part of this rule. The check runs in the PR `image` job and in build.yml before the scan.
- **A5 (same digest everywhere).** Unchanged from S96-16: the scanned digest, the SBOM subject, the provenance subject and `digest.txt` are the one build-step output in the same run. With several runs per commit, a gate-4 check compares all four within a run, never across runs.

SECURITY: I fold A1–A4 into v1.9 (C-80, C-82, C-83 "Who builds") once your addendum lands, citing it.
