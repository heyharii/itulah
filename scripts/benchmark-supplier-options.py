#!/usr/bin/env python3
"""Compare the supplier book page with the light picker-options page.

Run against a disposable or read-only database with:

    python3 scripts/benchmark-supplier-options.py postgresql:///po_load_240k

The benchmark uses EXPLAIN ANALYZE inside a repeatable-read, read-only
transaction. It measures one first page and the three queries the full book
currently adds (page, facets, open-order summary), against the one options
query. It also checks that both first pages return the same supplier IDs.
"""

import argparse
import json
import statistics
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("database", nargs="?", default="postgresql:///po_load_240k")
parser.add_argument("--limit", type=int, default=1000)
parser.add_argument("--runs", type=int, default=5)
args = parser.parse_args()

SUPPLIER_ROWS = """
WITH tally AS (
    SELECT supplier_id, order_count, ordered_minor, active_count,
           completed_count, cancelled_count, last_ordered_at
      FROM supplier_order_tally
)
SELECT s.*,
       (CASE WHEN s.status='ACTIVE' THEN '0' ELSE '1' END)
         || ' ' || lower(COALESCE(s.name,'')) AS house_key,
       s.supplier_code AS code_key,
       lower(COALESCE(s.name,'')) AS name_key,
       COALESCE(t.order_count,0) AS t_order_count,
       COALESCE(t.ordered_minor,0) AS t_ordered_minor,
       COALESCE(t.active_count,0) AS active_key,
       COALESCE(t.completed_count,0) AS completed_key,
       COALESCE(t.cancelled_count,0) AS cancelled_key,
       t.last_ordered_at AS t_last_ordered_at,
       COALESCE(t.last_ordered_at,TIMESTAMPTZ '-infinity') AS last_key
  FROM supplier s LEFT JOIN tally t USING (supplier_id)
 WHERE (NULL::text IS NULL OR s.supplier_code ILIKE NULL::text
        OR s.name ILIKE NULL::text OR s.contact_name ILIKE NULL::text)
"""

BOOK_FILTERS = """
    (NULL::text IS NULL OR category=NULL::text)
    AND (NULL::text IS NULL OR status=NULL::text)
    AND (NOT false OR active_key>0)
"""

SUPPLIER_PAGE = f"""
WITH searched AS NOT MATERIALIZED ({SUPPLIER_ROWS}),
     kept AS NOT MATERIALIZED (SELECT * FROM searched WHERE {BOOK_FILTERS})
SELECT * FROM kept
 WHERE NULL::uuid IS NULL
    OR (house_key,supplier_id) >
       (SELECT house_key,supplier_id FROM kept WHERE supplier_id=NULL::uuid)
 ORDER BY house_key,supplier_id
 LIMIT {args.limit}
"""

SUPPLIER_FACETS = f"""
WITH searched AS ({SUPPLIER_ROWS}),
     booked AS (SELECT * FROM searched WHERE NULL::text IS NULL OR category=NULL::text),
     kept AS (SELECT * FROM booked
               WHERE (NULL::text IS NULL OR status=NULL::text)
                 AND (NOT false OR active_key>0))
SELECT 'status' AS kind,status AS value,count(*)::bigint AS n
  FROM booked GROUP BY status
UNION ALL SELECT 'all','',count(*)::bigint FROM kept
"""

SUPPLIER_BOOK = """
WITH standing AS (
    SELECT o.purchase_order_id,o.issued_at,
           COALESCE(s.supplier_key,
             (SELECT x.supplier_id FROM supplier x
               WHERE x.supplier_code=o.supplier_id)) AS supplier_key,
           s.expected_stock_units AS expected_units,
           GREATEST(s.gross_minor-o.discount_minor,0)::bigint AS net_minor,
           s.lifecycle
      FROM purchase_order o
      JOIN purchase_order_summary s USING (purchase_order_id)
)
SELECT count(*)::bigint AS open_orders,
       COALESCE(sum(p.expected_units),0)::bigint AS open_units,
       COALESCE(sum(p.net_minor),0)::bigint AS open_value_minor
  FROM standing p JOIN supplier s ON s.supplier_id=p.supplier_key
 WHERE p.lifecycle IN ('ACTIVE','PARTIALLY_RECEIVED')
   AND (NULL::text IS NULL OR s.category=NULL::text)
"""

