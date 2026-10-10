#!/usr/bin/env python3
"""Compare master usage query shapes in connection-local temporary tables.

Run: python3 scripts/benchmark-master-usage.py [postgresql:///postgres]
This measures the full-list size usage aggregate, not HTTP latency.
"""

import json
import statistics
import subprocess
import sys

before = """
SELECT v.code,
       (SELECT count(*) FROM bench_sku s WHERE s.size_code = v.code) AS in_use,
       CASE WHEN (SELECT count(*) FROM bench_sku s WHERE s.size_code = v.code) > 0
            THEN 'IN_USE' ELSE 'UNUSED' END AS usage
  FROM bench_sizes v ORDER BY v.code
"""
after = """
SELECT v.code, COALESCE(u.in_use, 0) AS in_use,
       CASE WHEN COALESCE(u.in_use, 0) > 0 THEN 'IN_USE' ELSE 'UNUSED' END AS usage
  FROM bench_sizes v
  LEFT JOIN (SELECT size_code AS code, count(*) AS in_use
               FROM bench_sku GROUP BY size_code) u ON u.code = v.code
 ORDER BY v.code
"""
fixture = """
SET statement_timeout = '30s';
CREATE TEMP TABLE bench_sizes (code text PRIMARY KEY);
INSERT INTO bench_sizes
SELECT lpad(n::text, 2, '0') FROM generate_series(0, 99) n;
CREATE TEMP TABLE bench_sku (size_code text);
INSERT INTO bench_sku
SELECT lpad((n % 90)::text, 2, '0') FROM generate_series(1, 200000) n;
CREATE INDEX ON bench_sku (size_code);
ANALYZE bench_sizes;
ANALYZE bench_sku;
"""
for _ in range(5):
    for query in (before, after):
        fixture += "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query + ";"

result = subprocess.run(
    ["psql", sys.argv[1] if len(sys.argv) > 1 else "postgresql:///postgres",
     "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    input=fixture, text=True, capture_output=True, check=True,
)
decoder = json.JSONDecoder()
remaining = result.stdout.strip()
plans = []
while remaining:
    plan, end = decoder.raw_decode(remaining)
    plans.append(plan[0])
    remaining = remaining[end:].strip()

for label, subset in (("before", plans[::2]), ("after", plans[1::2])):
    print(json.dumps({
        "query": label,
        "sizes": 100,
        "skus": 200000,
        "median_ms": statistics.median(plan["Execution Time"] for plan in subset),
        "runs_ms": [plan["Execution Time"] for plan in subset],
        "local_buffer_hits": subset[-1]["Plan"].get("Local Hit Blocks"),
    }))
