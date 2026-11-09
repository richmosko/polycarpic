---
id: POLY-76a
title: Spike checks, red
status: done
milestone: POLY-M1
parent: POLY-76
blocked_by: []
assignee: qa-engineer
paths: [spikes/poly-76/checks/**]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 2
actual.cost_usd: "1.1479"
actual.tokens: 2350957
actual.gate_cycles: 2
actual.wall_clock: 20
ratio: "0.29"
labels: [spike, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The POLY-76 checks written as executable assertions before the spike exists, so the builder does not grade their own work. Each of (a), (b), (b′), (c), (e) and (f) is one script under `spikes/poly-76/checks/` that exits non-zero with a named reason until the spike satisfies it. A short README states the contract the spike must expose (commands, database URL, role names) and nothing more.

## Acceptance criteria

- [x] One check per item (a), (b), (b′), (c), (e), (f), each asserting the issue's wording against the real database catalog or the real command output, never against a file's presence.
- [x] A single entry point runs them all and prints pass or fail per item; with no spike present every check fails for the stated reason (red), and that run's output is recorded in a comment on this issue.
- [x] (f) is a measurement, not a pass/fail on the tool: its check reports which of the two behaviours was observed.
- [x] `spikes/poly-76/checks/README.md` states the contract the spike must meet to be checked.

## Comments

### @qa-engineer — 2026-11-08

Red run, no spike present (`node spikes/poly-76/checks/run.mjs`, exit 1): (a) (b) (b') (c) (e) FAIL, (f) UNMEASURED. Every item's reason: `bin/generate failed (exit 127): spikes/poly-76/bin/generate does not exist` (the chain cannot be built). (d) deferred to POLY-121.
Harness proof: against a hand-built fake spike, (b) (c) (e) pass and (a) still fails (its anti-stub sentinel catches a no-op generate). (b') and (f) need BetterAuth and are unexercised; written to the documented API.
Contract: checks/README.md (bin/generate, bin/migrate, auth.mjs, routing-pool.mjs, schema/**/*.ts, exact object names). Postgres is `postgres:17` (INFRA names no minor).

### @qa-engineer — 2026-11-08

Verdict on 50af326 + check fix (full run `checks/run.mjs`, exit 0 after `npm ci`):
(a) PASS: generate/apply/generate byte-identical; policy in pg_policies; sentinel emitted CREATE POLICY.
(b) PASS: 4 tables created by poly_migrator, owned by poly_owner, second generate clean.
(b') PASS WITH A NAMED WORKAROUND. Two check defects were mine, now fixed: raw SQL assumed camelCase columns (now resolved from the catalog), and I asserted 1 session where sign-up + sign-in correctly make 2. Substance: the CLI-generated Drizzle schema (snake_case) does NOT work with BetterAuth's Kysely path unmodified (schema-mismatch error, per spike.md); it works only with a per-model `fields` camel->snake map in auth.mjs. The wording "no column mismatch" is met only with that map, so the package must carry it (or rename the columns) and keep it in step with the schema. Not a flip condition by itself; for the architect (POLY-76c).
(c) PASS. (e) PASS: FORCE RLS comes from custom SQL (drizzle-kit has no FORCE); a catalog test must guard it.
(f) REPORT: user.create.after does NOT share the user insert's transaction; our context-free transaction makes sign-up + provisioning atomic (commit, rollback and hook-throw cases all 1/1 or 0/0).
(d) deferred to POLY-121.
Notes on the spike (not mine to change): timestamps are `timestamp without time zone`; routing-pool.mjs is spike-grade (counter-only nesting guard); (b') and (f) cover Kysely/pg only on BetterAuth 1.7.18.