OPTIONS = f"""
WITH kept AS NOT MATERIALIZED (
    SELECT s.*,
           (CASE WHEN s.status='ACTIVE' THEN '0' ELSE '1' END)
             || ' ' || lower(COALESCE(s.name,'')) AS house_key
      FROM supplier s
     WHERE NULL::text IS NULL OR s.status=NULL::text
)
SELECT * FROM kept
 WHERE NULL::uuid IS NULL
    OR (house_key,supplier_id) >
       (SELECT house_key,supplier_id FROM kept WHERE supplier_id=NULL::uuid)
 ORDER BY house_key,supplier_id
 LIMIT {args.limit}
"""

queries = {"page": SUPPLIER_PAGE, "facets": SUPPLIER_FACETS,
           "book": SUPPLIER_BOOK, "options": OPTIONS}
order = [["page", "facets", "book", "options"]]
for run in range(args.runs):
    order.append(["page", "facets", "book", "options"] if run % 2 == 0
                 else ["options", "page", "facets", "book"])

sql = "SET statement_timeout='15s'; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
sql += "\n".join(
    f"EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) {queries[name]};"
    for group in order for name in group
)
sql += f"""
SELECT (SELECT array_agg(supplier_id ORDER BY house_key,supplier_id)
          FROM ({SUPPLIER_PAGE}) page)
     = (SELECT array_agg(supplier_id ORDER BY house_key,supplier_id)
          FROM ({OPTIONS}) options);
ROLLBACK;
"""
result = subprocess.run(
    ["psql", args.database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    input=sql, text=True, capture_output=True, check=True, timeout=90,
)

remaining = result.stdout.strip()
decoder = json.JSONDecoder()
plans = []
for _ in range(sum(len(group) for group in order)):
    value, end = decoder.raw_decode(remaining)
    plans.append(value[0])
    remaining = remaining[end:].strip()

def metrics(group):
    old = [plans[group + i] for i in (0, 1, 2)]
    options = plans[group + 3]
    return (sum(plan["Execution Time"] for plan in old),
            options["Execution Time"],
            sum(plan["Plan"]["Shared Hit Blocks"] + plan["Plan"]["Shared Read Blocks"]
                for plan in old),
            options["Plan"]["Shared Hit Blocks"] + options["Plan"]["Shared Read Blocks"])

warmup = metrics(0)
old_ms, options_ms, old_blocks, options_blocks = [], [], [], []
for run in range(args.runs):
    start = 4 + run * 4
    if run % 2 == 0:
        old, option, old_buffer, option_buffer = metrics(start)
    else:
        # This run reports options first, then the three full-book queries.
        option = plans[start]["Execution Time"]
        option_buffer = (plans[start]["Plan"]["Shared Hit Blocks"]
                         + plans[start]["Plan"]["Shared Read Blocks"])
        old_plans = plans[start + 1:start + 4]
        old = sum(plan["Execution Time"] for plan in old_plans)
        old_buffer = sum(plan["Plan"]["Shared Hit Blocks"]
                         + plan["Plan"]["Shared Read Blocks"] for plan in old_plans)
    old_ms.append(old)
    options_ms.append(option)
    old_blocks.append(old_buffer)
    options_blocks.append(option_buffer)

print(json.dumps({
    "database": args.database,
    "limit": args.limit,
    "warmup_old_ms": round(warmup[0], 3),
    "warmup_options_ms": round(warmup[1], 3),
    "old_full_book_median_ms": round(statistics.median(old_ms), 3),
    "options_median_ms": round(statistics.median(options_ms), 3),
    "old_shared_blocks_median": statistics.median(old_blocks),
    "options_shared_blocks_median": statistics.median(options_blocks),
    "first_page_ids_equal": remaining == "t",
    "old_runs_ms": [round(value, 3) for value in old_ms],
    "options_runs_ms": [round(value, 3) for value in options_ms],
}, indent=2))
if remaining != "t":
    raise SystemExit("supplier page and options page IDs differ")
