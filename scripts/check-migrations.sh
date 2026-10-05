#!/usr/bin/env bash
# Fail when two migrations share a four-digit number.
#
# Two sessions each adding "the next" migration took the pos-e2e rig down on
# 2026-10-02 (0816 and 0817 were each used twice). The runner orders by the
# number, so a pair applies in an order nobody chose, or not at all.
#
# Usage: scripts/check-migrations.sh [dir ...]
# Defaults to backend/migrations/postgres, which the runner applies by number.
# The node's SQLite files are included by name (`edge::sqlite`) and carry a
# few historical pairs, so they are not checked unless named.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- "$root/backend/migrations/postgres"
fi

status=0
for dir in "$@"; do
  [ -d "$dir" ] || continue
  dupes="$(find "$dir" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*' -exec basename {} \; \
    | cut -c1-4 | sort | uniq -d)"
  for prefix in $dupes; do
    status=1
    echo "duplicate migration number $prefix in $dir:" >&2
    find "$dir" -maxdepth 1 -type f -name "${prefix}_*" -exec basename {} \; | sort | sed 's/^/  /' >&2
  done
done

if [ "$status" -eq 0 ]; then
  echo "migration numbers are unique"
fi
exit "$status"
