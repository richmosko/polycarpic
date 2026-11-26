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
| 8 | the tools create the records | an older hand-made `_dmarc` (`v=DMARC1; p=reject`) stopped `dns-records.py` with `CONFLICT` and failed `dns-check.py` on 4 lines (`_dmarc` and 3 CAA); the record was edited by hand to the pinned value, then both passed | step 8 describes this case | measured |
| 10 | the signers file is "made from the key `/merge-pr` signs with" | a new release key was made (`~/.ssh/polycarpic_release_ed25519`, its own passphrase, never in the agent; public fingerprint `SHA256:CsGIu4YWiOz/jXNod6kxCQhEe3uHIJU+PwjZZsGhsrg`), `~/.config/polycarpic/allowed_signers` written from its public half, and the GitHub variable `RELEASE_SIGNERS` set to the same line. `allowed-signers install`: `1 key(s) installed` | the runbook has no step that makes the key, the file or the variable | measured |
| 12 | piping or pasting values | `set-secret` reads from a terminal only, so every value, placeholders included, is typed by the operator | as designed | measured |
| 12 | (no such step) | `staging-secrets/worker/credential_keyring` made by hand: a random placeholder, `root:10102 0440`, never read by staging | F13 | decision (lead) |

## Findings

| # | Step | Finding | Basis | State |
|---|---|---|---|---|
| F1 | 9 | Hetzner's console is a live screen with no scrollback, so the boot-log fingerprints are visible only if the console is open during first boot. The comparison cannot be made afterwards. The Principal could not get the console to work. A working method is needed before the prod box (candidates: open the console before `create.sh` returns; give the server its host key at creation). | measured | open, needed before prod |
| F2 | 11 | `install.sh`, run by path from another checkout, shipped the `HEAD` of the repository in the current directory, not of the checkout the script is in. From a subdirectory, `git archive` failed on its paths and the script still exited 0 (`sh` has no `pipefail`). | measured; the subdirectory case in the test harness | fixed: the script reads the repository it lives in, from any directory |
| F3 | 11 | `provision --stage host` exited 141. `apt-cache madison ... \| awk '... exit'` under `pipefail`: `awk` stopped at the first match and `apt-cache` died of SIGPIPE. The first run stopped after installing Docker; the second printed nothing, also through `polycarpic-ops`. The fake `apt-cache` listed three versions and had finished writing before `awk` exited; the test box now has `gawk` and the fake prints 50 lines, as the box does. | measured | fixed in `fb6dd1cb`; box suite green on `ff62d0d0`; passes on the box with `git-84dc7374d08f` |
| F4 | 11 | The usage line shows `--bind-addr`, `--staging-allow` and `--acme-email`; step 11 names none. `edge-deploy` needs them: it refuses `edge-env` unless `edge.env` holds all four keys. | code | the tool takes the flags (`ff62d0d0`); step 11 corrected (INFRA 1.3.33); run on the box: `edge.env` written, `root:root 0644`, four keys |
| F5 | 11 | `polycarpic-ops provision` accepts none of those three flags. | code | fixed in `ff62d0d0` |
| F6 | 13 | Nothing creates `/srv/polycarpic/caddy` or `caddy-config` for uid 10010. Docker would create them `root:root 0755`: Caddy could not write its ACME storage, while its health check (`caddy version`) still passes. | code | fixed in `ff62d0d0`; on the box both directories are `0700 10010:10010` (Caddy writing there: not yet seen) |
| F7 | 8, 15 | The web ports are published on the IPv4 bind address only and no compose network enables IPv6, so 80 and 443 are closed on IPv6. Lead's decision, 2026-11-25: staging is IPv4-only in this loop; the DNS tools run without `--ipv6`; the acceptance line becomes "22, 80, 443 on IPv4; 22 only on IPv6"; IPv6 service is a follow-up. The Cloud Firewall still admits 80 and 443 from `::/0`. | code; the IPv6 scan will measure it | follow-up |
| F8 | restore drill | `infra/drill.sh` check DR3 has the same early-exit pipeline shape: a match can end `plain_stream` with SIGPIPE, so DR3 can report PASS with a password in the globals file. | code | fixed in `ff62d0d0` |
| F9 | 11 | `provision-check` check H25 fails on a correct box. It makes the render user's `HOME` with `mktemp -d` as root (`0700 root:root`), so `docker`, as uid 10020, cannot read its config there and answers `unknown flag: --short` (exit 125). With the directory owned by 10020 the same command prints `5.7.1`. The fix text of H25 points at `/root/.docker/cli-plugins`, which is not the cause. The deploy's own render is not affected (code): its `HOME` is the render home, `root:root 0755` and empty. | measured | fixed in `410a3e47`: the directory is `root:root 0755`, as the render home is |
| F10 | 11 | `install.sh` is `sh`, so a failed `git show` or `git archive` was hidden behind `ssh`'s exit 0: the install could report success after sending nothing or part of the tree. Separately, in `en_US.UTF-8` on macOS an upper-case `--commit` could pass the hex check. | test harness | fixed: git's output is checked before any connection; the hex characters are listed |
| F11 | 12, 13 | `provision.sh` gives the staging secrets the prod groups (web 10001 and so on), while `staging.yml` runs those services as 10101, 10102, 10103, 10106 and 10107. A secret file is `0440` and keeps its host owner, so no staging app service can read its secrets. `provision-check.sh` uses the same table and passes it. The end-to-end test creates the staging secrets itself with the 101xx groups. A `check-config` failure also quarantines the release digest for good. | measured: the staging `auth` secrets on the box are `root:10007` | fixed: `provision`, `provision-check` and the ops tool use each project's compose gids, a host-stage rerun re-owns the files already there, and both ranges are reserved (INFRA 1.3.35). On the box: 11 files and directories re-owned to 101xx, then `no changes`; the staging services start |
| F12 | 12 | Step 12 says a missing secret is not a problem because the first start names it. Every file a service mounts must exist: `web` mounts `plaid_secret` and `worker` mounts `credential_keyring`, and `staging.yml` reads neither. `resend_api_key` must be a non-empty single line; it is not checked with the provider. A missing file would fail `check-config`, which quarantines the digest (Docker's behaviour for a missing secret source: not measured). | code | step 12 corrected (INFRA 1.3.34) |
| F13 | 12, 13, 14 | `polycarpic-ops init-keyring`, `keyring-fingerprint` and `restore-keyring` do not exist, and the app CLI has no `secrets init`. `set-secret credential_keyring` refuses and names `init-keyring`. No tool can create the file the worker mounts. | code | lead, 2026-11-25: no `init-keyring` in this loop; staging uses a hand-made random placeholder (a departure from the runbook); follow-up to be filed. Runbook lines marked "not built" (INFRA 1.3.34) |
| F14 | 8 | The public DNS answer holds 13 CAA records, not the 3 that were written: Cloudflare adds its own issuers, and an `issuewild`, while Universal SSL is on. `dns-check.py` reads the API, sees 3 and passes. So the narrowing of certificate issuers is not in force and the check cannot see it. Candidate fix: turn Universal SSL off in Cloudflare (the records are DNS only), and have `dns-check.py` compare the public answer. | measured (public `dig`) | open |
| F15 | 13 | `first-deploy staging` ended `deploy: transient: gh api failed`: `gh` was not installed. Nothing installed or checked it, and the tool hid the cause and called a missing program transient. | measured | fixed (INFRA 1.3.37): the host stage installs the pinned release tarball (form ruled by seceng), check H26, refusal `gh`, and a failed call prints its exit code and a fixed label. On the box: installed, hash equal to the pin, `PASS H26` |
| F16 | 13 | The end-to-end deploy test in CI replaces `gh` entirely, so no CI job runs a real `gh attestation verify`. Its first real run was on this box, and it passed. | code, then measured | open (test gap) |
| F17 | 13 | After the first deploy `provision-check` fails: `FAIL D1 postgres settings: staging: archive_mode is off (want on); archive_timeout is 0 (want 300)`. The check is wrong, not the configuration: staging is not backed up, `postgresql.staging.conf` sets `archive_mode = off`, the compose lint fails CI on anything else, and staging has no spool or backup service. D1 asks prod's list of both projects. The check's own test started its "staging" Postgres with the prod file. | measured; cause from code | fixed (INFRA 1.3.39): D1 wants each project's own settings. No change to the box's configuration. To be rerun on the box |
| F18 | 13 | `edge-deploy edge-1` ended `rollback-unhealthy` and quarantined the digest in the edge's state: the Caddy container exited 255, its log repeating `exec /usr/bin/caddy: operation not permitted`. The released binary carried `cap_net_bind_service+ep` (read from the released image's layer; the builder image sets `XCADDY_SETCAP=1`), and `edge.yml` drops every capability. No test had started the Caddy image under those settings: the end-to-end test deploys staging only, and the image tests used a plain `docker run`. Staging was not touched. | measured | fixed in the build (form ruled by seceng: `XCADDY_SETCAP=0`; `edge.yml` and the guard policy unchanged; INFRA 1.3.40). It reaches the box only from `main`, with a new signed `edge-2`; the `edge-1` quarantine line stays as the record. Not yet run on the box |

