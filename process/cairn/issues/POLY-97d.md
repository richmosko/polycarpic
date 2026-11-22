---
id: POLY-97d
title: Provisioning build
status: done
milestone: POLY-M1
parent: POLY-97
blocked_by: [POLY-97c]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-97.md, process/cairn/reviews/POLY-97/**, process/cairn/issues/POLY-97d.md, infra/**, docs/INFRA/**, .github/**, .gitignore]
stage: execute
estimate.cost_usd: "15.00"
estimate.gate_cycles: 3
actual.cost_usd: "6.6473"
actual.tokens: 32422593
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.44"
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-22
updated: 2026-11-22
---

Stage sub-issue of POLY-97; the acceptance text is in process/cairn/reviews/POLY-97/ruling.md.

## Comments

### @devops-engineer-97 — 2026-11-22

Cloudflare CAA body (from docs, not measured live): https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/ lists CAA content as 'Formatted CAA content. See data to set CAA properties' and data as {flags, tag, value}; both optional. dns-records.py sends content (documented), so no fake or test change. The page excerpt read (first 100000 of 240254 chars) does not show the list-response shape for CAA; E6 on the live zone measures it, and dns-check.py reads content.
