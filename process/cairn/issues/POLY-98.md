---
id: POLY-98
title: polycarpic-ops operator CLI
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97]
assignee: devops-engineer
paths: [infra/ops/**]
labels: [ops, cli]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-16
---

The operator subcommands INFRA §7 and §8 name (set-secret through cli pass-through). status prints digest, last deploy, last backup from last-upload (never from the app), certificate days, disk, unaccounted poly_backup connections in 24 h, and non-temporary replication slots. Secrets are read without echo and written 0400.

## Acceptance criteria

- [ ] Each subcommand has a bats (or equivalent) test against a fake host root.
- [ ] list-secrets never prints a value.
- [ ] status fits one screen and exits non-zero on any red item.
- [ ] INFRA §7.5 and §8 match the output verbatim, or INFRA is corrected in the same PR.
- [ ] `status` checks the bootstrap revokes on the live database: plpgsql `USAGE` absent for PUBLIC, and PUBLIC holds no EXECUTE on the 17 SQL-string built-ins (POLY-147 ruling R10, R11; SECURITY C-87). Red if a restore or major upgrade lost them. The restore step in INFRA §8.10 becomes a named command if one is added here.

## Comments

### @team-lead — 2026-11-12

From the POLY-142 loop (`process/cairn/reviews/POLY-142/ruling.md` R0; seceng O8 in `seceng-ruling-review.md`). (1) `polycarpic-ops cli …` runs `docker compose exec -T worker /app/bin/polycarpic cli …`, never `run`: `run` makes the command the container's PID 1 and the log driver keeps the printed invitation link on disk. (2) INFRA §7.5 and the first-deploy bootstrap step say the invite sends an email; POLY-142 prints the link once to stdout and sends nothing (Principal, 2026-11-13). devops-engineer corrects that text with this issue. Email delivery is POLY-144's.

### @team-lead — 2026-11-13

From POLY-145's decision: POLY-146 moves `polycarpic cli user invite` to a one-shot `operator` compose service on its own login role, poly_operator. The `polycarpic-ops cli` wrapper targets that service, not the worker.

### @team-lead — 2026-11-13

From POLY-146's security review (`process/cairn/reviews/POLY-146/security-review.md`, Follow-ups): INFRA §7.5 routes every `polycarpic-ops cli …` command through the one-shot `operator` service, but poly_operator holds only EXECUTE on `app.issue_operator_invitation`. Each later command (`reset-mfa`, `remove-owner`, `set-founder`, `secrets rotate`) needs grants it does not hold. Each must arrive with its own grant review by seceng, never a default widening of poly_operator, and the credential keyring is not mounted into `operator` without one.

### @team-lead — 2026-11-15

Follow-up from POLY-147 (merged via PR #127) added to the list above; source: `process/cairn/reviews/POLY-147/` (ruling, security-review, verdict) and devops-147's findings.

### @team-lead — 2026-11-16

From the POLY-89 follow-ups (seceng, 2026-11-17): add a `polycarpic-ops gate-check` subcommand that runs the deploy-gate query in INFRA §7.1 step 16 (poly_app holds no privilege on BetterAuth's tables and no EXECUTE on any `enter_*` except `enter_session`) and exits non-zero on any row. Step 16 then calls it in place of the raw `psql` command, which is tagged unmeasured until POLY-97's staging deploy runs it. The gate is the Principal's decision of 2026-11-16 (`process/DECISIONS.md`).
