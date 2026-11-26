# POLY-104: first staging deploy

The lead ran INFRA §7.1 on a real Hetzner project with the Principal, staging only (fake data), from 2026-11-25. This file records the box, every command that differed from §7.1, every defect and every doc correction. "Measured" means seen on the real box; "code" means read from the code and not yet seen on a box.

## Box

| | |
|---|---|
| Server | `polycarpic`, `cx33` (4 vCPU / 8 GB / 80 GB), `fsn1` (in stock on 2026-11-25) |
| OS | Ubuntu 24.04.5, kernel 6.8.0-151 |
| Addresses | IPv4 `167.235.205.75`; IPv6 `2a01:4f8:c013:55cc::1` |
| Volume | 20 GB (`sdb`) |
| Cloud Firewall | one firewall, 3 inbound rules (22, 80, 443), each from `0.0.0.0/0` and `::/0`, applied to 1 server |
| First operator tool installed | `git-ff196cddaf28` |

## Commands that differed from §7.1

| §7.1 step | The runbook says | What was run | Why | Basis |
|---|---|---|---|---|
| 7 | `create.sh ... --location fsn1 --type <type>` | `--type cx33`, `fsn1` | The runbook leaves the plan to the operator | measured |
| 8 | `dns-records.py` and `dns-check.py` with `--ipv4` and `--ipv6`; `dig ... AAAA` | both without `--ipv6`: no AAAA record | F7 | decision (lead) |
| 9 | compare the host fingerprint with the console boot log | accepted as first seen, staging box only (Principal, 2026-11-25) | F1 | measured |
| 11 | `infra/ops/install.sh` "from your verified checkout" | the script run by path from another checkout shipped the current directory's `HEAD` | F2 | measured |

## Findings

