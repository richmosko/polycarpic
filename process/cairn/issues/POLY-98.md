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
updated: 2026-11-12
---

The operator subcommands INFRA §7 and §8 name (set-secret through cli pass-through). status prints digest, last deploy, last backup from last-upload (never from the app), certificate days, disk, unaccounted poly_backup connections in 24 h, and non-temporary replication slots. Secrets are read without echo and written 0400.

## Acceptance criteria

- [ ] Each subcommand has a bats (or equivalent) test against a fake host root.
- [ ] list-secrets never prints a value.
- [ ] status fits one screen and exits non-zero on any red item.
- [ ] INFRA §7.5 and §8 match the output verbatim, or INFRA is corrected in the same PR.

## Comments

### @team-lead — 2026-11-12

From the POLY-142 loop (`process/cairn/reviews/POLY-142/ruling.md` R0; seceng O8 in `seceng-ruling-review.md`). (1) `polycarpic-ops cli …` runs `docker compose exec -T worker /app/bin/polycarpic cli …`, never `run`: `run` makes the command the container's PID 1 and the log driver keeps the printed invitation link on disk. (2) INFRA §7.5 and the first-deploy bootstrap step say the invite sends an email; POLY-142 prints the link once to stdout and sends nothing (Principal, 2026-11-13). devops-engineer corrects that text with this issue. Email delivery is POLY-144's.
