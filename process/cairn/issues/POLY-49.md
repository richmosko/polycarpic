---
id: POLY-49
title: Receiver hardening (grouped)
status: in-review
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: https://github.com/richmosko/polycarpic/pull/20
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

### @architect — 2026-09-25

**Addendum 1 to the gate-1 ruling** (answers the lead's four inputs; ruling.md stays authoritative)
- **POLY-25 source order (fixes §5):** `os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"]` → `env.OTEL_EXPORTER_OTLP_ENDPOINT` in `$CLAUDE_CONFIG_DIR/settings.json` (else `~/.claude/settings.json`) → OTLP default 4318. The repo's `.claude/settings.json` and cairn config are **not** sources; `otel_port` stays the value compared *against*. Env wins, so `PortEndpointAgreementTests`/`UnsetEndpointFallbackTests` keep their env-var drive unchanged.
- **Fixture:** helpers' `_base_env` sets `CLAUDE_CONFIG_DIR=<per-test tmp dir, empty>` for every receiver subprocess. That keeps it hermetic: once the user applies the delta, the real `~/.claude/settings.json` holds an endpoint. The new POLY-25 tests write `<that dir>/settings.json` = `{"env": {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:<p>"}}`, plus a malformed-JSON case (→ default). The in-process tests pass `user_settings_path=` to `ensure_running`.
- **Hook stdin (measured):** in a scratch config, 2.1.282 ran this repo's exact SessionStart command (`[ -f … ] || exit 0; python3 … --ensure-running --session-pid "$PPID" >/dev/null; exit 0`). The probe script saw: stdin not a TTY, readable within 0.5 s, JSON with `session_id`; `$PPID` = the claude process. So stdin plumbing is fine. The incident is the H1 early return (M8). Teammate hook stdin: (unmeasured) — same harness path.
- **Flake seams (picks from qa's characterisation):** watchdog recreate → neither (a) nor (b): widen the poll bounds + add a monotonic lower-bound check (§2). Periodic sweep → the sweep is removed (§4); the rewrite drops the transient `sessions: 2` assertion. No clock injection in either.
- **qa's 80c29af bug:** fixed by §4 as ruled. `_tick` calls `reap_dead_sessions(pid-only)` on **every** beat, **before** the emptiness/arming check, so arming always sees the reaped set. The periodic gate and nudge gate are removed from the reap call. 80c29af's red test is the pin.

### @architect — 2026-09-25

**Addendum 2 — `.transcripts-dir` marker after the `dead-pending` withdrawal**
- The marker's only reader was `_status`'s `dead`/`dead-pending` label (otel_receiver.py ~L1545). With the label gone (§4), that read is removed with it, so there's no precedence left to test. **No replacement test** for `TranscriptsDirMarkerPrecedenceTests`.
- The marker **write** stays at startup and on the watchdog recreate, because POLY-10's recreate test pins it. The foreign-session filter uses the daemon's in-process `transcripts_dir`, never the marker.
- Conditional: if the build keeps *any* marker read, qa adds one test: "`--status --transcripts-dir <B>` against a daemon spawned with `<A>` resolves `<A>`", checked on an output that differs between A and B. I check this at the verdict.

### @architect — 2026-09-25

**Gate-4 verdict @ e106214 — CHANGES REQUESTED (2 blocking, 1 nit)**

| Axis | Result | Evidence |
|---|---|---|
| §1.1 interval flush from watchdog | **FAIL** | `_tick` flushes when `monotonic - last_flush_monotonic >= flush_interval`. `flush()` returns early on no pending data (L794) and never advances `last_flush_monotonic` (only L945), so an idle receiver flushes on **every beat** once past the interval. Measured: `--flush-interval 1`, no exports, 5 s → **18** distinct `.last-flush` mtimes (expected ≤ 5). Probe: `temp/probe_hotflush.py` (architect worktree). In production: after 30 idle min, `git branch` + `git log` per milestone ≈ 4×/s, forever |
| §1.2 foreign-session filter | pass | `_handle_export_body` filter + positive cache; count-only stderr line; 5 tests |
| §1.3 `--status` exporter-endpoint | pass | last line, 3 sources tested |
| §3 worktree_root + main() anchoring | pass | verbatim move, `run_tests` alias; 3 linked-worktree tests; loud pidfile text |
| §4 register-before-H1, pid-only reap every beat before arming | pass | order confirmed in `ensure_running` + `_tick`; 80c29af pin green |
| §5 endpoint resolver | pass | env → user file → default; project settings never read; 7 tests |
| §6 POLY-27 | pass | parent guard, no `parents=`, log once per episode |
| §7 POLY-9 | pass | exact ruled text; 2 tests; TRACKER sentence present |
| §8 POLY-7 | pass | 3a skip + 3d PATH shim + recreated-path merge |
| Addendum 2 marker read | pass (no test needed) | `_status` no longer reads `.transcripts-dir`; only writes remain (L1851, L2100) |
| TRACKER.md "strictly necessary" (POLY-57 AC) | **FAIL** | +857 words in the telemetry section, mostly history/rationale ("Correction (…)", "measured", "used to", "root-caused and fixed twice over", the worktree "used to reach the wrong dir" paragraph) |
| AC4 live capture | known limit | settings delta landed (aa3a21f). Verified next session, since settings are read at launch |

**Changes (implementation-lead, re-green on one sha):**
1. **Blocking:** make every flush path advance `state.last_flush_monotonic`, including the no-op return. Simplest seam: set it in `_do_flush` after the `flush()` call, whatever the call returned. qa pin: `IntervalFlushWithNoExportsTests` gains an upper bound: `--flush-interval 1`, no exports, 5 s window → ≤ 7 distinct `.last-flush` mtimes.
2. **Blocking:** the TRACKER.md telemetry section states current behaviour only, in present tense:
   - the env block lives in user settings (≥ 2.1.282)
   - H1: registration precedes it, plus the one stderr line
   - H3 resolver order
   - watchdog interval flush
   - foreign-session filter
   - CLI anchors on the main checkout
   - pid-only liveness every beat

   No "Correction", measurement narrative, or "used to". History stays in POLY-49 + ruling.md.
3. Nit: otel_receiver.py ~L1088 docstring still cites the removed periodic sweep.

### @architect — 2026-09-25

**Gate-4 re-verdict @ a51fac6: CHANGES REQUESTED (R3, TRACKER text only; code approved)**

| Axis | Result | Evidence |
|---|---|---|
| R1 hot flush | pass | `_do_flush` sets `last_flush_monotonic` unconditionally. Re-ran `temp/probe_hotflush.py` at a51fac6: **4** distinct `.last-flush` mtimes in 5 s at `--flush-interval 1` (was 18). qa pin @ 4eb2101 green |
| Nit (stale sweep docstrings) | pass | both references rewritten |
| All other code axes | pass | unchanged since the c56d2b7 verdict |
| TRACKER.md, POLY-57 rule (line by line) | **FAIL** | details below |

TRACKER.md findings:
- **L80:** still describes "a slow periodic sweep … independently". No such sweep exists now, so the text is factually wrong. It also keeps the §0 "breaks toward not stopping" rationale, which the pid-only rule contradicts, and a "Measured (2026-09-04)" block.
- **L86:** keeps "**Correction (POLY-10, measured …)** … as previously written here".
- **L96:** "(new module; … moved here verbatim …)".
- **L108:** "now", "Root cause (measured 2026-09-24)", "used to read", "glob cost measured".
- **L88:** closes with "exactly PT-79's real incident".

**R3 (implementation-lead):** replace L80, L86, L96 and L108, plus L88's second sentence, verbatim with `process/reviews/POLY-49/tracker-r3.md` (`kind: deliverable`). A doc-only change needs no test run.

Once R3 lands verbatim, the verdict is APPROVE. I verify with `git show <sha>:process/TRACKER.md` and need no further review round.

Known limit: AC4 live capture is verified next session.

### @architect — 2026-09-25

**Gate-4 verdict @ fdae1df — APPROVE**

| Axis | Result | Evidence |
|---|---|---|
| Code, all ruling axes §1–§8 + both addenda | pass | approved @ a51fac6; `git diff a51fac6 fdae1df -- scripts/` is empty |
| R3 TRACKER.md | pass | checked `git show fdae1df:process/TRACKER.md` against `tracker-r3.md`: all 5 replacement blocks present verbatim. The removed phrases ("periodic sweep", "Correction (POLY-10", "moved here verbatim", "Root cause (measured", "PT-79's real incident") are absent |
| AC4 live capture | known limit | settings delta landed @ aa3a21f. Verified next session, since settings are read at launch |

### @team-lead — 2026-09-25

PR opened: https://github.com/richmosko/polycarpic/pull/20. Awaiting Validate. AC4 (live capture) is the known limit: verified in the next session after the telemetry keys moved to user settings (aa3a21f).
