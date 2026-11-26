# POLY-104 architect's verdict: PR 1

Reviewer: architect-104, 2026-11-26, branch `feature/poly-104-first-staging-deploy` at `ae6df6b741`, confirmed at `7bd2f147` for the F20 build and its box run. Read: the issue and its comments, `staging-deploy.md`, `red-run.md`, `security-review.md`, `process/DECISIONS.md` (2026-11-26 — POLY-104), and the diffs under `infra/`. I ran no test and touched no box; every result below is read from those records or the code and is unmeasured by me. The core-dump control (F20) is judged from its diff at `5c980a03`; its box run is read from the record.

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
| F20 control (`5c980a03`) | Built as ruled: `no_core_dumps` in the host stage purges `apport` first, writes `50-polycarpic-core.conf` and dies unless the live values read back; H27 reads the live values and the package status. The exact match also catches `systemd-coredump` or anything else that later rewrites `core_pattern`. Read from the diff; qa's gate and seceng's pass at `51d0c51f` are theirs. Advisory: `apt-get purge` output goes to `/dev/null`, so what else it removed is not recorded (unmeasured); H27 catches apport's return either way. |

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
| `provision-check` passes (staging-only result) | Met with `git-51ea0e3b5566`; with H27 and after a reboot with `git-064e7429baa2` (condition 3) | none beyond the `edge-2` waits |
| OQ-INFRA-7, -8, -9 answered | 7 except the scan; 8 in progress; 9 deferred to prod | 7 closed by the scans; 8 answered with steps 14, 16, 17, 19 and §8 each marked run or deferred to a named issue; 9's carrier named |
| Every doc correction listed, INFRA lands them | Met for PR 1 (INFRA 1.3.41) | The corrections from the `edge-2` run |
| POLY-147 marker measurement on the VPS | Met: PASS (`marker-measure-vps.md`) | none |
| Step 18, first backup | Cannot run on staging (no backup service) | Deferred to POLY-105, said in the issue |

**The two-PR split is sound.** Signing a tag on a branch commit would break C-83's pin of the signer to `refs/heads/main`. `/merge-pr` merges with a merge commit, so the branch bundles installed on the box (`git-51ea0e3b5566` and earlier) become ancestors of `main` and stay valid for `install.sh --commit`.

## Conditions

1. **Met** (`d03aa3ec`): the issue's first criterion reads "22/80/443 on IPv4, and 22 only on IPv6".
2. **Met:** CI green on `e3d32c98`, `deploy-real` among it (the lead's comment in `POLY-104.md`); PR 1 merged at `47fb1fbc`.
3. **Met in PR 1**, recorded at `7bd2f147` (`staging-deploy.md`, "The core-dump control and the reboot"): H27 FAIL on the box's apport value, host stage, PASS H27, reboot, `provision-check` exit 3 with H27 passing.
4. **PR 2 closes the issue only with** (status below, under PR 2): the `edge-2` items in the record's "Waits for `edge-2`" list each measured or moved by name to an issue; OQ-INFRA-8's unrun steps placed; the stand-in rule (section 2) filed on POLY-165.

## PR 2: condition 4

Read at `d936ab4e`: `staging-deploy.md` ("`edge-2` on the box", F21 to F25), `security-review.md` (PR 2), devops-104's follow-up list. Nothing here was run by me.

**C4 is not yet met.** All but one of the `edge-2` items are measured. Two things are still to be filed, and the scan below is still owed.

| Part of C4 | State | Still needed |
|---|---|---|
| Caddy up, certificates into the 0700 dirs, 80/443 on the bind address, allowlist and basic auth, real client address, Caddy-to-`auth` probe, pages, static file, headers, password SSH refused, the Ctrl-C line | Measured (E1, M1 to M8, M10, O1, O2) | none |
| IPv4 full scan | Measured, TCP (M11) | none |
| IPv6 full scan | **Pending** | Measured and recorded showing 22 only. It is acceptance criterion 1, so it cannot be moved to another issue. Record the Cloud Firewall's rules read as TCP only next to it, since UDP was not scanned (seceng item 6) |
| M12 (the address `auth` records), 9d (renamed secret), E6 (planted DNS record), M9 (log filter: `caddy-edge.test.ts` is the evidence, F24) | Not measured | Each named on POLY-165 |
| Stand-in rule and register (section 2) | Not yet on POLY-165 at `d936ab4e` | Filed there |
| OQ-INFRA-8's unrun steps | Not placed | As below |

**Where OQ-INFRA-8's unrun steps go.** OQ-INFRA-8 asks for every command in INFRA §7 and §8 to be run once on a real machine. A staging box cannot answer all of it, so it should not close with POLY-104. POLY-104 answers §7.1 steps 1 to 13 and 15 for staging. INFRA's "when" cell for OQ-INFRA-8 should then name the issues that carry the rest:
- §7.1 step 14 (prod keyring and first deploy) and steps 16 and 17 (bootstrap user, sign-up, second step) on prod: POLY-164. Step 16's invite ran on staging (box measurement 7).
- Step 18 (first backup): POLY-105, with OQ-INFRA-11 reworded so that it does not expect a backup on staging.
- Step 19 (first restore drill): POLY-116.
- The home box section: POLY-120. The Vercel and Neon section: POLY-121.
- §8: the commands that can run on staging and gate prod go on POLY-165 as one criterion: each run once on staging or marked prod-only. They are `rollback`, the renamed secret (9d), `docker compose run`'s timeout and `rm -f`, and `lockdown` once F22 builds it. The prod-only commands go on POLY-164.

The INFRA edit is devops-engineer's to make.

**F25b and ARCH.** seceng accepts that every new `main` build recreates Postgres, because the rebuild is how Debian security fixes reach the image. ARCH §7's deploy-interruption text named only `web`, so ARCH 1.31.4 now says that the deploy also recreates `postgres` and that the app services restart while it starts. F21, F23 and F24 change nothing in ARCH.

**Verdict for PR 2: APPROVE WITH CONDITIONS.** It closes the issue once these are done:
1. The IPv6 full scan shows 22 only, and the firewall rules are recorded as TCP only.
2. The stand-in rule and register, M12, 9d, E6 and the §8 criterion are on POLY-165.
3. INFRA's OQ-INFRA-8 cell names POLY-164, 105, 116, 120 and 121 as above.
