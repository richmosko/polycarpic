---
name: serve
description: Starts both local dev servers at once — the docs server (scripts/serve-docs.sh, port 8765, inline comment widget) and the cairn board (scripts/cairn/cairn serve, port 8766) — via scripts/serve.sh, in the background under the Claude harness. Idempotent: a server already up is left alone. Use when you want to review docs and watch the board in the same session without starting them one at a time. Arguments: none/start, open (also opens the docs index in the browser), status, stop.
---

# serve

Lifecycle wrapper around `scripts/serve.sh`, which starts whichever of the two local servers is not already answering and leaves the rest alone. The servers stay separate processes on separate ports by design (see `/serve-docs` and `/cairn` for each one's own semantics and failure modes); this skill only removes the two-step start.

The docs index at `http://localhost:8765/` links to every doc and to the board, so one URL reaches everything.

## Usage

```
/serve            # start whatever is missing; report both URLs
/serve open       # same, then open the docs index in the browser
/serve status     # each server: up / offline
/serve stop       # stop both, whoever started them
```

## Steps

### 1. Parse the argument

`$ARGUMENTS`: empty/`start` → start; `open` → start + browser; `status` → report only; `stop` → stop both and exit. Anything else → bail with the usage block.

### 2. `status` and `stop` run the script in the foreground

```bash
./scripts/serve.sh status     # prints one line per server
./scripts/serve.sh stop       # kills the LISTEN pid on each port
```

Relay the output and exit.

### 3. Start in the background

```
Bash(command = "./scripts/serve.sh", run_in_background = true,
     description = "Start docs server and cairn board together")
```

The script probes each port first, so running it while one server is already up (the usual case: the docs server outlives review sessions) starts only the other. If both were already up it prints that and exits 0 immediately, which is fine.

Then poll for readiness, up to 10 × 0.5s:

```bash
curl -sf --max-time 1 -o /dev/null "http://127.0.0.1:${DOCS_PORT:-8765}/api/comments?doc=PRD" \
  && curl -sf --max-time 1 -o /dev/null "http://127.0.0.1:${CAIRN_PORT:-8766}/api/board"
```

If either never answers, read the background shell's output: the script names which server failed and the command to run in a terminal for live logs. Don't pretend success.

### 4. Report

```
Docs index:  http://localhost:8765/     (links to every doc and to the board)
Board:       http://localhost:8766/     (Kanban; /list, /dashboard)

Comments save to docs/<DOC>/comments.md; /refine-doc <DOC> addresses them.
Board edits write straight to process/cairn/ and commit via the normal flow.
Servers started here die on /exit; /serve stop kills both by hand.
```

### 5. Open the browser (`open` only)

```bash
open -a "Google Chrome" "http://localhost:${DOCS_PORT:-8765}/" 2>/dev/null \
  || open -a "Safari" "http://localhost:${DOCS_PORT:-8765}/"
```

## Failure modes

- **A server was started outside this skill** (own terminal, launchd, an earlier session): the script reports it as already running and does not supervise it. `/serve stop` still stops it, because stop goes by port, not by who started it.
- **Stale cairn engine** (`cairn.py` changed since the board started): this skill does not restart it. Use `/cairn`, which reads `engine.stale` and restarts a stale board.
- **Port overrides**: `DOCS_PORT` and `CAIRN_PORT` are honoured exactly as the individual servers honour them. The docs index's board link is fixed to 8766, so an overridden board port means that one link is wrong.
- **`process/cairn/config.yml` missing**: the board fails to start and the script says to run `/setup-tracker`.
