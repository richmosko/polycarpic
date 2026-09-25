---
id: POLY-49
title: Receiver hardening (grouped)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---

Grouped fix loop for the OTel receiver and its metrics worktree (user decision 2026-09-25: small fixes in one area ride one loop). One PR closes every member.

**Members** (each keeps its own file and criteria): POLY-7, POLY-9, POLY-25, POLY-27.

**Carried here, not filed separately:**
- **watchdog-test flake:** `test_otel_receiver_watchdog_attribution.WatchdogRecreatesAfterAbsentBoundTests.test_watchdog_recreates_after_absent_bound` missed its 0.5 s recreate bound once under the 8-worker full run (POLY-26 red gate, 2026-09-25), clean on 4 reruns.
- **flush from a worktree:** `otel_receiver.py --flush-now` run from a teammate worktree finds no pidfile and does nothing silently (observed by architect and qa in the POLY-26 loop).

- **under-capture on the POLY-48 loop (2026-09-25):** ≈40 min, 4 roles, one flush at 21:24:40Z carrying ≈0.49M tokens total (`records: 4` per teammate role); the POLY-51 plan stage alone captured 3.0M. No flush between 20:37:05Z and 21:24:40Z although the interval is 1800 s (the 21:07 flush reported 0 lines). Either exports are not reaching the receiver or the aggregator drops them; see POLY-48's closing comment for the numbers.
- **self-stop sweep flake on CI (PR #16, run 36191961863, 2026-09-25):** `test_otel_receiver_self_stop.PeriodicReapSweepTests.test_a_dead_pid_with_a_stale_transcript_is_reaped_by_the_periodic_sweep_alone` expected `sessions: 2` but the periodic sweep had already reaped the dead session on the 4-worker runner; green on rerun and locally. Same timing class as the watchdog flake above.
- **session registry stale, live session missing (POLY-48 loop, 2026-09-25):** `--status` reported one session (`bcc9a749…: alive`) for the whole loop and after that session's teammate processes were killed; the live lead session and its teammates never appeared. Likely contributor to the under-capture above: a receiver started by an earlier session is not joined by a later session's hook, and liveness keys on something other than the process.
- **`--ensure-running` against a running receiver does not register the caller (2026-09-25):** the SessionStart hook runs `otel_receiver.py --ensure-running --session-pid $PPID`; with the receiver already up from an earlier session, `.sessions/` kept only that session's id and the new session (plus three teammates) never appeared, so `--status` and the self-stop reason about a session that is dead. Zero lines were flushed between 21:24:40Z and 22:01:24Z while four agents were active.

## Acceptance criteria

- [ ] POLY-7, POLY-9, POLY-25, POLY-27 acceptance criteria met and closed by this PR
- [ ] Watchdog recreate test is deterministic (injected clock) or its bound is widened; 10 consecutive 8-worker runs green
- [ ] `--flush-now` from a linked worktree resolves the main checkout's pidfile, or fails loudly naming it
- [ ] A 30-minute, 3-teammate loop yields per-role token totals within the same order of magnitude as the transcript-derived backfill for the same window; the flush cadence honours the interval (a flush per 1800 s while sessions are alive)
- [ ] The self-stop periodic-sweep test is deterministic (injected clock or explicit sweep trigger); 10 consecutive 4-worker runs green
- [ ] `--status` lists every session whose hook ran since the receiver started; a session is marked dead within one watchdog beat of its process exiting; an empty live set arms the self-stop
- [ ] `--ensure-running` registers the calling session whether it starts the receiver or finds one running; a registered session whose pid is gone is dropped within one watchdog beat

## Comments

### @team-lead — 2026-09-25

Grouped 2026-09-25 from the POLY-26 loop's follow-ups; spec is in the body above.

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-49-receiver-hardening`.

### @architect — 2026-09-25

**Gate-1 ruling** — full text + measurements: `process/reviews/POLY-49/ruling.md`. Sub-issues: 49a plan, 49b red (qa), 49c build (impl-lead), 49d review.

- **AC4 cause (measured, M1–M8):** Claude Code 2.1.282 ignores telemetry vars in project/local settings. Same env block: 2.1.280 → 3 exports, 2.1.282 → 0; 0 connections to :4318 in 150 s from 4 live 2.1.282 agents. The receiver parses 2.1.282 payloads fine (4 points/export, delta). Registration failed for the same reason: `CLAUDE_CODE_ENABLE_TELEMETRY` no longer reaches hook env, and H1 returns before `register_session`.
- **User action (settings, user-only):** add the five telemetry keys (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, values as today) to `~/.claude/settings.json` → `env`; remove them from `.claude/settings.json` → `env`. Verified: user-scope env initialises the 2.1.282 exporter and reaches hooks (flag only, no `OTEL_*`).
- **Receiver:** the watchdog runs the interval flush (no export needed); a foreign-session filter drops datapoints with no transcript in this repo (the endpoint is now user-global); `--status` shows `exporter-endpoint`. AC4 verification is blocked-on-user until the delta is applied.
- **AC2/AC5:** widen poll bounds and remove the transient `sessions: 2` race; no clock injection.
- **AC3:** new `worktree_root.py` (resolver moved from `run_tests.py`); `main()` anchors every default path on the main checkout; loud pidfile error.
- **AC6/AC7:** register before H1; H1 decline prints one stderr line. Every tick reaps by pid alone; the PT-86 transcript second signal is withdrawn.
- **POLY-25:** endpoint from env → user settings file → default; project settings not consulted. **POLY-27:** recreate only if the parent exists, otherwise hold. **POLY-9:** exact hint text in §7. **POLY-7:** mirror the broken-origin test, plus a PATH shim for 3d.
