#!/usr/bin/env bash
#
# serve.sh — one launcher for both local dev servers.
#
#   docs server   scripts/serve-docs.sh      http://localhost:8765/  (DOCS_PORT)
#   cairn board   scripts/cairn/cairn serve  http://localhost:8766/  (CAIRN_PORT)
#
# The two stay separate processes on purpose (different lifecycles, the docs
# server is also spun up per branch preview and per PDF export); this script
# only removes the "two things to start" friction. It is idempotent: a server
# whose port already answers is left alone and reported as "already running";
# only the ones this script started are stopped on Ctrl+C.
#
# Usage (from the repo root):
#   ./scripts/serve.sh            start whatever is missing, print URLs, wait
#   ./scripts/serve.sh status     report each server as up / offline
#   ./scripts/serve.sh stop       stop both (whoever started them)
#
# Ports follow the same env overrides the individual servers use:
#   DOCS_PORT=8080 CAIRN_PORT=8899 ./scripts/serve.sh

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_PORT="${DOCS_PORT:-8765}"
CAIRN_PORT="${CAIRN_PORT:-$(awk -F: '/^port:/ {gsub(/[ \t#].*/, "", $2); print $2}' process/cairn/config.yml 2>/dev/null || true)}"
CAIRN_PORT="${CAIRN_PORT:-8766}"
export DOCS_PORT CAIRN_PORT

docs_up()  { curl -sf --max-time 1 -o /dev/null "http://127.0.0.1:${DOCS_PORT}/api/comments?doc=PRD"; }
board_up() { curl -sf --max-time 1 -o /dev/null "http://127.0.0.1:${CAIRN_PORT}/api/board"; }

listen_pid() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | head -1; }

status() {
  if docs_up;  then echo "docs   up       http://localhost:${DOCS_PORT}/";  else echo "docs   offline  (port ${DOCS_PORT})";  fi
  if board_up; then echo "board  up       http://localhost:${CAIRN_PORT}/"; else echo "board  offline  (port ${CAIRN_PORT})"; fi
}

stop_all() {
  local pid
  pid="$(listen_pid "$DOCS_PORT")"
  if [ -n "$pid" ]; then kill "$pid" && echo "Stopped docs server (PID $pid)"; else echo "No docs server on port ${DOCS_PORT}."; fi
  pid="$(listen_pid "$CAIRN_PORT")"
  if [ -n "$pid" ]; then kill "$pid" && echo "Stopped cairn board (PID $pid)"; else echo "No cairn board on port ${CAIRN_PORT}."; fi
}

wait_for() {  # wait_for <probe-fn> <pid>  → 0 when the probe answers, 1 if the child died or 10s pass
  local i
  for i in $(seq 1 20); do
    if "$1"; then return 0; fi
    if ! kill -0 "$2" 2>/dev/null; then return 1; fi
    sleep 0.5
  done
  return 1
}

case "${1:-start}" in
  status) status; exit 0 ;;
  stop)   stop_all; exit 0 ;;
  start)  ;;
  *) echo "Usage: $0 [start|status|stop]" >&2; exit 2 ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required but not found in PATH." >&2
  exit 1
fi

# Space-separated pid list (not an array: macOS ships bash 3.2, where an empty
# array trips `set -u`).
STARTED=""
cleanup() {
  for pid in $STARTED; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if docs_up; then
  echo "docs   already running  http://localhost:${DOCS_PORT}/"
else
  python3 scripts/serve-docs.py >/dev/null 2>&1 &
  pid=$!; STARTED="$STARTED $pid"
  if wait_for docs_up "$pid"; then
    echo "docs   started          http://localhost:${DOCS_PORT}/"
  else
    echo "Error: docs server did not come up on port ${DOCS_PORT}. Run ./scripts/serve-docs.sh in a terminal to see why." >&2
    exit 1
  fi
fi

if board_up; then
  echo "board  already running  http://localhost:${CAIRN_PORT}/"
else
  ./scripts/cairn/cairn serve >/dev/null 2>&1 &
  pid=$!; STARTED="$STARTED $pid"
  if wait_for board_up "$pid"; then
    echo "board  started          http://localhost:${CAIRN_PORT}/"
  else
    echo "Error: cairn board did not come up on port ${CAIRN_PORT}. Run ./scripts/cairn/cairn serve in a terminal to see why (missing process/cairn/config.yml → /setup-tracker)." >&2
    exit 1
  fi
fi

cat <<EOF

Docs index:  http://localhost:${DOCS_PORT}/          (links to every doc and to the board)
  PRD:       http://localhost:${DOCS_PORT}/PRD/
  ARCH:      http://localhost:${DOCS_PORT}/ARCH/
  SECURITY:  http://localhost:${DOCS_PORT}/SECURITY/
  DESIGN:    http://localhost:${DOCS_PORT}/DESIGN/
Board:       http://localhost:${CAIRN_PORT}/          (Kanban; /list, /dashboard)

EOF

if [ -z "${STARTED// /}" ]; then
  echo "Nothing to supervise — both servers were already running. Use '$0 stop' to stop them."
  trap - EXIT
  exit 0
fi

echo "Ctrl+C stops the server(s) this launcher started."
wait
