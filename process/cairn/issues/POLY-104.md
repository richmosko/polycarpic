---
id: POLY-104
title: First staging deploy
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-98, POLY-100, POLY-99, POLY-95, POLY-96, POLY-101, POLY-160]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/index.html]
labels: [ops, verification]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-23
---

Run INFRA §7.1 steps 1–13 and 18 on a real Hetzner project, staging only (fake data), verbatim as a novice would, and record every command that differs; INFRA v1.2 lands the fixes. Folds in OQ-INFRA-7 (plan, firewall counts, IPv6), OQ-INFRA-8, OQ-INFRA-9 (Healthchecks limits), the outside-in scan and C-78 token deletion. Record in process/cairn/reviews/<this ID>/staging-deploy.md.

## Acceptance criteria

- [ ] Staging reaches healthy; nmap shows exactly 22/80/443 on v4 and v6.
- [ ] provision-check passes.
- [ ] OQ-INFRA-7, -8 and -9 each have a recorded answer.
- [ ] The review file lists every doc correction, and INFRA v1.2 lands them.

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
