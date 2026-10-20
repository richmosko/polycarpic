#!/bin/bash
# usage: percommit.sh <repo> <outdir> <sha>...
repo="$1"; out="$2"; shift 2
mods="test_cli test_check_lint test_dashboard test_server test_engine_staleness test_multi_root test_estimation test_tokens_endpoint test_otel_receiver_hardening test_milestone_overhead test_archived_milestone_paths test_id_allocation"
for sha in "$@"; do
  d="$out/$sha"
  rm -rf "$d"; mkdir -p "$d"
  git -C "$repo" archive "$sha" scripts/cairn .claude/settings.json .claude/hooks | tar -x -C "$d"
  cd "$d/scripts/cairn/tests" || exit 1
  layout=""
  if [ -f test_cairnlib_layout.py ]; then
    layout="test_cairnlib_layout.PartitionTests test_cairnlib_layout.LayeringTests test_cairnlib_layout.NoUnresolvedGlobalsTests test_cairnlib_layout.EngineDirModeTests"
  fi
  res=$(python3 -m unittest $mods $layout 2>&1 | grep -E "^(Ran |OK|FAILED)" | tr '\n' ' ')
  fails=$(python3 -m unittest $mods 2>&1 | grep -E "^(ERROR|FAIL):" | sed -E 's/^(ERROR|FAIL): [a-z_0-9]+ \(([a-z_0-9]+)\..*/\1 \2/' | sort | uniq -c | tr '\n' ';')
  smoke=$(cd .. && python3 cairn.py --help >/dev/null 2>&1 && python3 -c "import cairn, backfill_tokens, otel_receiver, loop_stats" 2>&1 && echo smoke-ok || echo smoke-FAIL)
  echo "$sha: $res | $smoke | $fails"
done
