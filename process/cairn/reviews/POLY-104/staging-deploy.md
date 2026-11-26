# POLY-104: first staging deploy

The lead ran INFRA §7.1 on a real Hetzner project with the Principal, staging only (fake data), from 2026-11-25. This file records the box, every command that differed from §7.1, every defect and every doc correction. "Measured" means seen on the real box; "code" means read from the code and not yet seen on a box. Times with `Z` are UTC.

## State at close

POLY-104 landed in two pull requests (lead's decision under the Principal's delegation; a departure from one issue, one PR, forced by the edge shipping from `main` only): **PR 1** (merged at `47fb1fbc`), the fixes and the record up to the reboot; then the Principal signed `edge-2` on that commit and the lead deployed it and ran the outside checks; **PR 2**, the record from `edge-2` on, which closes the issue.

On the box, as last recorded (after `edge-2`): staging and the shared Caddy (`edge-2`) are deployed and healthy, with certificates from a real CA for `staging` and `app`; `status` GREEN with 6 items waiting (all prod); `provision-check` exits 3 without a `FAIL`, the staging-only result. Prod is not deployed.

| Acceptance criterion | State |
|---|---|
| Staging reaches healthy; the outside scan | **Met.** Healthy, and the full outside TCP scans show 22, 80 and 443 on IPv4 and 22 alone on IPv6 (the line as reworded for F7) |
| `provision-check` passes (the staging-only result) | **Met**: exit 3 without a `FAIL`, also after the reboot and after `edge-2` |
| OQ-INFRA-7, -8 and -9 each have a recorded answer | **Part-deferred, unticked**: 7 answered; 8 answered for the staging steps only, and open, with its carriers as INFRA names them (POLY-164, POLY-105, POLY-116, POLY-120, POLY-121, POLY-165); 9 not measured, deferred to prod (POLY-164) |
| This file lists every doc correction, and INFRA lands them | **Met**: listed below; INFRA 1.3.47. The issue's text says "INFRA v1.2"; the document is past that version |

**Follow-ups:** where a finding below is open or marked "follow-up", it is carried on **POLY-165** (deploy follow-ups before prod), which says which of them gate prod.

**From the lead, outside the run notes:** after the server was created (step 7) the Principal deleted the Hetzner API token and the lead deleted the `hcloud` context from the laptop (C-78, 2026-11-25). The age recipient (step 10) was written from `~/polycarpic-backup.key.public` before the host stage. Steps 1 to 6 ran before step 7; the run notes hold no entry for them, so no difference from the runbook is recorded for them, and none is ruled out.

**Not run:** the planted DNS record (E6), the renamed secret as a container sees it (box measurements, 9d) and a staging user with the address `auth` records for it (M12). The rows marked "Not run" or "Prod" in the inherited-measurements table are the rest; the measurements not taken are listed on POLY-165.

