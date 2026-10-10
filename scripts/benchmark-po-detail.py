#!/usr/bin/env python3
"""Compare baseline/current PO-detail SQL in a read-only transaction.

Run before committing: python3 scripts/benchmark-po-detail.py
After committing, pass --baseline with the commit before the optimization.
"""

import argparse
import json
from pathlib import Path
import re
import statistics
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", default="postgresql:///po_load_240k")
parser.add_argument("--po", default="PO-0209681")
parser.add_argument("--baseline", default="HEAD")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
relative = "backend/src/cloud/postgres/sync.rs"
baseline = subprocess.run(
    ["git", "show", f"{args.baseline}:{relative}"], cwd=root,
    text=True, capture_output=True, check=True,
).stdout
current = (root / relative).read_text()


def psql(sql):
    return subprocess.run(
        ["psql", args.database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, check=True,
    ).stdout.strip()


has_wrong_quantity = psql("""
SELECT EXISTS (SELECT 1 FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'goods_receipt_line'
AND column_name = 'wrong_quantity');
""") == "t"
po = args.po.replace("'", "''")
queries = []
for source in (baseline, current):
    section = source[source.index("pub async fn purchase_order_status"):]
    match = re.search(r'let lines = sqlx::query\(\s*"(.*?)",\s*\)', section, re.S)
    if match is None:
        raise RuntimeError("PO detail query extraction failed")
    query = match.group(1).replace(
        "$1", f"(SELECT purchase_order_id FROM purchase_order WHERE po_number = '{po}')"
    )
    if not has_wrong_quantity:
        # Older load fixtures predate mismatch counts. Adapt both reads without
        # changing their stored facts or migrating the large fixture.
        query = query.replace("goods_receipt_line r", "fixture_receipt_lines r")
        cte = ("fixture_receipt_lines AS NOT MATERIALIZED "
               "(SELECT *, 0::bigint AS wrong_quantity FROM goods_receipt_line)")
        query = "WITH " + cte + ("," + query[4:] if query.startswith("WITH") else " " + query)
    queries.append(query)

sql = "SET statement_timeout='20s'; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
for _ in range(5):
    for query in queries:
        sql += "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query + ";\n"
sql += (
    "SELECT COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY line_number) FROM ("
    + queries[0] + ")x), '[]'::jsonb) = "
    "COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY line_number) FROM ("
    + queries[1] + ")x), '[]'::jsonb); COMMIT;"
)
remaining = psql(sql)
decoder = json.JSONDecoder()
plans = []
for _ in range(10):
    value, end = decoder.raw_decode(remaining)
    plans.append(value[0])
    remaining = remaining[end:].strip()

for variant, subset in (("before", plans[::2]), ("after", plans[1::2])):
    print(json.dumps({
        "variant": variant,
        "median_ms": statistics.median(plan["Execution Time"] for plan in subset),
        "runs_ms": [plan["Execution Time"] for plan in subset],
        "rows": subset[-1]["Plan"]["Actual Rows"],
        "shared_hits": subset[-1]["Plan"]["Shared Hit Blocks"],
        "shared_reads": subset[-1]["Plan"]["Shared Read Blocks"],
        "legacy_wrong_quantity_zero": not has_wrong_quantity,
    }))
if plans[-1]["Plan"]["Actual Rows"] == 0:
    raise RuntimeError("No PO lines returned; choose an existing order")
if remaining != "t":
    raise RuntimeError("Baseline and optimized rows differ")
print("rows_equal=true")
