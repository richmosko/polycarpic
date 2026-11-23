#!/bin/bash
# POLY-99 R11 spool watcher. Prints one line per event; on a closed file it also prints a verdict line:
#   CLOSED <path> OK                the file starts with the age header and holds no canary
#   CLOSED <path> PLAINTEXT-HEADER  the first 21 bytes are not "age-encryption.org/v1"
#   CLOSED <path> PLAINTEXT-CANARY  the file contains the canary string ($CANARY)
#   CLOSED <path> TMP               a file closed under /tmp (the test judges /tmp: only the passfile may appear)
set -u
inotifywait -m -r --format '%e|%w%f' -e create -e close_write -e moved_to "$@" 2>&1 | while IFS='|' read -r ev path; do
  case "$ev" in
    Setting*|Watches*) echo "$ev"; continue ;;
  esac
  echo "EV $ev $path"
  case "$ev" in
    *CLOSE_WRITE*)
      [ -f "$path" ] || continue
      case "$path" in /tmp/*|*/root/tmp/*) echo "CLOSED $path TMP"; continue ;; esac
      v=OK
      [ "$(head -c 21 "$path")" = "age-encryption.org/v1" ] || v=PLAINTEXT-HEADER
      if [ -n "${CANARY:-}" ] && grep -aq -- "$CANARY" "$path"; then v=PLAINTEXT-CANARY; fi
      echo "CLOSED $path $v" ;;
  esac
done