**Step 18 (first backup), named in the issue, cannot run on a staging-only box:** staging has no backup or upload service and is not backed up (F17). It waits for prod: POLY-105 carries it, with OQ-INFRA-11 (the backup set on the first instance that has a backup).

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
| F6 | 13 | Nothing creates `/srv/polycarpic/caddy` or `caddy-config` for uid 10010. Docker would create them `root:root 0755`: Caddy could not write its ACME storage, while its health check (`caddy version`) still passes. | code | fixed in `ff62d0d0`; on the box both directories are `0700 10010:10010`, and with `edge-2` Caddy wrote its certificates there, no file owned by another uid (M2) |
| F7 | 8, 15 | The web ports are published on the IPv4 bind address only and no compose network enables IPv6, so 80 and 443 are closed on IPv6. Lead's decision, 2026-11-25: staging is IPv4-only in this loop; the DNS tools run without `--ipv6`; the acceptance line becomes "22, 80, 443 on IPv4; 22 only on IPv6"; IPv6 service is a follow-up. The Cloud Firewall still admits 80 and 443 from `::/0`. | code; measured by the IPv6 scan: 80 and 443 closed | follow-up |
| F8 | restore drill | `infra/drill.sh` check DR3 has the same early-exit pipeline shape: a match can end `plain_stream` with SIGPIPE, so DR3 can report PASS with a password in the globals file. | code | fixed in `ff62d0d0` |
| F9 | 11 | `provision-check` check H25 fails on a correct box. It makes the render user's `HOME` with `mktemp -d` as root (`0700 root:root`), so `docker`, as uid 10020, cannot read its config there and answers `unknown flag: --short` (exit 125). With the directory owned by 10020 the same command prints `5.7.1`. The fix text of H25 points at `/root/.docker/cli-plugins`, which is not the cause. The deploy's own render is not affected (code): its `HOME` is the render home, `root:root 0755` and empty. | measured | fixed in `410a3e47`: the directory is `root:root 0755`, as the render home is |
| F10 | 11 | `install.sh` is `sh`, so a failed `git show` or `git archive` was hidden behind `ssh`'s exit 0: the install could report success after sending nothing or part of the tree. Separately, in `en_US.UTF-8` on macOS an upper-case `--commit` could pass the hex check. | test harness | fixed: git's output is checked before any connection; the hex characters are listed |
| F11 | 12, 13 | `provision.sh` gives the staging secrets the prod groups (web 10001 and so on), while `staging.yml` runs those services as 10101, 10102, 10103, 10106 and 10107. A secret file is `0440` and keeps its host owner, so no staging app service can read its secrets. `provision-check.sh` uses the same table and passes it. The end-to-end test creates the staging secrets itself with the 101xx groups. A `check-config` failure also quarantines the release digest for good. | measured: the staging `auth` secrets on the box are `root:10007` | fixed: `provision`, `provision-check` and the ops tool use each project's compose gids, a host-stage rerun re-owns the files already there, and both ranges are reserved (INFRA 1.3.35). On the box: 11 files and directories re-owned to 101xx, then `no changes`; the staging services start |
| F12 | 12 | Step 12 says a missing secret is not a problem because the first start names it. Every file a service mounts must exist: `web` mounts `plaid_secret` and `worker` mounts `credential_keyring`, and `staging.yml` reads neither. `resend_api_key` must be a non-empty single line; it is not checked with the provider. A missing file would fail `check-config`, which quarantines the digest (Docker's behaviour for a missing secret source: not measured). | code | step 12 corrected (INFRA 1.3.34) |
| F13 | 12, 13, 14 | `polycarpic-ops init-keyring`, `keyring-fingerprint` and `restore-keyring` do not exist, and the app CLI has no `secrets init`. `set-secret credential_keyring` refuses and names `init-keyring`. No tool can create the file the worker mounts. | code | lead, 2026-11-25: no `init-keyring` in this loop; staging uses a hand-made random placeholder (a departure from the runbook); follow-up (POLY-165). Runbook lines marked "not built" (INFRA 1.3.34) |
| F14 | 8 | The public DNS answer holds 13 CAA records, not the 3 that were written: Cloudflare adds its own issuers, and an `issuewild`, while Universal SSL is on. `dns-check.py` reads the API, sees 3 and passes. So the narrowing of certificate issuers is not in force and the check cannot see it. Candidate fix: turn Universal SSL off in Cloudflare (the records are DNS only), and have `dns-check.py` compare the public answer. | measured (public `dig`) | open |
| F15 | 13 | `first-deploy staging` ended `deploy: transient: gh api failed`: `gh` was not installed. Nothing installed or checked it, and the tool hid the cause and called a missing program transient. | measured | fixed (INFRA 1.3.37): the host stage installs the pinned release tarball (form ruled by seceng), check H26, refusal `gh`, and a failed call prints its exit code and a fixed label. On the box: installed, hash equal to the pin, `PASS H26` |
| F16 | 13 | The end-to-end deploy test in CI replaces `gh` entirely, so no CI job runs a real `gh attestation verify`. Its first real run was on this box, and it passed. | code, then measured | open (test gap) |
| F17 | 13 | After the first deploy `provision-check` fails: `FAIL D1 postgres settings: staging: archive_mode is off (want on); archive_timeout is 0 (want 300)`. The check is wrong, not the configuration: staging is not backed up, `postgresql.staging.conf` sets `archive_mode = off`, the compose lint fails CI on anything else, and staging has no spool or backup service. D1 asks prod's list of both projects. The check's own test started its "staging" Postgres with the prod file. | measured; cause from code | fixed (INFRA 1.3.39): D1 wants each project's own settings. No change to the box's configuration. On the box with `git-51ea0e3b5566`: 25 `PASS`, no `FAIL`, `WAIT` H12 and D1 to D5, `WARN H13`, exit 3 |
| F18 | 13 | `edge-deploy edge-1` ended `rollback-unhealthy` and quarantined the digest in the edge's state: the Caddy container exited 255, its log repeating `exec /usr/bin/caddy: operation not permitted`. The released binary carried `cap_net_bind_service+ep` (read from the released image's layer; the builder image sets `XCADDY_SETCAP=1`), and `edge.yml` drops every capability. No test had started the Caddy image under those settings: the end-to-end test deploys staging only, and the image tests used a plain `docker run`. Staging was not touched. | measured | fixed in the build (form ruled by seceng: `XCADDY_SETCAP=0`; `edge.yml` and the guard policy unchanged; INFRA 1.3.40). It reached the box from `main` with a new signed `edge-2`, which deployed and runs healthy; the `edge-1` quarantine line stays as the record |

`gh` 2.106.0, the pin: the tarball's sha256 equals the release's `checksums.txt` and a download hashed locally; `gh attestation verify <tarball> --repo cli/cli` with the local `gh` 2.105.0 exited 0 (source `cli/cli` at `refs/heads/trunk`, signer `.github/workflows/deployment.yml`). Both on 2026-11-25. `bin/gh`'s sha256 was computed from that tarball. The end-to-end deploy test in CI uses a stand-in `gh`; the first real `attestation verify` ran on the box and passed (run 2 below).

