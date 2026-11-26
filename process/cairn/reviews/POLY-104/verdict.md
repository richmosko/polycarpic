# POLY-104 architect's verdict: PR 1

Reviewer: architect-104, 2026-11-26, branch `feature/poly-104-first-staging-deploy` at `ae6df6b741`. Read: the issue and its comments, `staging-deploy.md`, `red-run.md`, `security-review.md`, `process/DECISIONS.md` (2026-11-26 — POLY-104), and the diffs under `infra/`. I ran no test and touched no box; every result below is read from those records or the code and is unmeasured by me. The core-dump control (F20) is judged from seceng's ruling only; its build is still to come.

**Verdict: APPROVE WITH CONDITIONS** (four conditions below).

## 1. The fixes against ARCH

| Fix | Judgment |
|---|---|
| F2, F10 `install.sh` | Right. The bundle is still built from a committed tree on the laptop and checked before any connection; nothing moves onto the box. |
| F3, F8 pipelines | Right, and fixed where the defect is. No lint, as qa argues: a text rule would need an allowlist as long as the list. |
| F4, F5, F6 edge flags and Caddy directories | Right split: `provision` lays out the host and `edge.env`, `edge-deploy` only checks them (F10 check). |
| F9 H25 | Right result. The check still builds its own HOME rather than using the deploy's render home (the render home may not exist before the first deploy), so it is a parallel construction; it now matches the real one by mode and owner. Advisory. |
| F11, S1, S4 gids | Right. The "+100 for staging" rule now lives in three places (`provision.sh`, `provision-check.sh`, `compose.py`). Tolerable because qa's tests take the expected gid from each compose file's `user:`; if that test is ever removed, the tables can drift again. |
| F15 `gh` | Right split and right trust design: the host stage installs exact bytes under two pins, H26 checks the hash, the deploy checks the version and refuses `gh` (exit 4, no quarantine) with the fix named. The deploy trusts the version string, not the hash; replacing `/usr/local/bin/gh` needs root, so this adds no reach. |
| F17 D1 | Right: the check was wrong, not the configuration. |
| F18 Caddy | Right, and the design-level fix: the binary loses the capability instead of `edge.yml` gaining one. The guard policy is unchanged. |
| F13 keyring placeholder, F12 | A runbook departure, not a design change. ARCH's "staging has its own keyring" holds only once `init-keyring` exists (before prod, seceng item 4). |
| F20 control (ruling) | Right place: host hardening in the host stage, evidence as a live `/proc` read in `provision-check`. The exact-match row also catches `systemd-coredump` or anything else that later rewrites `core_pattern`. Amend: the row's red must be shown on today's box value, and persistence is proven only by `provision-check` after a reboot (condition 3). Whether purging `apport` removes any other package on Ubuntu 24.04 is unmeasured; the build should print what `apt-get purge` removes. |

No fix patches a symptom where the design is wrong. Layering, the ops tool / provision split, the pull-based deploy and the guard policy are respected.

## 2. The pattern: stand-ins for our own outputs

Roughly eighteen defects reached the box because three tests stood in for things the product itself makes: CI's `deploy-real` builds its own secrets layout and fakes `gh`; no test started Caddy under `edge.yml`; the "staging" Postgres ran prod's conf. F17 and F18 are now closed by real tests. The structural rule:

- **A test may stand in for a third party (GitHub's API, a CA, Backblaze), never for a file or setting our own code produces.** Where the product makes a layout, the test gets it from the product.
- **`deploy-real` takes the secrets layout from `provision.sh`.** Of qa's options (A: cut functions out of the script by name; B: a new narrow stage), I would take a third: move the layout functions (`gid_of`, `ensure_dir`, `change`, `secrets_for`, the service lists) into a sourced `infra/provision-lib.sh` that `provision.sh` sources and the harness sources. It adds no root entry point (seceng's concern with B) and does not depend on the script's text (the weakness of A). seceng rules on it.
- **A real `gh attestation verify` in CI** against a real attested digest, with C-83's negative cases (seceng before-prod item 3, F16).
- **A stand-in register:** one table in `tests/infra/` listing each fake (`gh`, `curl`, `apt-cache`, `dpkg`, the harness tables, the image-test `docker run`s) with the real thing it replaces and the CI job or box step where the real one runs. A fake with no such row is a gap, named before the prod box, where the backup, uploader and B2 paths are still proven against fakes only.

Carrier: **POLY-165** (deploy follow-ups before prod), as one acceptance criterion covering all three, since POLY-164 is blocked by it. This is the lead's to place; I filed nothing.

## 3. ARCH edits (1.31.3)

- §7.5: the secret layout was wrong (it said `root:root`, files `0400`). Now: both roots, service directories `0750` and files `0440` with the service's compose gid, staging's own gid range, host-only secrets `0400` under `secrets/host/`.
- §7 hardening: no binary in our images carries a file capability; a needed privilege is designed out, never added back to compose.
- §7 provisioning: the host stage installs the pinned `gh`.

Not edited, and why: ARCH says nothing about IPv6, so "staging is IPv4-only" is INFRA's (it is there) and the prod choice is OQ-INFRA-13. "Edge ships only from `main`" already follows from §8.1 (signed tag, signer pinned to `refs/heads/main`).

## 4. Acceptance

| Criterion | PR 1 | PR 2 must show |
|---|---|---|
| Staging healthy; outside scan | Healthy: met (recorded). The scan waits. | `edge-2` healthy under `edge.yml` with its certificate written to the 0700 directories; nmap from outside with 22/80/443 on IPv4 and 22 only on IPv6 |
| `provision-check` passes (staging-only result) | Met with `git-51ea0e3b5566` | Met again with the F20 row, from a bundle that holds it, and after a reboot |
| OQ-INFRA-7, -8, -9 answered | 7 except the scan; 8 in progress; 9 deferred to prod | 7 closed by the scans; 8 answered with steps 14, 16, 17, 19 and §8 each marked run or deferred to a named issue; 9's carrier named |
| Every doc correction listed, INFRA lands them | Met for PR 1 (INFRA 1.3.41) | The corrections from the `edge-2` run |
| POLY-147 marker measurement on the VPS | Met: PASS (`marker-measure-vps.md`) | none |
| Step 18, first backup | Cannot run on staging (no backup service) | Deferred to POLY-105, said in the issue |

**The two-PR split is sound.** Signing a tag on a branch commit would break C-83's pin of the signer to `refs/heads/main`. `/merge-pr` merges with a merge commit, so the branch bundles installed on the box (`git-51ea0e3b5566` and earlier) become ancestors of `main` and stay valid for `install.sh --commit`.

## Conditions

1. **Before PR 1 merges:** the issue's first criterion reads as decided ("22, 80, 443 on IPv4; 22 only on IPv6"), since the decision exists (DECISIONS, F7) but the criterion text still says v4 and v6.
2. **Before PR 1 merges:** CI's own `deploy-real` job is green on the PR head. It is the one test of the changed fake `gh` (`--version`), and no one has run it (red-run "Not run").
3. **PR 2:** the F20 control is built with its row shown red on the box's apport value, installed, and `provision-check` is run after a reboot (the record's own "still to run"), exit 3 with the new row passing.
4. **PR 2 closes the issue only with:** the `edge-2` items in the record's "Waits for `edge-2`" list each measured or moved by name to an issue; OQ-INFRA-8's unrun steps placed; the stand-in rule (section 2) filed on POLY-165.
