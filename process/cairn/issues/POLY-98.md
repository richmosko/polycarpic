---
id: POLY-98
title: polycarpic-ops operator CLI
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-97]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-98.md, process/cairn/reviews/POLY-98/**, infra/ops/**, infra/operator/**, infra/provision.sh, infra/provision-check.sh, infra/postgres/**, infra/compose/**, infra/README.md, infra/lint/**, infra/ci/**, tests/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, .github/workflows/**, package.json, pnpm-lock.yaml, .gitignore]
labels: [ops, cli]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-22
---

The operator subcommands INFRA §7 and §8 name (set-secret through cli pass-through). status prints digest, last deploy, last backup from last-upload (never from the app), certificate days, disk, unaccounted poly_backup connections in 24 h, and non-temporary replication slots. Secrets are read without echo and written 0440, root and the service group (the ruling, M6).

## Acceptance criteria

- [x] Each subcommand has a bats (or equivalent) test against a fake host root. — tests/infra/ops/test_{dispatcher,lint,install,provision,set_secret,list_secrets,gate_check,restart,cli,status,ctx_getpass}.py (166 cases against a temp root with a strict fake runner) and tests/infra/provision/ops.test.ts (23 cases, real box image and sudo)
- [x] list-secrets never prints a value. — tests/infra/ops/test_list_secrets.py: test_no_secret_file_is_ever_opened (open and os.open raise on any secret path) and test_the_exact_table_on_a_fixture_tree
- [x] status fits one screen and exits non-zero on any red item. — tests/infra/ops/test_status.py: test_at_most_24_lines_of_at_most_80_characters_even_with_hostile_long_details, test_a_red_item_makes_the_summary_red_exit_1…, test_waiting_items_make_a_green_with_waiting_summary_and_exit_3
- [x] INFRA §7.5 and §8 match the output verbatim, or INFRA is corrected in the same PR. — docs/INFRA/index.html corrected in this PR; the exact output strings it quotes are pinned by tests/infra/ops/test_status.py (the screen and summaries), test_list_secrets.py (the table), test_set_secret.py, test_cli.py, test_restart.py, test_provision.py and test_gate_check.py (the messages)
- [x] `status` checks the bootstrap revokes on the live database: plpgsql `USAGE` absent for PUBLIC, and PUBLIC holds no EXECUTE on the 17 SQL-string built-ins (POLY-147 ruling R10, R11; SECURITY C-87). Red if a restore or major upgrade lost them. The restore step in INFRA §8.10 becomes a named command if one is added here. — tests/infra/provision/ops.test.ts: the four G2 real-Postgres cases (a)–(d) (NULL lanacl reads open, one granted built-in is named alone, a slot is named, all closed prints nothing); tests/infra/ops/test_status.py: test_revokes_*

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

### @team-lead — 2026-11-22

From the POLY-97 loop (ruling Scope, real-run F4): `set-secret`, `list-secrets` and a `polycarpic-ops provision` wrapper belong here. Until then INFRA §7.1 step 11 copies `provision.sh`, `provision-check.sh`, `roles.sql` and `b2-capabilities.json` to `/tmp`, which a reboot clears; give them a permanent home. seceng F-probe1: an opt-in `--show-rclone-output` on `b2-setup.py --probe`, so an INCONCLUSIVE result can be explained.

### @team-lead — 2026-11-22

Feature started. Branch: `feature/poly-98-polycarpic-ops-cli`.

### @architect — 2026-11-22

Gate 1 (ruling): process/cairn/reviews/POLY-98/ruling.md @ c3e399ae. In: set-secret, list-secrets, status, gate-check, provision, provision-check, restart (ruled trivial: M1/M2), cli user invite; logs and show-mounts out (list-secrets carries the mounting service). Settled: the cli runs 'compose --profile operator run --rm -T', never exec (M7; the 2026-11-12 'exec -T worker' is superseded by POLY-146). Secret files are 0440 root:<gid>, not 0400 (M6). H6 is relaxed to same-name, same-tree duplicates so resend_api_key's two copies pass (M5, D2). Principal: D1 (reset-mfa already holds its grant, M3; refused as ruled) and D2. seceng: §S1-S10 (POLY-98b).

### @seceng — 2026-11-22

Security review of the ruling at c3e399ae: CHANGES. Every position S1–S10 is accepted in substance. One addendum must carry eleven testable conditions, K1–K11; none adds a grant or widens scope. D1 (a) and D2 (a) concur. Residuals R-a (jobs.log is written by the uid it audits; POLY-99) and R-b (the bundle's compose can drift from the release's; POLY-100). Read process/cairn/reviews/POLY-98/ruling-review.md @ 18e57560d1a5dc9919f037a98cc3efae0e9578c3.

### @seceng — 2026-11-22

Security review of ruling Addendum 1 at 5f1b6381: PASS. K1–K11 and A1–A3 are adopted as written, and the ruling passes the security review. One non-gating note: install.sh resolves HEAD once and passes that sha to both ssh calls. Read process/cairn/reviews/POLY-98/ruling-review.md @ ead5297fe4ede988f080fc436275bfde5d0c59f8.

### @qa-engineer — 2026-11-22

Gate: tests red (98c). Plan process/cairn/reviews/POLY-98/test-plan.md, run record red-run.md, both at the commit that adds them. 180 cases: 170 red, 10 green (positive twins and H6 regression guards that must stay green). Units: 144 Python cases under tests/infra/ops/ (all red: infra/ops/ does not exist), plus B: 8 b2 rclone cases, W: CI wiring pins, C: 17 container cases (14 red). Every K1-K11 has a row in the plan. Pins 1-14 in the plan are mine, not ruled (Ctx signatures, trusted_uid, docker argv shapes, psql output protocol, message wordings); architect-98 to confirm or correct. Two ruling questions: R7 puts the fix line 'under the summary' and the summary 'last line' (pinned: fix line before the summary); R12's '30-line fixture' cannot be reached by item count (tested by width instead). Wiring pair with devops-98: step name contains polycarpic-ops, run python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops; shellcheck line adds infra/ops/install.sh (my pin).

### @qa-engineer — 2026-11-22

Gate: build green (98c). Sha 5a6ed6ca: ops unit 152, operator 93, provision container config 151 (incl. ops.test.ts 21), tests/ci 579, tests/infra 332, tests/layers 556, all green; no test changed by the build (diff 49eb5c59..5a6ed6ca empty). Suite-time delta vs a main control: provision +4.2 s (64.5 to 68.7 s), ci and infra flat, ops unit 5.3 s. Detail in process/cairn/reviews/POLY-98/gate.md. The CI provision job and R13 docs are not covered by this gate.

### @qa-engineer — 2026-11-22

Gate: build green (98c), re-run on 2255a499 (devops build d332d571 with B1-B4, plus my tests). ops unit 162, operator 93, provision container config 153 (ops.test.ts 23: incl. B1 early-value pty, B4 pasted-secret pty, G2 four real-Postgres cases), tests/ci 579, tests/infra 332, tests/layers 556: all green. 14 test commits since the red run, all mine, none loosened; the builder changed no test. Delta vs same-day main control: provision +1.7 s, ci/infra flat, ops unit 5.5 s. Detail: process/cairn/reviews/POLY-98/gate.md.

### @qa-engineer — 2026-11-22

Gate: build green (98c), final, on a3e97748 (devops build with B1-B5 and B2', plus my tests). ops unit 166, operator 93, provision container config 153, tests/ci 579, tests/infra 332, tests/layers 556: all green. Test changes since the red run: 15 commits, all mine, none loosened; the builder changed no test. G2 outputs and the main control carried over from the 2255a499 run (slots/revokes SQL unchanged); provision +3.4 s vs control. Detail in process/cairn/reviews/POLY-98/gate.md.

### @architect — 2026-11-22

Gate 4 (verdict): process/cairn/reviews/POLY-98/verdict.md on a3e97748. PASS on C1: two INFRA phrasings that state development status (§7 hint 'not available yet'; step 12 'not mounted today'), devops rewords, no re-test. Criteria 1-5 met. No test loosened. The builder's unmeasured list is compiled in the verdict: 10 items for POLY-104, two of them POLY-100's. Advisory A-1: compare the staged installer by content hash.

### @team-lead — 2026-11-22

Verdict condition C1 met at `61d303c6` (devops-engineer, `docs/INFRA/index.html` only); architect-98 confirmed by message on 2026-11-22 that both phrasings carry no development status, so the verdict stands as an unconditional PASS on `a3e97748` plus that docs commit. Stage sub-issues 98a-98e closed.
