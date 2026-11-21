#!/usr/bin/env bash
# POLY-138 D1 (b): the decision of the weekly Renovate check, apart from the workflow so it can be tested.
#   infra/renovate/check-report.sh <report.json>
# Input: the JSON file Renovate writes with RENOVATE_REPORT_TYPE=file (repositories.<name>.packageFiles.<manager>[]
# .{packageFile, deps[].{depName, currentValue, updates[].{newValue, newDigest}}}).
# Exit 0: no dependency has an update (prints one line). Exit 1: at least one has; prints one line per dependency
# ("<file>: <dep> <current> -> <new>[@<digest>]"). Exit 2: the report is missing, empty, not JSON, or has no
# repositories (fails closed: a broken lookup is never read as "nothing due").
set -euo pipefail

report="${1:-}"
if [ -z "$report" ] || [ ! -s "$report" ]; then
  echo "check-report: no report at '${report}'" >&2
  exit 2
fi
if ! jq -e '(.repositories | type == "object") and (.repositories | length > 0) and ([.repositories[] | (.packageFiles | type) == "object"] | all)' "$report" >/dev/null 2>&1; then
  echo "check-report: $report is not a Renovate report with repositories and their packageFiles" >&2
  exit 2
fi
# a lookup that extracted no dependency at all is a broken lookup, not a clean one
if ! jq -e '[.repositories[].packageFiles | .[][] | .deps[]?] | length > 0' "$report" >/dev/null 2>&1; then
  echo "check-report: $report lists no dependency" >&2
  exit 2
fi

due="$(jq -r '.repositories[].packageFiles | .[][] | .packageFile as $f | .deps[]? | select((.updates // []) | length > 0) | "\($f): \(.depName) \(.currentValue // "") -> \([.updates[] | (.newValue // "") + (if .newDigest then "@" + .newDigest else "" end)] | join(", "))"' "$report")"

if [ -n "$due" ]; then
  echo "Updates are due; bump the line named below, run the DB battery, and merge:"
  echo "$due"
  exit 1
fi
echo "No update is due."