`gh` 2.106.0, the pin: the tarball's sha256 equals the release's `checksums.txt` and a download hashed locally; `gh attestation verify <tarball> --repo cli/cli` with the local `gh` 2.105.0 exited 0 (source `cli/cli` at `refs/heads/trunk`, signer `.github/workflows/deployment.yml`). Both on 2026-11-25. `bin/gh`'s sha256 was computed from that tarball. The end-to-end deploy test in CI uses a stand-in `gh`: the first real `attestation verify` runs on the box.

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
- `docker network ls` as `polyops` without `sudo` is refused (`polyops` is not in the `docker` group): expected.
- As uid 10020 with the deploy's render home as `HOME` (not yet created), `docker compose version --short` prints `5.7.1`, exit 0: the deploy's render is not affected by F9.
- DNS: `staging` and `app` `A` are `167.235.205.75`, no `AAAA`; `_dmarc` is `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r`; `dns-check.py --ipv4` ends `DNS CHECK PASSED` (but see F14). A login as `root` is refused.
- `git-258f6c846ea0`: `provision-check` 20 `PASS`, H25 passes, only `FAIL H19`. With the three edge flags through `polycarpic-ops`: `change: wrote /etc/polycarpic/edge.env`, `host stage: 1 changes`; then 21 `PASS`, `HOST CHECKS PASSED; 9 checks wait`, exit 3.
- `set-secret github_read_token`: `written: .../secrets/host/github_read_token (94 bytes, 0400 root:0)`.
- Before the F11 rerun no passwd or group entry on the box lay in 10101 to 10110. With `git-7d6d38c7ac56` the host stage made 11 changes, all `owner of …staging-secrets…`; `list-secrets --staging` then showed every set row `root:101xx` (Postgres 999). With `git-4f7424b510ee`: `host stage: no changes`; `provision-check` exit 3, no `FAIL`, 8 checks waiting.
- All 11 staging secrets set; the staging basic-auth file `root:10010`.
- First `first-deploy staging` (2026-11-26 01:16Z): `deploy: transient: gh api failed`, exit 1 (F15). `git` 2.43.0, `curl` and `tar` are on the box from the Ubuntu image; provisioning does not install `git`.
- With `git-94e122126c5c`: `change: gh 2.106.0 installed`, 1 change; `/usr/local/bin/gh` has the pinned sha256; `PASS H26`.
- Run 2: exit 4, `deploy: refused roles-missing`; the candidate (`sha256:0eba28cc…44d5`, `main` at `4b186404`) was verified in 43 s, the first real `gh attestation verify` of this design. `provision --stage database --project staging`: exit 0, database created, `roles.sql` applied, 5 login passwords set.
- Run 3: exit 0. Verified (22 s), migrated, up at 02:28:53Z, healthy at 02:29:55Z (62 s). `status`: `STATUS GREEN`, token expires in 89 days, slots and revokes OK, 9 waiting (prod, edge, certificate). `web`, `auth`, `worker` and `postgres` healthy; `polycarpic-deploy@staging.timer` enabled.
- `provision-check` after the deploy: exit 1, one failure (F17).

## Open questions

| Id | Answer |
|---|---|
| OQ-INFRA-7 | Plan `cx33`; 3 firewall rules covering both families. IPv6: see F7. Outside scan not yet run. |
| OQ-INFRA-8 | In progress: §7.1 run through the first staging deploy; the differences are above. |
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
| Open questions | OQ-INFRA-12 (host key), OQ-INFRA-13 (web on IPv6), OQ-INFRA-14 (public CAA) | F1, F7, F14 |
| §7.1 step 10 (1.3.38) | how to make the release-signing key, the signers file and `RELEASE_SIGNERS` (written from what was done; these exact lines were not run as written) | box result |
| §7.1 step 8 (1.3.38) | `dns-check.py` does not see the public CAA answer | F14 |
| §3.2, §4.4, §5, §7.1 (1.3.34 to 1.3.37) | mounted secrets before the first deploy and staging placeholders; keyring commands marked not built; staging gids and the link refusal; the pinned `gh` | F11, F12, F13, F15 |

## Wording to fix

- `set-secret github_read_token` ends "root reads it on the next backup or upload run". That is wrong for this token, which the deploy poll reads.
