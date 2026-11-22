---
id: POLY-97
title: Infra scaffolding + provisioning
status: todo
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/hetzner/**, infra/provision.sh, infra/provision-check.sh, infra/README.md]
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-22
---

The committed, idempotent scripts INFRA §7.1 steps 7–11 call (D-7): create.sh, cloud-init, provision.sh and provision-check.sh. provision-check is the evidence for C-70, C-71, C-72, C-76, C-77 and C-79 (sshd from sshd -T, the C-79 set, spool holds only .age, Docker pools vs fixed subnets).

## Acceptance criteria

- [ ] shellcheck is clean and a dry run in a container passes in CI.
- [ ] On a real Hetzner project create.sh run twice is a no-op the second time and never opens a port other than 22/80/443.
- [ ] provision-check ends ALL CHECKS PASSED, and each FAIL line names its fix.
- [ ] No secret is printed or logged.
- [ ] provision-check asserts the production database's `pg_extension` is exactly `{plpgsql}`: pgTAP's `lives_ok` / `throws_ok` / `results_eq` run caller-supplied SQL and PUBLIC can execute them, so pgTAP must never reach production (POLY-147 seceng review §5).
- [ ] At the first staging deploy, the POLY-147 marker measurement (`tests/db/bench/`) is re-run on the VPS against a control and the p95 and WAL deltas are recorded beside `process/cairn/reviews/POLY-147/marker-measure.md`; the first run was one Mac host, and the marker's cost is a commit that flushes WAL (verdict note 3). Limits: 5 ms at p95, 1 KB of WAL per transaction.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop (`process/cairn/reviews/POLY-95/`): (F1) `infra/postgres-major` is created by POLY-95 and removed from this issue's `paths:`; provision-check reads it from `main`. (F2) The "spool holds only `.age`" check allows `spool/wal/.inflight/`, empty at rest. (F6, as amended by A1) provision.sh creates one secrets directory per service, `root:<gid>` 0750 with 0440 files, sets the Postgres data dirs to uid 999, and provision-check asserts it and that no secret file is world-readable. **(F12, gates the first real backup)** the uploader (uid 10005) cannot read or delete the 0600 `.age` files Postgres and backup write; grant it by default POSIX ACLs on the spool folders, never by chmod or a shared gid.

### @team-lead — 2026-11-12

From the POLY-142 loop (ruling R0, read by the architect at 22edd82): the worker service in `infra/compose/prod.yml` sets no `DATABASE_*` and no `PUBLIC_ORIGIN`, so `polycarpic cli user invite` stops at its configuration check on a box today (exit 1, correctly). The worker's database settings and public origin must be wired before the first-user bootstrap step can run.

### @team-lead — 2026-11-13

From POLY-146: `packages/db/sql/roles.sql` creates a new LOGIN role, poly_operator, without a password, as it does the other login roles. Provisioning must generate `db_password_operator` under the operator's own secrets directory and set the role's password from it, alongside the other roles' passwords. The `operator` compose service is the only one that mounts that file (compose lint `operator-one-shot` and the secret matrix enforce it); provisioning must not place it in the web or worker directories. INFRA §3.2 lists it among the generated secrets.

### @team-lead — 2026-11-15

Follow-up from POLY-147 (merged via PR #127) added to the list above; source: `process/cairn/reviews/POLY-147/` (ruling, security-review, verdict) and devops-147's findings.

### @team-lead — 2026-11-16

Deploy gate (Principal, 2026-11-16; `process/DECISIONS.md`): staging here holds test data only. No real household data is deployed until POLY-149's revocation PR has merged.

### @team-lead — 2026-11-18

Follow-ups from POLY-152:
- **N4:** the provisioning check that production `pg_extension` holds only plpgsql is what keeps pgTAP 08's extension skip safe; it is not built yet.
- **Live probe:** from the Caddy container, show that it cannot reach the auth service's internal listener (ruling R6.2; unmeasured until the first compose up).
- **Memory caps:** the auth container's caps (256 MB prod, 192 MB staging) are estimates; measure at the first staging deploy.

### @team-lead — 2026-11-18

From the POLY-153 loop (`process/DECISIONS.md`, 2026-11-19; SECURITY Open Risks). **Gates the first deploy with real household data.** Two additions to this issue:
- The operator guide states the domain rule: under the app's domain there are only `app` and `staging`, no wildcard record and no alias (CNAME) to an outside service.
- A check lists the domain's DNS records through Cloudflare's API and fails, naming each record, if it finds a wildcard, an outside alias, or any name other than `app` and `staging`. It runs in the deploy gate (INFRA §7.1, with step 16) and in the monthly window. The check must be shown to fail on a planted extra record before it is trusted. The Cloudflare token it uses is read-only for DNS.

### @team-lead — 2026-11-19

From the POLY-153 loop (architect's verdict §4, `process/cairn/reviews/POLY-153/verdict.md`). **F4:** a data-only `pg_restore --disable-triggers` skips the deferred check that every session has a handle. The restore runbook (INFRA §8.10) must restore `app.session_handle` together with `session`, or delete all sessions after the restore so everyone signs in again.

### @team-lead — 2026-11-20

From POLY-150 (seceng build-review, deviation 6). If the database ever runs on another host than the sign-in service (the Neon path), the deploy gate must check clock sync, or `noteTotpStepHook` must refuse instead of logging: a service clock 30 s ahead lets one sign-in code through a re-check.

### @team-lead — 2026-11-21

From POLY-137 and POLY-138 (both merged 2026-11-21). Deploy items for this issue or the first staging deploy:
- Show on the deployed box that Caddy sees each visitor's real address: an IPv4 bind, `userland-proxy` off, and the probe's own address echoed back (POLY-138 F5; SECURITY C-04 says the address is trusted only once this is shown).
- `MAIL_FROM` reaches `auth` and `worker` from `/etc/polycarpic/host.env` (INFRA D-1); nothing in the repo delivers it, and both services refuse to start without it.
- Resend: the sending domain with open and click tracking off; two sending-only keys, one per service; key rotation; SPF, DKIM and DMARC `p=reject` (INFRA §6.1).
- Runbook: only a database superuser can correct a user's email (seceng N2); a notice that cannot be delivered keeps its method held; an alert when the worker's `job.run` lines stop.
- INFRA §7.1 describes a prod maintenance page that the Caddyfile does not have (POLY-138 F4).

### @team-lead — 2026-11-22

Findings from walking the Principal through INFRA §7.0–7.1 by hand, 2026-11-21/22. Owners: devops-engineer (runbook, scripts), seceng (items 1, 6, 7), architect (item 6). Prototype scripts are in the lead checkout at `temp/poly-97-operator-scripts/` (untracked).

**Security finding**

1. The Backblaze web form's "Write Only" key is not put-only. `b2_authorize_account` on the key the runbook tells the operator to create reports `bypassGovernance, deleteFiles, listBuckets, writeBucketEncryption, writeBucketLifecycleRules, writeBucketLogging, writeBucketNotifications, writeBucketReplications, writeBucketRetentions, writeFileLegalHolds, writeFileRetentions, writeFiles`. A break-in holding it can turn off the bucket's default retention, after which new backups are unlocked and deletable; INFRA §6.1's "the box credential cannot shorten retention or delete versions" is false for that key. Fixed by hand: `polycarpic-put-only` created through `b2_create_key` with `listBuckets, writeFiles` only (read back and confirmed), old key deleted, master key regenerated before and after. The runbook must create keys through the API, and `provision-check` must assert the box key's capability list. Unmeasured: whether rclone's S3 upload and the uploader's verify step work with only those two capabilities.

**Runbook corrections (Backblaze)**

2. The Object Lock dialog offers only a day count; the API reports `mode: compliance`. "If only governance is offered, stop" cannot be followed from the screen; replace it with an API read of `fileLockConfiguration` (a Read Only web key carries `readBucketRetentions`).
3. Encryption cannot be left off in the current form (bucket shows SSE-B2 / AES256). Harmless; the runbook says "encryption off".
4. The region is fixed at account creation; say to pick EU Central on the signup form.
5. Caps & Alerts needs a payment method; say so.

**Design points for the ruling**

6. The acceptance criterion's DNS check fails on "any name other than `app` and `staging`" and on any outside alias. Resend's verification for `mail.polycarpic.com` needs exactly: CNAME `send.mail` → `send.forge.rmta.net`, CNAME `rsend.mail` → `rsend-euw1.forge.rmta.net`, TXT `resend._domainkey.mail`. The apex also carries lock-down records (below). As worded the check can never pass on a zone that sends mail. Define the allowed set, pin the two aliases by target, and fail if a target changes.
7. Apex lock-down records now published: SPF `v=spf1 -all`, null MX `0 .`, `_dmarc` `v=DMARC1; p=reject`. seceng to confirm the DMARC policy; a test mail must be shown to pass it before the deploy gate.
8. Healthchecks.io is skipped for now, so alert path B does not exist at first deploy. The checks need an explicit, reported "not configured" state, not a silent pass.

**Deliverable the Principal asked for**

9. "The script you wrote was more helpful than creating the two keys by hand. That walkthrough script should be saved (generate / use master key, then regen new master key)." Turn the prototypes into committed operator tooling under `infra/`, tests first: B2 (master-key steps printed; both keys created through the API; bucket settings and each key's capability list read back and asserted; master key never stored or echoed) and DNS (`dns-move-to-cloudflare.py`, `dns-mail-records.py`; extend for the `app`/`staging` records). Fix in the prototypes: hide the Porkbun API key prompt as well as the secret.

**State as built (all read back through the provider APIs or public DNS)**

- Hetzner: project `polycarpic`, empty; Read & Write token in `hcloud` context `polycarpic` on the laptop (delete after `create.sh`).
- Laptop: `hcloud`, `age`, `rclone`, `nmap` installed; `~/.ssh/polycarpic_ed25519` (passphrase set); age backup key made, private half off the laptop, public line in `~/polycarpic-backup.key.public`.
- Backblaze (EU Central, no card): bucket `polycarpic-hetzner-backups`, endpoint `s3.eu-central-003.backblazeb2.com`, private, Object Lock compliance 35 days, lifecycle hide 36 / delete 1; keys `polycarpic-put-only` and `polycarpic-read`.
- DNS: `polycarpic.com` registered at Porkbun, name servers `anton` / `aron.ns.cloudflare.com` (Cloudflare Free); zone holds only the six mail records.
- Resend: account; `mail.polycarpic.com` verified, EU region. No API keys yet: create them at `set-secret` time on the box so they are never stored elsewhere (four: auth and worker, staging and production).
- The Principal does not use a password manager (C-78 assumes one); the macOS Passwords app was offered.

**Conditions before real household data** (recorded in DECISIONS 2026-11-22): a card on Backblaze with storage cap, 75% alert and downloads uncapped (C-73); Healthchecks.io account and checks.
