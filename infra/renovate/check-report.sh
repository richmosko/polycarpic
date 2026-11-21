#!/usr/bin/env bash
# POLY-138 D1 (b): the decision of the weekly Renovate check, apart from the workflow so it can be tested.
#   infra/renovate/check-report.sh <report.json>
# Input: the JSON file Renovate writes with RENOVATE_REPORT_TYPE=file (problems[]; repositories.<name>.{problems[],
# packageFiles.<manager>[].{packageFile, deps[].{depName, currentValue, warnings, updates[].{newValue, newDigest}}}}).
# Exit 0: no dependency has an update (prints one line). Exit 1: at least one has; prints one line per dependency
# ("<file>: <dep> <current> -> <new>[@<digest>]"). Exit 2 (reason on stderr): the report is missing, empty, not JSON, or has no
# repositories; it carries any problem or any dependency warning (a registry failure leaves `updates` empty); it lists no
# dependency; or an expected pin is absent. Fails closed: a broken or partial lookup is never read as "nothing due".
set -euo pipefail

# Every pin the lookup must see: <manager>|<file>|<depName>|<which FROM line, or any>. A static test keeps this list equal
# to the two Dockerfiles, so a pin added without being listed here fails.
PINS='[
  ["dockerfile", "infra/postgres/Dockerfile", "postgres", "any"],
  ["regex", "infra/postgres/Dockerfile", "age", "any"],
  ["dockerfile", "infra/caddy/Dockerfile", "caddy", "builder"],
  ["dockerfile", "infra/caddy/Dockerfile", "caddy", "runtime"],
  ["regex", "infra/caddy/Dockerfile", "caddy", "any"]
]'

fail() { echo "check-report: $*" >&2; exit 2; }

report="${1:-}"
if [ -z "$report" ] || [ ! -s "$report" ]; then
  fail "no report at '${report}'"
fi
if ! jq -e '(.repositories | type == "object") and (.repositories | length > 0) and ([.repositories[] | (.packageFiles | type) == "object"] | all)' "$report" >/dev/null 2>&1; then
  fail "$report is not a Renovate report with repositories and their packageFiles"
fi

# a problem or a warning means the lookup was partial (Renovate still writes a well-formed report, with empty updates)
empty='(. == null or . == [] or . == "" or . == {})'
problems="$(jq -r "[(.problems // empty), (.repositories[].problems // empty)] | map(select($empty | not)) | length" "$report")"
if [ "$problems" -gt 0 ]; then
  fail "$report carries $problems problem entries: the lookup is not trustworthy"
fi
warned="$(jq -r "[.repositories[].packageFiles | .[][] | .packageFile as \$f | .deps[]? | select(.warnings | $empty | not) | \"\(\$f): \(.depName)\"] | join(\"; \")" "$report")"
if [ -n "$warned" ]; then
  fail "dependency warnings (the lookup of these failed): $warned"
fi

if ! jq -e '[.repositories[].packageFiles | .[][] | .deps[]?] | length > 0' "$report" >/dev/null 2>&1; then
  fail "$report lists no dependency"
fi
missing="$(jq -r --argjson pins "$PINS" '
  [.repositories[].packageFiles | to_entries[] | .key as $m | .value[] | .packageFile as $f | .deps[]? | {m: $m, f: $f, n: .depName, v: (.currentValue // "")}] as $deps
  | [$pins[] | . as [$m, $f, $n, $k]
     | select([$deps[] | select(.m == $m and .f == $f and .n == $n
         and ($k == "any" or ($k == "builder" and (.v | endswith("-builder"))) or ($k == "runtime" and (.v | endswith("-builder") | not))))] | length == 0)
     | "\($n) (\($m), \($f)\(if $k == "any" then "" else ", " + $k end))"]
  | join("; ")' "$report")"
if [ -n "$missing" ]; then
  fail "expected pins missing from the report (no longer extracted, so no longer watched): $missing"
fi

due="$(jq -r '.repositories[].packageFiles | .[][] | .packageFile as $f | .deps[]? | select((.updates // []) | length > 0) | "\($f): \(.depName) \(.currentValue // "") -> \([.updates[] | (.newValue // "") + (if .newDigest then "@" + .newDigest else "" end)] | join(", "))"' "$report")"

if [ -n "$due" ]; then
  echo "Updates are due; bump the line named below, run the DB battery, and merge:"
  echo "$due"
  exit 1
fi
echo "No update is due."