F18, the cause: the capability was **measured** on the released image (caddy `sha256:36dff3bb…`); that it is what the kernel refused follows from capabilities(7), and qa reproduced the same error before the fix with a local build of the unfixed Dockerfile, started by a real `compose up` of `edge.yml`'s settings (`red-run.md`). `edge-deploy` takes `edge.yml` and the Caddy image from the tag's release, not from the operator tool. The edge quarantine is per digest, so nothing needs clearing: a rebuilt Caddy gives a new digest.
| F19 | after 13 | `restart --staging caddy` is refused with `restart: unknown service caddy; available: auth, caddy, postgres, web, worker`: the message lists the service it refuses. The refusal itself is right (staging has no Caddy). The list is built from every long-running service, not from those the project allows. | measured; cause from code | open (wording) |
| F20 | after 13 | The host's `core_pattern` is a pipe to apport (`\|/usr/share/apport/apport … -- %E`). The containers' core limits are 0, but by core(5) a core limit does not stop a piped pattern from being called, so the limits alone do not show that no dump is written. `/var/crash` was empty; no crash was provoked. | measured; the consequence from core(5), not tried | seceng: Medium, with a control (`security-review.md`, "Core dumps go to apport"); required before prod. By the lead's ruling it is in PR 1: the host stage purges apport and sets `kernel.core_pattern=\|/bin/false` and `fs.suid_dumpable=0`; `provision-check` H27 reads them live (INFRA 1.3.42). On the box: H27 failed on the old values, passed after the host stage, and the settings held over a reboot |
| F21 | 11, 13 | Once Caddy runs, no command applies a changed staging allow address. `provision --stage host` rewrites `edge.env`, but `edge-deploy` with the running tag does nothing and `restart caddy` keeps the container's environment; only a newer release read by a new `up` renders the file again. The sentence this loop added to step 11 ("run the command again") was not enough. On the box the address was checked before `edge-deploy` (it matched). | code | step 11 corrected (INFRA 1.3.43); a way to apply it: follow-up |
| F22 | 15, §8.11 | The runbook names `polycarpic-ops lockdown`, which does not exist; neither does the maintenance page it describes. | code | marked not built, with the commands by hand (INFRA 1.3.43; the hand commands were not run); building it: follow-up |
| F23 | `edge-2` | Caddy's responses carry `alt-svc: h3=":8443"`. Caddy serves HTTP/3 by default and advertises the port it listens on inside the container; `edge.yml` publishes TCP only and the firewall admits TCP only, so the offered port cannot be reached and a client that tries it falls back. It also tells the outside the internal port. | measured (the header, on `app`'s 502); cause from code and the compose file | follow-up: it needs a new Caddy image and a new `edge-<n>`. Proposed: `servers { protocols h1 h2 }` in the global block (with the compose lint's Caddyfile list), rather than publishing 443/udp, which would add a published port, a firewall rule and a guard rule |
| F24 | `edge-2` | The check that Caddy's log filter works could not be done: Caddy wrote no line for the request at all (the marker count is 0, and so is the control's). No site has a `log` directive, and both have `handle_errors`: when an error route answers, Caddy logs the original error at debug level only. So the sheet's control was wrong; this was already measured in `tests/infra/image/caddy-edge.test.ts`, which exercises the filter on a site without `handle_errors`. On the box the filter is therefore not exercised, and nothing was seen to leak. The other side of it: an upstream that is down leaves no line in Caddy's log. | measured (no line); cause from the Caddyfile, Caddy 2.11.9's `ServeHTTP` source and the test | fault in the command sheet, no product change. Whether upstream failures should be visible in Caddy's log belongs with monitoring (follow-up) |
| F25 | the timer's deploy | When the staging timer deployed `47fb1fbc`, `worker` logged fatal `schema.refused` (`SchemaBehindError`) at 06:31:04.846Z, 0.2 s after `postgres` started (06:31:04.666Z); Docker restarted it, and at 06:31:05.372Z it logged `worker.started` and has run clean since (1 restart). The deploy went healthy. **Cause (code, and the timings):** the database was not accepting connections yet. The guard raises `SchemaBehindError` both for a schema that is behind and for a database it cannot reach, and only the error's type is logged, so the two read alike. `postgres` was starting because each `main` build builds its Postgres image afresh, so the release names a new digest and the deploy's `up -d` recreates `postgres` at the same moment as the app containers; no compose file has `depends_on`. The guard exits 1 (code) and `restart: unless-stopped` starts the process again. The first run's exit code was **not measured**: the 0 seen came from `docker inspect` on the restarted, running container. That `worker` alone met it fits its being the quickest to connect (not measured). | measured (log, times, restart count); cause from code | not harmful here, and the recovery is the designed one (the guard refuses, Docker retries). Two follow-ups, **F25a and F25b** below |
| F25a | the worker's start guard | An unreachable database is reported as a schema that is behind: one error type, and the log carries the type only. Follow-up: the guard waits a bounded time for an unreachable database and logs that as its own event, apart from a schema that is behind (`web` and `auth` use the same guard). | code | follow-up |
| F25b | every deploy | **Every `main` build gives Postgres a new image digest** (built with no cache), so each deploy of a new build recreates `postgres`, at the same moment as the app containers, even when nothing about Postgres changed. By the same code a **prod** deploy restarts the database too. INFRA §4.6 speaks of recreating `web` only. | the restart at the deploy: measured on staging; the rest from code | follow-up: decide whether a release should keep the running Postgres image when its inputs have not changed, or whether the restart is accepted and written down |

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
- `provision-check` after the deploy: exit 1, one failure (F17). With the fix (`git-51ea0e3b5566`): exit 3, 25 `PASS`, no `FAIL`, `WAIT` H12 and D1 to D5 (prod's Postgres is not running), `WARN H13`, `HOST CHECKS PASSED; 6 checks wait for the first deploy`.

`edge-1` (2026-11-26 05:00Z on):

- The Principal signed `edge-1` on `main` at `4b186404` with the release key and pushed it; the lead verified it locally (annotated, good signature). Release workflow run 45759366614: `verify` and `publish` succeeded; the Release's body is `digest: sha256:0eba28cc…44d5`, with the SBOM, not a draft. The three image packages answer anonymous tag lists.
- `sudo polycarpic-ops edge-deploy edge-1`: exit 1, `deploy: rollback-unhealthy`. Edge `deploy.log`: candidate 05:07:30Z, verified 05:07:53Z, up 05:07:53Z, `refused unhealthy` 05:09:55Z, `rollback-unhealthy`. The digest is quarantined as `unhealthy`; an `alert` file was written. `polycarpic-edge-caddy-1` exited 255, not out of memory (F18). The staging containers stayed healthy.

### Box measurements that do not need `edge-2`

From 2026-11-26 05:27Z, operator tool `git-51ea0e3b5566`. A first attempt fed the commands to `bash -s` on standard input, and `docker compose run` consumed the rest of them after the first command of number 7; the rest was run again from a script file with standard input closed, so that refusal ran twice (it writes nothing). Numbers 1 to 9 follow the command sheet.

1. `status`: 1.127 s. `STATUS RED: 3`: the `cert` item for prod and for staging (nothing answers on 443) and the edge deploy (`rollback-unhealthy`), all expected with the edge down. Disk `/` 6%, `/srv/polycarpic` 1%; `app` staging, `slots` and `revokes` (`plpgsql` and the 17 built-ins closed to PUBLIC) OK; the token expires in 89 days.
2. `gate-check --staging`: `gate: pass`, exit 0.
3. `docker compose -p polycarpic-staging --project-directory / --env-file /dev/null ps --status running --services`: `auth`, `postgres`, `web`, `worker`; exit 0, no warning; Compose 5.7.1.
4. Core limits soft and hard 0 in all four containers. `core_pattern` is a pipe (F20). `/var/crash` empty.
5. Idle memory: `web` 50.87 MiB of 384, `auth` 74.62 MiB of 192 (38.87%), `worker` 38.22 MiB of 384, `postgres` 56.87 MiB of 1 GiB. No OOM kill; staging restarts 0. The stopped edge Caddy shows 11 restarts (F18).
6. The render under a memory cap: `prod`, `staging` and `edge` each exit 0 at 1G, 256M, 128M, 64M, 48M, 32M and 24M, with one hash per file at every cap (`d07fceceda5817f9`, `6438b08c2fcafa8b`, `6747e89d07b18caf`). Positive control: `render prod` at 16M, 8M, 4M and 2M exits 1 each time. So the cap is in force, and the floor for `prod` lies between 16M (fails) and 24M (passes); the floor of `staging` and `edge` was not bracketed.
7. `cli --staging user invite qa@example.com`: `refused: the instance has no user; use --bootstrap`, exit 2. With `--bootstrap`: `invitation recorded (bootstrap), expires 2026-12-03T05:28:21.243Z`, a link beginning `https://staging.polycarpic.com/` (not recorded), exit 0. The invitation row stays in staging.
8. Spool: a probe written in `wal` (as 999), `dump` and `premigration` (as 10004) is read by 10005, whose `rm`, `touch` and `ls .inflight` are each `Permission denied`. The probes were removed and no file is left in the spool.
9. a: `restart --staging web auth worker`: all healthy, exit 0. b: `restart --staging caddy`: refused, exit 2 (F19). c: `restart --staging postgres`: healthy, exit 0; 60 s later `web`, `auth` and `worker` were running with 0 restarts; `web` logged one `db.connection_lost` and no `process.crash`. d (the renamed secret): not run.
10. The POLY-147 marker measurement: **PASS** (figures and setup in `marker-measure-vps.md`). The first attempt failed before measuring (no `git` in the client image). Afterwards the throwaway containers, network, trees and image were removed: only the four staging containers and the exited edge Caddy remain, and `provision-check` exits 3.

### The core-dump control and the reboot

2026-11-26, about 06:00Z.

- Before installing: `apt-get -s purge apport` would remove only `apport` and `apport-core-dump-handler` (2.28.3-0ubuntu0.1); `fs.suid_dumpable` was 2.
- Installed `git-064e7429baa2`. `provision-check` before the host stage: exit 1, `FAIL H27 core dumps: kernel.core_pattern is '|/usr/share/apport/apport …' (want '|/bin/false'); fs.suid_dumpable is '2' (want 0); the apport package is present`, one check failed: the row shown red on the box's own values.
- Host stage: exit 0, 3 changes (`apport purged`; `wrote /etc/sysctl.d/50-polycarpic-core.conf`; `core dump settings applied (sysctl)`). Live: `core_pattern` `|/bin/false`, `suid_dumpable` 0, apport removed and purged (`dpkg` shows `un`). `provision-check`: `PASS H27`, exit 3, 6 checks waiting. No crash was provoked.
- **Reboot** (booted again at 06:01:55Z; SSH back in about 20 s; the same host key, checked strictly): `/srv/polycarpic` mounted from `/dev/mapper/polycarpic-data`; no swap; the four staging containers healthy about a minute after boot; the stood-down edge Caddy still `Exited (255)` and not restarting; `polycarpic-deploy@staging.timer` enabled with a next run; both core-dump values held; `provision-check` exit 3, no `FAIL`, `PASS H27`, `WAIT` H12 and D1 to D5, `WARN H13`; `status` in 1.263 s, staging rows OK, RED only for the `cert` items and the edge deploy.

## `edge-2` on the box

2026-11-26. Numbers follow the `edge-2` command sheet.

- PR 1 merged at `47fb1fbc`; `main`'s build (run 45767918658) succeeded and the staging timer deployed it by itself, 06:30 to 06:32Z, ending `healthy`: digest X = `sha256:75bfd184e7a5088db9a44ad7a9f0d513bf427bc2c7bffc78d4b9185240867a1b`.
- The Principal signed `edge-2` on `47fb1fbc`; the tag verifies with the release key; release workflow run 45857003852 succeeded; the Release's body is `digest: X`, not a draft, not a prerelease.
- **P1 to P6 pass:** no `in-progress` and no `current` in the edge's state, one quarantine line (`edge-1`'s digest), the old Caddy exited; staging on X; nothing listening on 80 or 443; Caddy's directories `0700 10010:10010`; `provision-check` exit 3 without a `FAIL`; the allow address equal to the session's; `A` records for `staging` and `app`, no `AAAA`.
- **E1a, the interruption:** in an `ssh -tt` session a driver script wrote one interrupt character to the terminal 4 s after the new container showed `Up 1 second (health: starting)` (a real terminal SIGINT, sent by a script, not by hand). Result: `deploy: interrupted; run the same command again`, a Python traceback (`KeyboardInterrupt` in `stack.wait_healthy`), exit 130; Caddy `Exited (0)`; `in-progress` present; alert `2026-11-26T16:16:48Z interrupted`; the quarantine unchanged.
- **E1b, E1c:** the same command again: `deploy: recovering an interrupted run`, exit 0. `current` holds X, `edge-2`, `47fb1fbc`; no `in-progress`, no alert; the container `running healthy`, 0 restarts.
- **M1, M2:** `certificate obtained successfully` twice. One error line: for `app`, an order failed to finalize at attempt 1, and a retry obtained the certificate. No permission or read-only line. Under `caddy` and `caddy-config` no file is owned by another uid than 10010; two certificate files.
- **M3:** both names: issuer `C=US, O=Let's Encrypt, CN=YE1`, the subject matches, valid to 2027-02-24.
- **M4:** `status` GREEN (exit 3: 6 items waiting, all prod): `cert prod` and `cert staging` OK with 89 days, `deploy edge` OK on `edge-2`. Caddy uses 15.32 MiB of 128. `provision-check` exit 3, no `FAIL`. (`cert prod` is the certificate for `app`; prod is not deployed.)
- **M5, without the password:** `http://staging…/x` answers `301` to `https://staging.polycarpic.com/x`; `https` answers `401` with `www-authenticate: Basic realm="restricted"`; a wrong password `401`. With the password, the health route answers 200 (below).
- **M8:** `app` answers `502` after 10.6 s, with `strict-transport-security`, `nosniff`, `DENY` and the referrer policy. The response also carries `alt-svc: h3=":8443"` (F23), as staging's responses do (M6).
- **M9:** not a pass and not a fail: the filter was not exercised (F24).
- **M10:** password sign-in is refused for `polyops` and `root`, by address: `Permission denied (publickey)`. By host name the client stops earlier, at `Host key verification failed`: the laptop's `known_hosts` holds the address only.
- **M5 with the password, M6, M7** (the Principal ran the lead's script; its first version answered 401 everywhere because it passed the password through a quoted `curl` config line, and the second sends it byte for byte). The health route 200; `/sign-in` 200 `text/html`; `/dashboard` 303. On `/sign-in` (200), `/api/auth/ok` (200) and `/no-such-page` (303): `Strict-Transport-Security: max-age=31536000`, `nosniff`, `DENY`, `strict-origin-when-cross-origin`, `cache-control: no-store`, and F23's `alt-svc` on each. The static file `_app/immutable/entry/start.C902cyUA.js`: 200, `nosniff`, `cache-control: public,max-age=31536000,immutable`. A `Service-Worker` header: 403. A forged `X-Forwarded-For` and `X-Real-IP` on `/api/auth/ok`: 200, and `auth` logged no `client_ip_unresolved` in the last 120 minutes: Caddy replaces the header. **Pass.** The address `auth` records for a session was not looked at (M12).
- **Browser** (the Principal, allowed network): the basic-auth prompt, then `/sign-in` with its styles (the placeholder form), no certificate warning, the connection shown as secure. The console was not inspected.
- **M11, pass:** `nmap -Pn -p- 167.235.205.75` (Nmap 7.993) from the Principal's network, started 16:18Z: 22, 80 and 443 open and nothing else (`65532 filtered tcp ports (no-response)`), 5148.72 seconds. TCP only; UDP was not scanned.
- **After these** (about 18:2xZ): Caddy up 2 h and healthy, the four staging containers up 11 h and healthy; `status` GREEN, 6 waiting (prod). Restart counts: Caddy, `postgres`, `auth` and `web` 0, `worker` 1 (F25).
- **O1 to O3, pass** (the Principal's Mac on a phone hotspot; the script compared its public IPv4 with the home one and they differ). O1: `HTTP/2 403` with no `www-authenticate` line; a wrong password on `/api/auth/ok` also 403. O2: a forged `X-Forwarded-For` carrying the allowed address: 403. So Caddy judges the real client address, and the allowlist answers before the password. O3, the control: `nc -6` to port 22 on the server's IPv6 address succeeded, so this network has IPv6; `curl -6` to `https` on that address got no HTTP answer (`000`).
- **The IPv6 full port scan: pass,** from a third network. Two earlier attempts from the hotspot are **not results**, because it lost IPv6 part-way both times:
  - attempt 1 (from 17:59Z, `nmap -Pn -6 -p- -T4 --max-retries 1`, 1306 s): `62769 filtered (host-unreach)`, `2763 filtered (no-response)`; the closing control (`nc -6` to port 22) failed with `No route to host` and the Mac no longer had a global IPv6 address, so about 96% of the ports were never probed;
  - attempt 2 (20:12 to 21:25Z, `--max-retries 2 --min-parallelism 150 --max-rtt-timeout 700ms`, 4424 s): `40558 filtered (no-response)`, `24974 filtered (host-unreach)`; the control passed before and failed after, so 38% of the ports were not probed.

  While each was connected it saw 22 open and 80 and 443 closed.
- **The scan that counts:** a temporary Hetzner server `poly-104-scan` (`cx23`, `hel1`, made for this and deleted afterwards with its throwaway SSH key), nmap 7.94SVN as root, 22:14 to 22:20Z. It is inside Hetzner's network; the Cloud Firewall still judges its traffic. The IPv6 control (`nc -6` to port 22) passed before, after the TCP scan and at the end.
  - **TCP over IPv6** (`nmap -6 -sS -Pn -p- --max-retries 2 --min-rate 1500`, 87 s): 22 open, 80 closed, 443 closed, `65532 filtered (no-response)`. **22 is the only open port.** 80 and 443 answer closed, not filtered: the firewall admits them on IPv6 and nothing listens.
  - **TCP over IPv4**, same options, 87 s: 22, 80 and 443 open, 65532 filtered. It agrees with M11.
  - **UDP over IPv4 and over IPv6** (`-sU -Pn -p- --max-retries 1 --min-rate 1500`): all 65535 ports `open|filtered (no-response)` on both. No port answered. A UDP scan cannot tell a dropped probe from an open, silent port, so this shows no UDP service that replies, and no more.
- **The Cloud Firewall, read through the API** (2026-11-26, with a new token made for the run): one firewall, `polycarpic`, applied to 1 server; 3 inbound rules, each **TCP** (22, 80, 443), each from `0.0.0.0/0` and `::/0`; no outbound rule; no UDP or ICMP rule.
- **That token is gone (C-78).** Measured by the lead on the laptop, 2026-11-26: `hcloud context list` is empty and `hcloud server list` answers `no active context or token`; `~/.config/hcloud/cli.toml` remains, 20 bytes. The token's deletion in the Hetzner console is **the Principal's statement**, not measured. `infra/operator/laptop-check.py`, which also reads that file for a token, then ran on the laptop: three `PASS` lines and `LAPTOP CHECK PASSED`.
- **Not run:** M12.

## Open questions

| Id | Answer |
|---|---|
| OQ-INFRA-7 | Plan `cx33` (4 vCPU / 8 GB / 80 GB); `fsn1` had stock on 2026-11-25. One firewall of 3 inbound TCP rules (22, 80, 443), each covering IPv4 and IPv6; no outbound, UDP or ICMP rule (read through the API). The server's IPv6 address is the `<prefix>::1` of its /64. The web ports answer on IPv4 only (F7). Full outside TCP scans: 22, 80 and 443 open on IPv4; 22 alone open on IPv6, with 80 and 443 closed. No UDP port answered on either. **Answered.** |
| OQ-INFRA-8 | **Open, each unrun step with a carrier** (INFRA). Run for staging: §7.1 steps 1 to 13, with the differences above (none is recorded for steps 1 to 6, and none ruled out), and step 15 on `edge-2` (the full scans, the `401` and the refused password login). Of §8, the update of the operator tool (§8.7, `install.sh`) was used throughout. Carriers: §7.1 steps 14, 16 and 17 and the §8 commands only prod can run, **POLY-164**; step 18, **POLY-105**; step 19, **POLY-116**; the home box (§7.2, §7.3), **POLY-120**; Vercel and Neon (§7.4), **POLY-121**; the §8 commands not run on staging (among them rollback, a replaced secret as the running container sees it, `docker compose run`'s timeout and `rm -f`, and lockdown once built), **POLY-165**. |
| OQ-INFRA-9 | **Deferred to prod** (lead), carried by **POLY-164**: staging has no heartbeat, so no Healthchecks.io limit was measured; `provision-check` shows `WARN H13`. |

## Measurements inherited from earlier loops

From the comments on POLY-104. **Done**: seen on this box. **Prod**: needs prod, a real bucket or real provider keys. **Not run**: could be run on a staging box in a later loop, and has not been.

| From | Measurement | State |
|---|---|---|
| POLY-138 | Caddy overwrites `X-Forwarded-For` with the real client address, so `/api/auth/*` does not answer 503 | Done: with a forged header `/api/auth/ok` answers 200 and `auth` logged no `client_ip_unresolved` (M7); which address it records: M12, not run |
| POLY-97 | uploader ACLs before the first backup | the spool ACL check passes on the box (done); the uploader's use of them: prod |
| POLY-97 | POLY-147 marker measurement on the VPS against a control (acceptance criterion moved here; limits 5 ms p95, 1 KB WAL) | Done, **PASS**: p95 +1.259 ms (case S) and -0.004 ms (case L), WAL +231.1 B per transaction in both (`marker-measure-vps.md` in this directory) |
| POLY-97 | "provision-check passes" means the staging-only result | Done |
| POLY-97 | `dns-check.py` shown to fail on a planted record on the live zone (E6) | **Not run** as a planted record. It did fail on the live zone on the old `_dmarc` and the missing CAA, and it does not see the public CAA answer (F14) |
| POLY-97 | `_dmarc` edit and CAA records before the test mail | Done (but see F14) |
| POLY-97 | `b2-setup.py --probe` (E9) and the new `polycarpic-read` key | Prod (before the first backup) |
| POLY-97 | IPv6 scan from outside | Done: 22 alone open on IPv6, from a temporary server with a checked IPv6 path; two hotspot attempts were not results (`edge-2` on the box) |
| POLY-97 | host key compared with the console boot log | **Not done**: accepted as first seen, staging only (F1). Needed before prod (OQ-INFRA-12) |
| POLY-97 | `app` and `staging` records pinned to the server's addresses | Done for `A`; no `AAAA` (F7). They must not outlive the server |
| POLY-97 | Caddy real-address proof; Caddy-to-auth live probe | The probe: done (M7). The real address: a forged header does not reach `auth`; Caddy judges the client's real address (O1, O2). The address as `auth` records it for a session: M12, not run |
| POLY-97 | memory caps | Idle figures recorded, no OOM kill (box measurements, 5). Under load: **not run** |
| POLY-97 | the four Resend keys at `set-secret` time; DMARC test mail (`dkim=pass`, `dmarc=pass`) | Prod: staging holds a placeholder, so no mail is sent |
| POLY-97 | Caddy pinned to Let's Encrypt, then CAA narrowed to one issuer with `accounturi` | **Not done**: blocked by F14. Both certificates come from Let's Encrypt (M3); nothing pins Caddy to it |
| POLY-97 (seceng F-D3) | the uploader's connect to Postgres's addresses expects a timeout or no route | Prod |
| POLY-97 | `cx33` plan, stock by location | Done |
| POLY-98 1 | sudo's `secure_path` reaches `/usr/local/sbin` | Done (`sudo polycarpic-ops` works) |
| POLY-98 2 | `install.sh` over real ssh; a reboot, then `provision-check` from the bundle | Done: `install.sh`, and `provision-check` from the installed bundle after the reboot |
| POLY-98 3 | `status` `cert` item through Caddy | Done: from the box itself, both `cert` items OK with 89 days (`edge-2`, M4); `app` has a certificate although prod is not deployed |
| POLY-98 4 | `status` `disk`, `app`, `backupdb`, `revokes`, `slots` within 15 s | Done: 1.127 s, with `disk`, `app`, `slots` and `revokes` OK; `backupdb`: prod |
| POLY-98 5 | `cli user invite` live | Done on staging (box measurements, 7). Opening the link: **not run** (M12) |
| POLY-98 6 | `restart` against real health checks; a renamed secret file as Linux sees it | `restart`: done (9a to 9c). The renamed secret: **not run** (it needs the Principal to type the value); moved by name to a later loop |
| POLY-98 7 | `gate-check` on the deployed schema | Done on staging: `gate: pass`; the gate on prod: prod |
| POLY-98 8 | `b2-setup.py --probe --show-rclone-output` | Prod |
| POLY-98 9 | `jobs.log` under the real backup and uploader | Prod |
| POLY-98 10 | CI `provision` job time at the PR head | Done in CI (not a box measurement): 229 s on PR 1's run |
| POLY-99 | spool ACLs on real LUKS ext4 | Done, by use (box measurements, 8) |
| POLY-99 | `core: 0` and the host's `core_pattern` | Done: limits 0; `core_pattern` was a pipe to apport (F20), now `\|/bin/false`, also after a reboot |
| POLY-99 | backup and uploader units under real systemd | Prod (installed, not enabled) |
| POLY-99 | `docker compose run`'s timeout and `rm -f` | **Not run** |
| POLY-99 | `secrets/host/` and the ownership of `jobs.log` and `last-upload` | Done as far as `provision-check` reads them; the move from the old path does not occur on a new box |
| POLY-99 | `backupdb` on real logs; the nightly run's duration and 256 MB limit; `CONNECTION LIMIT 3` with both backup runs | Prod |
| POLY-99 | the two POLY-95 secret-mode cases that need Linux | CI, not this box; their state was not checked in this loop |
| POLY-100 | edge networks made by provisioning; the release-signing key and `RELEASE_SIGNERS` before the first deploy | Done |
| POLY-100 | Caddy up from a signed release before staging is served | Done with `edge-2` (`edge-1` failed, F18) |
| POLY-100 (A19) | `docker compose config` under a memory limit on all three files, then a cap | Measured: all three render at every cap down to 24M; `prod` fails at 16M and below, so the cap is in force (box measurements, 6). The cap and its test: next ops loop |
| POLY-161 | Caddy in front of the real web server: pages, static files, headers, client address, allowlist with basic auth | Done: redirect and basic auth, pages, a static file, the headers on served pages and on errors, the browser rendering (M5 to M8; the console not inspected), and the refusal from another network (O1, O2) |
| POLY-160 | the runbook's Ctrl-C line on a real `edge-deploy` | Done (`edge-2`, E1a to E1c; the interrupt was sent to the terminal by a script) |
| POLY-160 | stopped containers stay stopped over a reboot after a stand-down | Done: the edge Caddy stood down after F18 was still stopped after the reboot |
| POLY-160 | `docker compose --project-directory` on Compose 5.7.1 with no render home | Done for the command form the tool then uses (`--project-directory /`, box measurements, 3). The render home exists on the box, so the tool's own choice of `/` was not seen. A database restart left `web`, `auth` and `worker` running (9c) |

The 2026-11-23 comment about creating `app.` only after a prod deploy was withdrawn by the one after it. Prod is not opened to the internet before POLY-163.

## Doc corrections (INFRA)

Every INFRA correction of this loop, 1.3.32 to 1.3.47. Steps that were not run are unchanged except where the code settles them.

PR 1, INFRA 1.3.32 to 1.3.42:

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
| §7.1 step 11 | `install.sh` stops with git's code, and opens no connection, when git fails | F10 |
| §7.1 step 12 | every mounted secret must exist before the first deploy (the old text said a missing one was not a problem); staging placeholders and what breaks; a different value for each name | F12 |
| §7.1 step 12 | the staging keyring placeholder made by hand | F13 |
| §7.1 step 13, step 14; §3.2 (table and the `set-secret` row); the "lost the keyring" row; §8.10; §8.12 | `init-keyring` removed from step 13; `init-keyring`, `keyring-fingerprint`, `restore-keyring`, `keyring-show`, `cli secrets rotate` and `secrets init` marked not built; step 14 does not run before they exist | F13 |
| §3.2 | the gids of prod and staging, both reserved ranges, a host-stage rerun re-owns the files, a link stops the stage | F11, S1 |
| §4.4 | the pinned `gh`: install, check H26, the refusal `gh`, the failure line and its labels, its environment; CI uses a stand-in | F15, F16 |
| §5 patch schedule | how a `gh` pin is bumped, and its floor | F15 |
| §7.1 step 11 | H26 in the list of what `provision-check` covers | F15 |
| §2.2; §7.1 step 11 | archiving is on for prod only; D1 checks each project's own settings | F17 |
| §2.2 | no file capability in any of our images; what the image job runs | F18 |
| §7.1 step 11 | D6 is not among a staging-only box's waiting checks (1.3.41) | box result and code |
| §2.1; §7.1 step 11 | core dumps: apport purged, the two kernel values, check H27 (1.3.42) | F20 |

PR 2, INFRA 1.3.43:

| Where | Correction | From |
|---|---|---|
| §7.1 step 11 | check the allow address before Caddy starts; no command applies a new one to a running Caddy | F21 |
| §7.1 step 15 | the staging `curl` expects `401` (`403` from elsewhere), not `200`, and takes the staging name; SSH by name against a `known_hosts` that holds only the address | box result |
| §7.1 step 15; §8.11 | `polycarpic-ops lockdown` and the maintenance page are not built; the commands by hand | F22 |
| §7.1 step 7 (1.3.47) | the token check is `laptop-check.py` instead of listing the directory, which cannot show whether a file holds a token; `cli.toml` can remain (the check passed on the laptop) | box result |
| Open questions (1.3.44 to 1.3.46) | OQ-INFRA-8 names the issue carrying each unrun step; OQ-INFRA-9, -12, -13 and -14 point at their carriers; OQ-INFRA-11 names the first instance that has a backup | review of PR 2 |

## Wording to fix

- `set-secret github_read_token` ends "root reads it on the next backup or upload run". That is wrong for this token, which the deploy poll reads.
