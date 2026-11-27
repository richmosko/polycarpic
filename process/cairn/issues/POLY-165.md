---
id: POLY-165
title: Deploy follow-ups: before prod
status: backlog
milestone: POLY-M6
parent: null
blocked_by: [POLY-160]
assignee: devops-engineer
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

The part of POLY-160 that gates prod and real data, not staging. Split out by the Principal's decision of 2026-11-25 (`process/DECISIONS.md`), which amends the decision of 2026-11-24 that all of POLY-160 precedes the first staging deploy. The items are described where they were found: POLY-160's body and comments, `process/cairn/reviews/POLY-100/build-review.md`, `process/cairn/reviews/POLY-162/` and `process/cairn/reviews/POLY-161/`. POLY-164 (first prod deploy) is blocked by this issue. seceng reviews the ruling and the build. Add later deploy items that gate prod here.

## Acceptance criteria

- [ ] **Before the first prod deploy and any `v1.*` tag:** every service's `healthcheck` is pinned and environment keys outside a per-service list are refused (U1; `NODE_OPTIONS` in `environment` passes the guard today, for every app service).
- [ ] **Before the first prod deploy:** a wrong `current` on a first deploy (H3): the release runs with its timers, prod's backup timers included, not enabled, and a rerun is refused `already-deployed`.
- [ ] **Before real household data:** Docker's own apt repository is covered by automatic security updates, or fixed if POLY-104's measurement on the box shows it is not.
- [ ] **Before real household data:** a Renovate rule for the pinned Compose version file, so a Compose security fix arrives as a PR that the end-to-end deploy test proves; seceng's assessment of the alternative (pin the minor version only).
- [ ] The lint reads the pinned command and health values from `compose-allow.json` (U2), with committed guard cases for prod's `backup` and `uploader` and for caddy, and the lint comparing web's whole healthcheck object.
- [ ] A test runs the deploy test's undo and looks at what is left (U3).
- [ ] The weekly re-scan of the published image reads the bundle's package list; bits-ui becomes a dev dependency so `svelte` leaves the runtime install.
- [ ] The lesser findings: H7, H10, one-off containers "gone" by listing, the deploy test's rollback lower bound, the CI sweep's absent-input case.
- [ ] `self-update` installs the ops bundle from the attested release, or gets its own issue with the reason; the provision CI time is re-measured.
- [ ] **From POLY-104, before the first prod deploy** (each described in `process/cairn/reviews/POLY-104/staging-deploy.md` under its F number, and in `security-review.md` → "Must be true before a prod box"):
  - [ ] F1: the box is rebuilt before prod with its SSH host key checked at first boot, before the first connection (the Principal, 2026-11-27). A method for that check is built first (OQ-INFRA-12) and puts no private key where containers can read it (C-71); the key is pinned under the host name too.
  - [ ] F7: prod is IPv4-only and the Hetzner firewall admits nothing over IPv6, ports 80, 443 and 22 (the Principal, 2026-11-27; OQ-INFRA-13). seceng confirms the port 22 part. The server-creation script makes the rules so; the outside scan shows no open port on IPv6; UDP is scanned from outside.
  - [ ] F13: `init-keyring`, `keyring-fingerprint` and `restore-keyring` are built; the staging placeholder is replaced.
  - [ ] F14: `dns-check.py` compares the public CAA answer (OQ-INFRA-14). Universal SSL was turned off on 2026-11-27 and the public answer measured as the three pinned records. After the rebuild: Caddy is pinned to Let's Encrypt and CAA is narrowed to that issuer with the account address.
  - [ ] F16: a real `gh attestation verify` runs outside the box with the C-83 negative cases, at every gh pin bump; F15: CI's floating `gh` is pinned or accepted with a reason.
  - [ ] F11, F16–F18: tests may fake a third party, never our own outputs. `deploy-real` takes the secrets layout from `provision.sh` (shared `infra/provision-lib.sh`), and `tests/infra/` carries a stand-in register: each fake, what it replaces, where the real one runs.
  - [ ] F12: a missing mounted secret is refused before `check-config`, naming the file, with no quarantine.
  - [ ] F22: the maintenance page and `polycarpic-ops lockdown` are built, or INFRA §8.11's hand commands are run once and recorded.
  - [ ] F25b: every deploy recreates Postgres, prod included: accepted (the Principal, 2026-11-27). INFRA §4.6 states it.
  - [ ] F17: the order is first prod deploy with no real data, POLY-105, the restore drill (POLY-116), then real household data (the Principal, 2026-11-27; the tracker is reordered). devops says whether POLY-105's checks that need only the bucket can run before the prod deploy, and INFRA states the order.
  - [ ] Lost or stolen release-signing key: INFRA carries a re-enrolment procedure (new key, the signers list replaced on the box and in `RELEASE_SIGNERS`, the old key shown refused), rehearsed once at the rebuild (the Principal, 2026-11-27). It states whether a release signed by a retired key can still be rolled back to.
