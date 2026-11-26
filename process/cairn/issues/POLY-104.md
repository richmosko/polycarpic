---
id: POLY-104
title: First staging deploy
status: in-review
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-98, POLY-100, POLY-99, POLY-95, POLY-96, POLY-101, POLY-160, POLY-161, POLY-162]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/**, docs/SECURITY/**, docs/ARCH/**, infra/**, tests/infra/**, process/cairn/issues/POLY-104.md]
labels: [ops, verification]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/160
created: 2026-11-08
updated: 2026-11-26
---

Run INFRA §7.1 steps 1–13 and 18 on a real Hetzner project, staging only (fake data), verbatim as a novice would, and record every command that differs; INFRA v1.2 lands the fixes. Folds in OQ-INFRA-7 (plan, firewall counts, IPv6), OQ-INFRA-8, OQ-INFRA-9 (Healthchecks limits), the outside-in scan and C-78 token deletion. Record in process/cairn/reviews/<this ID>/staging-deploy.md.

## Acceptance criteria

- [x] Staging reaches healthy; nmap shows exactly 22/80/443 on IPv4, and 22 only on IPv6 (staging is IPv4-only: `process/DECISIONS.md` 2026-11-26). — process/cairn/reviews/POLY-104/staging-deploy.md: "`edge-2` on the box" (staging `healthy` at 47fb1fbc, `status` GREEN; full TCP scans: IPv4 from the home network and from hel1, IPv6 from hel1 with controls before and after)
- [x] provision-check passes. — process/cairn/reviews/POLY-104/staging-deploy.md: "Box results" and "`edge-2` on the box" (exit 3, no FAIL, `HOST CHECKS PASSED; 6 checks wait for the first deploy`: the staging-only result; the six are prod's)
- [ ] OQ-INFRA-7, -8 and -9 each have a recorded answer. — OQ-INFRA-7 answered (process/cairn/reviews/POLY-104/staging-deploy.md: "Open questions"); OQ-INFRA-8 answered for §7.1 steps 1–13 and 15 on staging, the rest deferred to POLY-164, POLY-105, POLY-116, POLY-120, POLY-121 and POLY-165 as INFRA names them; OQ-INFRA-9 deferred to POLY-164 (staging has no heartbeat)
- [x] The review file lists every doc correction, and INFRA v1.2 lands them. — process/cairn/reviews/POLY-104/staging-deploy.md: "Doc corrections (INFRA)" and "Wording to fix"; landed in docs/INFRA/index.html (1.3.47)

## Comments

### @team-lead — 2026-11-11

Gated by POLY-138's first item: Caddy must overwrite `X-Forwarded-For` with `{remote_host}` before the first deploy, or every `/api/auth/*` request answers 503 (POLY-86 seceng S19). Also gated by POLY-97's uploader ACLs for the first backup (POLY-95 verdict F12).

### @team-lead — 2026-11-22

From the POLY-97 loop (merged 2026-11-22 via PR #147; `process/cairn/reviews/POLY-97/` ruling Scope, verdict, real-run.md, build-review.md). Added to this issue:
- **Acceptance criterion moved here verbatim from POLY-97 (criterion 6):** at the first staging deploy, the POLY-147 marker measurement (`tests/db/bench/`) is re-run on the VPS against a control and the p95 and WAL deltas are recorded beside `process/cairn/reviews/POLY-147/marker-measure.md`. Limits: 5 ms at p95, 1 KB of WAL per transaction.
- **"provision-check passes" means the staging-only result:** exit 3, `HOST CHECKS PASSED; <n> checks wait…`, exactly the WAIT ids INFRA §7.1 step 11 lists, and `WARN H13`. `ALL CHECKS PASSED` needs prod and the heartbeat monitor.
- **Live runs deferred from POLY-97 by the Principal (verdict steps 1–6), with the architect's conditions:** `dns-check.py` must be shown to FAIL on a planted record on the live zone before it gates anything (E6); the `_dmarc` edit and the three CAA records (`dns-records.py`) before the test mail; `b2-setup.py --probe` (E9) before the first real backup, the box key keeping `listBuckets, writeFiles` until then; `b2-setup.py` to recreate `polycarpic-read` with the ruled capability list. Until these run, the operator tools are proven against fakes only.
- **IPv6 scan from outside** (real-run F5): the Principal's network has no IPv6; scan from a vantage point that has it.
- **Host key** (real-run F6): compare the server's key with the console boot log before trusting it.
- **`app` / `staging` A and AAAA records** are created here, pinned to the server's addresses (`<prefix>::1` for IPv6), never left behind after a server is deleted.
- **From the ruling's Scope:** Caddy real-address proof, the Caddy-to-auth live probe, memory caps, the four Resend keys made at `set-secret` time, a DMARC test mail showing `dkim=pass header.d=mail.polycarpic.com` and `dmarc=pass`, Caddy pinned to Let's Encrypt and then CAA narrowed to one issuer with `accounturi`.
- **seceng F-D3 (recommended before real data):** the uploader's D3 probe proves only that the name `postgres` does not resolve from upload-net; add a connect to Postgres's own addresses that expects a timeout or no route.
- **Measured in POLY-97's real run:** the 4 vCPU / 8 GB plan is `cx33`, 9.99 EUR a month net; `fsn1` had no stock on 2026-11-22 and `nbg1` did.

### @team-lead — 2026-11-22

From the POLY-98 verdict (`process/cairn/reviews/POLY-98/verdict.md`, "Unmeasured: what POLY-104 inherits"): `polycarpic-ops` is proven against fakes, a test box image and a real Postgres only. This deploy measures the ten items listed there on the real box: sudo's `secure_path`; `install.sh` over real ssh and `provision-check` from the bundle after a reboot; `status`'s cert, disk, app, backupdb, revokes and slots items within 15 s; a live `cli user invite` (needs POLY-100's operator env wiring); `restart` against real health checks; `gate-check` on the deployed schema; `b2-setup.py --probe --show-rclone-output` against Backblaze; the `jobs.log` contract under POLY-99's real backup. Advisory A-1 (compare the staged installer by content hash in the second-install test) is a test nit for the next ops loop.

### @team-lead — 2026-11-22

From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8): measured on the staging box, not before: the spool ACLs (r-x for uid 10005, .inflight/) on real LUKS ext4; core: 0 and the host's core_pattern; the backup and upload units under real systemd; `docker compose run`'s timeout and rm -f; the secrets/host/ move and the jobs.log / last-upload ownership on a provisioned box; `status`'s backupdb item against real logs; the nightly run's duration and its 256 MB limit; CONNECTION LIMIT 3 when nightly and premigration runs meet; the two POLY-95 secret-mode cases that cannot fail on Docker Desktop.

### @team-lead — 2026-11-23

From the POLY-100 ruling (`process/cairn/reviews/POLY-100/ruling.md` R9, §L5; seceng S11, S15 in `ruling-review.md`): do not create the `app.` DNS record until `first-deploy prod` has run. That deploy stops Caddy, empties its data directories and recreates it, and prints the instruction as its last line. If the record exists earlier, every staging deploy skips the edge and alerts, and `first-deploy prod` refuses with `edge-prod-name-early` (exit 4). The reason: a staging-era Caddy that can resolve the prod name can obtain prod's certificate. INFRA's first-deploy runbook carries the same order.

### @team-lead — 2026-11-23

Correction to my comment above (2026-11-23): the rule "create the `app.` DNS record only after `first-deploy prod`" is withdrawn. It belonged to the staging-only edge exception, which the Principal replaced the same day with the strict rule: staging never deploys Caddy on any host (`process/DECISIONS.md` 2026-11-23; POLY-100 ruling R9, §L5 at d634da53). There is no DNS-order rule and no `edge-prod-name-early` refusal. What POLY-104 needs instead: `provision.sh` creates the two edge networks, and Caddy is brought up from a signed release before staging is served; which signed release (a signed `edge-<n>` tag, or prod first) is the Principal's open choice, ruling §L6. Either way the tag-signing key and `RELEASE_SIGNERS` come before the first staging deploy.

### @team-lead — 2026-11-23

From POLY-100 (seceng advisory A19, `process/cairn/reviews/POLY-100/ruling-review.md`): the deploy's render step parses a release's compose files on the box that runs prod, as the unprivileged render user with no network, but with no memory cap. A cap was left out of POLY-100 because nobody has measured whether `docker compose config` runs correctly under one. Measure it on the first staging box (the render under a memory limit, on all three files), then add the cap with its test in the next ops loop. Until then a hostile or malformed release could exhaust memory during the render; it cannot read secrets or reach the network there.

### @team-lead — 2026-11-24

From the POLY-161 loop (2026-11-25, `process/cairn/reviews/POLY-161/verdict.md` @ 43ce99c0): Caddy in front of the real web server is unproven until this deploy. The end-to-end deploy test reaches web on 3000 inside the box and never through Caddy, so the first staging deploy is where the sign-in pages, the static files, the `no-store` and `nosniff` headers Caddy sets, the client address, and the allowlist with basic auth are first seen together. Not before this issue: POLY-160's pool error listener (a database restart takes web, auth and the worker down until compose restarts them). Prod is not opened to the internet before POLY-163.

### @team-lead — 2026-11-24

From the POLY-160 loop (2026-11-25; `process/cairn/reviews/POLY-160/verdict.md`, "For filing"), three checks for the first real box: the runbook's Ctrl-C line run once on a real `edge-deploy`; a reboot after a stand-down, to see that the stopped containers stay stopped (unmeasured); `docker compose --project-directory` on the box's Compose 5.7.1 with no render home (measured only on 5.7.0 on the Mac).

### @team-lead — 2026-11-25

Feature started. Branch: `feature/poly-104-first-staging-deploy`. The lead decides and merges under the Principal's delegation of 2026-11-25 ("approved to go with your rec's. drive to completion and merge"). State at start, measured: no git tags, no `RELEASE_SIGNERS` variable, no `app` or `staging` DNS records, `main` build 45668115611 green on 4b186404. Decided (POLY-100 ruling §L6): Caddy comes up from a signed `edge-1` tag, not from a prod deploy. The lead runs the box commands with the Principal's loaded SSH key; teammates touch no real credential.

### @team-lead — 2026-11-25

Acceptance line 1 amended (architect condition C1, lead decision F7 under the Principal's delegation): staging is IPv4-only, so the scan expects 22/80/443 on IPv4 and 22 only on IPv6. The issue lands in two PRs: PR 1 the fixes (issue stays in-progress), PR 2 the edge-2 record, which closes it. See `process/DECISIONS.md` 2026-11-26.

### @team-lead — 2026-11-25

PR 1 of 2: https://github.com/richmosko/polycarpic/pull/159. CI green on e3d32c98 (deploy-real 684 s with the changed fake gh, image 713 s of 1200, provision 229 s, lint 223 s; architect condition C2 met). Merging PR 1; the issue stays in-progress for edge-2, the outside scans and PR 2.

### @team-lead — 2026-11-26

PR 2 opened: https://github.com/richmosko/polycarpic/pull/160. It carries the record from `edge-2` on and closes the issue. Awaiting CI.
