#!/usr/bin/env python3
"""Compare exact PO-book count plans without executing the full page query.

Runs joined and summary-only counts in one repeatable, read-only snapshot.
It checks parity for unfiltered, lifecycle, and expected-arrival cases, then
prints bounded EXPLAIN ANALYZE plans for the unfiltered and combined case.

Example: python3 scripts/benchmark-po-count.py
"""

import argparse
import re
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", default="postgresql:///po_load_240k")
parser.add_argument("--timeout-ms", type=int, default=15000)
args = parser.parse_args()
if args.timeout_ms < 1:
    parser.error("--timeout-ms must be positive")

old_query = """SELECT count(*)::bigint AS total_count
FROM purchase_order o
JOIN purchase_order_summary s USING (purchase_order_id)
WHERE ($1::text[] IS NULL OR s.lifecycle = ANY($1))
  AND ($2::date IS NULL OR s.expected_arrival >= $2::date)
  AND ($3::date IS NULL OR s.expected_arrival <= $3::date)"""
summary_query = """SELECT count(*)::bigint AS total_count
FROM purchase_order_summary s
WHERE ($1::text[] IS NULL OR s.lifecycle = ANY($1))
  AND ($2::date IS NULL OR s.expected_arrival >= $2::date)
  AND ($3::date IS NULL OR s.expected_arrival <= $3::date)"""

# The load fixture has data on both sides of these boundaries. The same cases
# remain useful on a smaller database: zero-row parity is still exact parity.
cases = {
    "no_filters": ("NULL::text[]", "NULL::date", "NULL::date"),
    "active": ("ARRAY['ACTIVE']::text[]", "NULL::date", "NULL::date"),
    "fully_received": (
        "ARRAY['FULLY_RECEIVED']::text[]", "NULL::date", "NULL::date"
    ),
    "delivery_from_2026": ("NULL::text[]", "DATE '2026-01-01'", "NULL::date"),
    "received_in_2025": (
        "ARRAY['FULLY_RECEIVED']::text[]",
        "DATE '2025-01-01'",
        "DATE '2025-12-31'",
    ),
}

sql = [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    f"SET LOCAL statement_timeout = {args.timeout_ms};",
    f"PREPARE po_count_joined(text[], date, date) AS {old_query};",
    f"PREPARE po_count_summary(text[], date, date) AS {summary_query};",
]
for name, params in cases.items():
    args_sql = ", ".join(params)
    sql.extend(
        [
            f"EXECUTE po_count_joined({args_sql}) \\gset {name}_old_",
            f"EXECUTE po_count_summary({args_sql}) \\gset {name}_new_",
            f"SELECT 'parity|{name}|' || :'{name}_old_total_count'"
            + f" || '|' || :'{name}_new_total_count' || '|'"
            + f" || (:'{name}_old_total_count'::bigint = :'{name}_new_total_count'::bigint)::text;",
        ]
    )

for name in ("no_filters", "received_in_2025"):
    params = ", ".join(cases[name])
    sql.extend(
        [
            f"\\echo PLAN|joined|{name}",
            f"EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) EXECUTE po_count_joined({params});",
            f"\\echo PLAN|summary|{name}",
            f"EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) EXECUTE po_count_summary({params});",
        ]
    )
sql.append("COMMIT;")

result = subprocess.run(
    [
        "psql", args.database, "-X", "-q", "-A", "-t",
        "-v", "ON_ERROR_STOP=1",
    ],
    input="\n".join(sql),
    text=True,
    capture_output=True,
    check=True,
)

parities = []
plan_lines = []
for line in result.stdout.splitlines():
    if line.startswith("parity|"):
        _, case_name, old_count, summary_count, same = line.split("|")
        parities.append((case_name, int(old_count), int(summary_count), same == "true"))
    else:
        plan_lines.append(line)

if len(parities) != len(cases):
    raise RuntimeError(f"Expected {len(cases)} parity rows, got {len(parities)}")
for name, old_count, summary_count, same in parities:
    print(f"parity case={name} joined={old_count} summary={summary_count} equal={same}")
if not all(same for _, _, _, same in parities):
    raise RuntimeError("Joined and summary-only PO totals differ")

print("\n".join(plan_lines))
plan_text = "\n".join(plan_lines)
if not re.search(r"Execution Time: [0-9.]+ ms", plan_text):
    raise RuntimeError("EXPLAIN ANALYZE output did not contain execution times")