- [ ] **From POLY-167, before the first prod deploy:** the weekly Renovate check has never been green (its one run, 45217220103 on 2026-11-23, failed on a problem entry nobody read). The report is uploaded as a run artifact, the problem entry is diagnosed, and one green run and one deliberately due run are shown. Then it is decided whether `infra/backup/tools.Dockerfile`, the Node base and the `renovate/renovate` digest join its coverage. Until it is green the Caddy pins have no working refresh alarm (`process/cairn/reviews/POLY-167/security-review.md`).
- [ ] **From POLY-104, not gating prod:** F21 (a command that applies a changed staging allow address to a running Caddy, and a provision-check drift row); F23 (`servers { protocols h1 h2 }` with the next `edge-<n>`); F24 (upstream failures leave no Caddy log line: decide with monitoring, POLY-103); F25a (start guards wait a bounded time for an unreachable database and log it apart from schema-behind); F19 (`restart --staging caddy` wording); F11 S2/S3; provisioning installs or checks `git`; the A19 render memory cap and its test; `set-secret github_read_token`'s closing message.
- [ ] **From POLY-104, INFRA §8's commands:** each is run once on staging or marked prod-only: `rollback`, a renamed secret (9d), `docker compose run`'s timeout and `rm -f`, and `lockdown` once F22 builds it. The prod-only ones are run under POLY-164.
- [ ] **From POLY-104, measurements not taken on the box:** a renamed secret as the container sees it (9d); the planted DNS record against `dns-check.py`; the address `auth` records for a session (M12); `docker compose run`'s timeout and `rm -f`; certificate renewal; Caddy across a reboot while running; the "Prod" and "Not run" rows of the record's inherited-measurements table.

## Comments

### @team-lead — 2026-11-24

Placed from devops-100's hand-off notes of 2026-11-24 (POLY-100 loop), at the temp sweep of 2026-11-25. The Alpine `docker:dind` recipe used for the measurements is `process/cairn/reviews/POLY-100/render-dind-recipe.md`.
- **A `guard-render` refusal says nothing about its cause.** On T-real run 45317002038 the step log and the kept log held only "deploy: refused guard-render"; the tool discards compose's stderr. devops-100 proposed two ways to see the cause, neither built: (a) the test harness reruns the three render commands as uid 10020 after a guard-render exit and logs their stderr to the kept log; (b) the tool logs which step failed and its exit code (raw, plain, stdin render, fixed point, empty-number correction) in `deploy.log`, fixed strings only, no compose text. For the architect to rule. That run's own cause was later found and fixed (the pinned Compose version and the caller's directory, G10 and G11).
- **`render_user_ok` refuses a user that appears in its own group's member field.** Alpine's `adduser` writes that; Ubuntu's `useradd` does not. Not the cause of any failure seen; a box where the render user is added to its own group by hand would be refused.
- **`test_install_commit`'s bad-hosts case is order-dependent and unproven.** It failed three times in whole-directory runs on the Mac and passed alone every time and in the last whole run; the assertion text was not captured.
- Measured, for the record: `compose_guard.judge` as root with umask 077 under `unshare --net` and `setpriv --reuid 10020 --regid 10020 --clear-groups --no-new-privs`, an empty root-owned HOME, secrets directories 0750 root:gid and files 0440, returns a Judged record; the uid, the unreadable secret directories, the empty HOME and the isolation do not make the render fail.

### @team-lead — 2026-11-24

Items placed here from the POLY-160 loop (2026-11-25), all before the first prod deploy. Sources: `process/cairn/reviews/POLY-160/build-review.md` ("Delta read @ 655fb279", the table ruling `gate.md` §5), `verdict.md` ("For filing", D1 to D3), `process/DECISIONS.md` 2026-11-25.
- **A decision for the Principal: boot-time recovery for `first-deploy` and `edge-deploy`.** A hand-run deploy cut by a hard kill or a power loss leaves the never-healthy release running until the operator reruns it (SECURITY R-35). Accepted for staging only.
- **Prod only:** the unlimited `check-config-timeout` retry makes a pre-migration backup set every poll; whether the `held-` lift (another installed ops bundle) is enough on prod; prod's Caddy when a prod restore fails; prod's settle steps one by one and `edge-probe-baseline` raising.
- **D1:** on Ctrl-C, when the stop could not be shown, the alert `interrupted` overwrites `not-stopped` (the name only; two lines and one test).
- **Tests owed, of code that reads right (seceng's table, each by name):** C21 "during COMMIT" in the proxy form; a render home not root-owned or group- or other-writable; `clear_transient` raising; edge forms of the rollback exit and of the tree check; a second signal inside the stop; stderr closed in `recover`; the read-back against a `docker stop` that exits 0 and leaves the container up; an unreadable quarantine file; a second `rollback`.
- **Mutants owed:** settle's list, `clear_transient`, edge's tree check, status 08, the provision scripts, the `check-config` timeout per service, `rel.log` after `up`.