| # | Step | Finding | Basis | State |
|---|---|---|---|---|
| F1 | 9 | Hetzner's console is a live screen with no scrollback, so the boot-log fingerprints are visible only if the console is open during first boot. The comparison cannot be made afterwards. The Principal could not get the console to work. A working method is needed before the prod box (candidates: open the console before `create.sh` returns; give the server its host key at creation). | measured | open, needed before prod |
| F2 | 11 | `install.sh`, run by path from another checkout, shipped the `HEAD` of the repository in the current directory, not of the checkout the script is in. From a subdirectory, `git archive` failed on its paths and the script still exited 0 (`sh` has no `pipefail`). | measured; the subdirectory case in the test harness | fixed: the script reads the repository it lives in, from any directory |
| F3 | 11 | `provision --stage host` exited 141. `apt-cache madison ... \| awk '... exit'` under `pipefail`: `awk` stopped at the first match and `apt-cache` died of SIGPIPE. The first run stopped after installing Docker; the second printed nothing, also through `polycarpic-ops`. The fake `apt-cache` listed three versions and had finished writing before `awk` exited; the test box now has `gawk` and the fake prints 50 lines, as the box does. | measured | fixed in `fb6dd1cb`; box suite green on `ff62d0d0`; passes on the box with `git-84dc7374d08f` |
| F4 | 11 | The usage line shows `--bind-addr`, `--staging-allow` and `--acme-email`; step 11 names none. `edge-deploy` needs them: it refuses `edge-env` unless `edge.env` holds all four keys. | code | the tool takes the flags (`ff62d0d0`); step 11 text to be corrected |
| F5 | 11 | `polycarpic-ops provision` accepts none of those three flags. | code | fixed in `ff62d0d0` |
| F6 | 13 | Nothing creates `/srv/polycarpic/caddy` or `caddy-config` for uid 10010. Docker would create them `root:root 0755`: Caddy could not write its ACME storage, while its health check (`caddy version`) still passes. | code | fixed in `ff62d0d0`; not yet seen on the box |
| F7 | 8, 15 | The web ports are published on the IPv4 bind address only and no compose network enables IPv6, so 80 and 443 are closed on IPv6. Lead's decision, 2026-11-25: staging is IPv4-only in this loop; the DNS tools run without `--ipv6`; the acceptance line becomes "22, 80, 443 on IPv4; 22 only on IPv6"; IPv6 service is a follow-up. The Cloud Firewall still admits 80 and 443 from `::/0`. | code; the IPv6 scan will measure it | follow-up |
| F8 | restore drill | `infra/drill.sh` check DR3 has the same early-exit pipeline shape: a match can end `plain_stream` with SIGPIPE, so DR3 can report PASS with a password in the globals file. | code | fixed in `ff62d0d0` |
| F9 | 11 | `provision-check` check H25 fails on a correct box. It makes the render user's `HOME` with `mktemp -d` as root (`0700 root:root`), so `docker`, as uid 10020, cannot read its config there and answers `unknown flag: --short` (exit 125). With the directory owned by 10020 the same command prints `5.7.1`. The fix text of H25 points at `/root/.docker/cli-plugins`, which is not the cause. The deploy's own render is not affected (code): its `HOME` is the render home, `root:root 0755` and empty. | measured | fixed in `410a3e47`: the directory is `root:root 0755`, as the render home is |
| F10 | 11 | `install.sh` is `sh`, so a failed `git show` or `git archive` was hidden behind `ssh`'s exit 0: the install could report success after sending nothing or part of the tree. Separately, in `en_US.UTF-8` on macOS an upper-case `--commit` could pass the hex check. | test harness | fixed: git's output is checked before any connection; the hex characters are listed |
| F11 | 12, 13 | `provision.sh` gives the staging secrets the prod groups (web 10001 and so on), while `staging.yml` runs those services as 10101, 10102, 10103, 10106 and 10107. A secret file is `0440` and keeps its host owner, so no staging app service can read its secrets. `provision-check.sh` uses the same table and passes it. The end-to-end test creates the staging secrets itself with the 101xx groups. A `check-config` failure also quarantines the release digest for good. | measured: the staging `auth` secrets on the box are `root:10007` | fixed: `provision`, `provision-check` and the ops tool use each project's compose gids, a host-stage rerun re-owns the files already there, and both ranges are reserved (INFRA 1.3.35). To be rerun on the box |
| F12 | 12 | Step 12 says a missing secret is not a problem because the first start names it. Every file a service mounts must exist: `web` mounts `plaid_secret` and `worker` mounts `credential_keyring`, and `staging.yml` reads neither. `resend_api_key` must be a non-empty single line; it is not checked with the provider. A missing file would fail `check-config`, which quarantines the digest (Docker's behaviour for a missing secret source: not measured). | code | step 12 corrected (INFRA 1.3.34) |
| F13 | 12, 13, 14 | `polycarpic-ops init-keyring`, `keyring-fingerprint` and `restore-keyring` do not exist, and the app CLI has no `secrets init`. `set-secret credential_keyring` refuses and names `init-keyring`. No tool can create the file the worker mounts. | code | lead, 2026-11-25: no `init-keyring` in this loop; staging uses a hand-made random placeholder (a departure from the runbook); follow-up to be filed. Runbook lines marked "not built" (INFRA 1.3.34) |

## Security review of the F11 fix (seceng)

Verdict at `936f833b`: safe to install on the staging box.

| # | Level | Finding | State |
|---|---|---|---|
| S1 | Low | A link at a secrets root or service directory was followed: its target, with the files in it, was re-owned. A staging link to prod's `web` directory would have handed prod's secrets to the staging group. qa found the same for a linked generated secret file. Only root can create such a link. | fixed: a link at any of these, and at the host-only secret, stops the stage and is left as found |
| S2 | Info | A hard link inside a staging service directory to a prod file would be re-owned. Only root can create one. | recorded; not changed (read from code; whether H6 flags it is not measured) |
| S3 | Info | `set-secret` checks a directory's owner and mode, not its group, and writes with the group it finds. A host-stage rerun now repairs the file and H6 flags it. | recorded; not changed |
| S4 | Info | `gid_of` gave the prod groups for a staging root written with a trailing slash. No caller passed one. | fixed in both scripts |

## Box results

With operator tool `git-84dc7374d08f`:

- `provision --stage host` (no edge flags): `host stage: 76 changes`, exit 0; run again, `host stage: no changes`. Compose on the box is 5.7.1. This closes F3 on the box.
- `provision-check`, first run: 19 `PASS`; `WAIT` H18, H22, H12, D1 to D6; `INFO H12b`; `WARN H13`; `FAIL H19` (no `edge.env`, expected until the edge flags are given); `FAIL H25` (F9); ends `2 CHECKS FAILED`, exit 1.

## Open questions

| Id | Answer |
|---|---|
| OQ-INFRA-7 | Plan `cx33`; 3 firewall rules covering both families. IPv6: see F7. Outside scan not yet run. |
| OQ-INFRA-8 | Not yet recorded. |
| OQ-INFRA-9 | Not yet recorded. |

## Doc corrections (INFRA)

Landed in INFRA 1.3.33 (the run is still in progress; steps not yet run are unchanged except where the code settles them).

| Where | Correction | From |
|---|---|---|
| §2.1 Machine and DNS rows; D-2 | the web ports answer on IPv4 only; `A` records and no `AAAA` | F7 |
| §2.3 volumes | `caddy` and `caddy-config`: owner, mode, who makes them, why before Caddy starts | F6 |
| §7.1 step 8; the later `dns-check.py` lines | `dns-records.py` and `dns-check.py` without `--ipv6`; the `AAAA` lookup shows nothing | F7 |
| §7.1 step 9 | the console has no scrollback; what to do with an unverified host key | F1 |
| §7.1 step 11 | the three edge flags, `edge.env` and H19 | F4, F5 |
| §7.1 step 11 | `install.sh` ships the checkout the script is in; the line a signal-ended stage prints | F2, F3 |
| §7.1 step 11 | H18 and H22 wait on a new box | box result |
| §7.1 step 13 | a staging run never starts Caddy (code: a staging run neither renders nor starts the edge project) | code |
| §7.1 step 15 | 22, 80 and 443 on IPv4, 22 only on IPv6; the IPv6 scan takes the server's address | F7 |
| §8 command table, `provision` | `--b2-endpoint` and the three edge flags | F5 |
| Open questions | OQ-INFRA-12 (host key), OQ-INFRA-13 (web on IPv6) | F1, F7 |

## Wording to fix

- `set-secret github_read_token` ends "root reads it on the next backup or upload run". That is wrong for this token, which the deploy poll reads.
