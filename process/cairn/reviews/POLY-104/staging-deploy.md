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
| F3 | 11 | `provision --stage host` exited 141. `apt-cache madison ... \| awk '... exit'` under `pipefail`: `awk` stopped at the first match and `apt-cache` died of SIGPIPE. The first run stopped after installing Docker; the second printed nothing, also through `polycarpic-ops`. The fake `apt-cache` listed three versions and had finished writing before `awk` exited; the test box now has `gawk` and the fake prints 50 lines, as the box does. | measured | fixed in `fb6dd1cb`; box suite green on `ff62d0d0`; box install to be recorded |
| F4 | 11 | The usage line shows `--bind-addr`, `--staging-allow` and `--acme-email`; step 11 names none. `edge-deploy` needs them: it refuses `edge-env` unless `edge.env` holds all four keys. | code | the tool takes the flags (`ff62d0d0`); step 11 text to be corrected |
| F5 | 11 | `polycarpic-ops provision` accepts none of those three flags. | code | fixed in `ff62d0d0` |
| F6 | 13 | Nothing creates `/srv/polycarpic/caddy` or `caddy-config` for uid 10010. Docker would create them `root:root 0755`: Caddy could not write its ACME storage, while its health check (`caddy version`) still passes. | code | fixed in `ff62d0d0`; not yet seen on the box |
| F7 | 8, 15 | The web ports are published on the IPv4 bind address only and no compose network enables IPv6, so 80 and 443 are closed on IPv6. Lead's decision, 2026-11-25: staging is IPv4-only in this loop; the DNS tools run without `--ipv6`; the acceptance line becomes "22, 80, 443 on IPv4; 22 only on IPv6"; IPv6 service is a follow-up. The Cloud Firewall still admits 80 and 443 from `::/0`. | code; the IPv6 scan will measure it | follow-up |
| F8 | restore drill | `infra/drill.sh` check DR3 has the same early-exit pipeline shape: a match can end `plain_stream` with SIGPIPE, so DR3 can report PASS with a password in the globals file. | code | fixed in `ff62d0d0` |

## Open questions

| Id | Answer |
|---|---|
| OQ-INFRA-7 | Plan `cx33`; 3 firewall rules covering both families. IPv6: see F7. Outside scan not yet run. |
| OQ-INFRA-8 | Not yet recorded. |
| OQ-INFRA-9 | Not yet recorded. |

## Doc corrections (INFRA)

Not yet landed.
