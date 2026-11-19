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
updated: 2026-11-18
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
